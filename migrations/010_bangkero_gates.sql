-- =============================================================
-- 010 — BANGKERO GATES: documents + rating (Phase 3A)
--
-- Two gates decide whether a bangkero can take work:
--
--   * GOING ONLINE  — documents verified (admin approved the uploads)
--                     AND a registered bangka row. Enforced by a
--                     BEFORE UPDATE trigger, so every path that flips
--                     is_available false → true passes through it.
--                     The trigger NEVER forces a boat offline — a
--                     profile edit or a revoked verification only
--                     blocks the next "turn online".
--
--   * OFFERS/ACCEPT — documents verified AND effective rating above
--                     the floor (3.0; unrated counts as 5.0 minus
--                     accumulated penalties). Enforced in
--                     assign_next_hold (offers) and accept_booking_hold.
--                     Only UNACCEPTED 3-minute holds cascade away —
--                     trips already accepted are never re-gated and
--                     complete_trip has no rating check.
--
-- Demo switch: dev_flags.gates_bypass (admin Developer Options)
-- lifts BOTH gates. Independent of dispatch_bypass (009): turning
-- on the queue bypass does not lift gates and vice versa.
--
-- REMOVE the bypass before public launch — LAUNCH_DEFERRED_FEATURES
-- C7.
-- =============================================================

-- 1. Flag — same single-row pattern as 009.
ALTER TABLE dev_flags ADD COLUMN IF NOT EXISTS gates_bypass BOOLEAN NOT NULL DEFAULT false;

INSERT INTO dev_flags (id, dispatch_bypass, gates_bypass) VALUES (1, false, false)
  ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION dev_gates_bypass()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT gates_bypass FROM dev_flags WHERE id = 1),
    false
  );
$$;

-- Admin-only writer — mirrors set_dispatch_bypass (009).
CREATE OR REPLACE FUNCTION set_gates_bypass(p_on BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin'
  ) THEN
    RAISE EXCEPTION 'admins only';
  END IF;
  UPDATE dev_flags SET gates_bypass = p_on WHERE id = 1;
END;
$$;

-- =============================================================
-- 2. The rating floor (mirrors getEffectiveRating in
--    rating.service.ts): average of all ratings — unrated bangkero
--    gets the benefit of the doubt as 5.0 — minus accumulated
--    penalties, must end up ABOVE 3.0.
-- =============================================================
CREATE OR REPLACE FUNCTION bangkero_rating_ok(p_bangkero UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (
    COALESCE(
      (SELECT AVG(r.score) FROM ratings r WHERE r.bangkero_id = p_bangkero),
      5.0
    )
    - COALESCE(
      (SELECT b.rating_penalty FROM bangkeros b WHERE b.id = p_bangkero),
      0
    )
  ) > 3.0;
$$;

-- The offer/accept gate: bypass OR (verified AND rating above floor).
CREATE OR REPLACE FUNCTION gates_ok(p_bangkero UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT dev_gates_bypass()
    OR (
      EXISTS (
        SELECT 1 FROM bangkeros b
        WHERE b.id = p_bangkero AND b.verification_stat = 'verified'
      )
      AND bangkero_rating_ok(p_bangkero)
    );
$$;

-- =============================================================
-- 3. Going-online gate. Fires on EVERY update that flips
--    is_available false → true: the switch, the post-accept force-
--    online, the offline-race revert. Rows that only touch other
--    columns (boat name, capacity) never hit the checks.
-- =============================================================
CREATE OR REPLACE FUNCTION bangkero_online_gate()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.is_available AND NOT OLD.is_available THEN
    IF NOT dev_gates_bypass() THEN
      IF NEW.verification_stat <> 'verified' THEN
        RAISE EXCEPTION 'your documents are not approved yet';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM bangkas k WHERE k.bangkero_id = NEW.id) THEN
        RAISE EXCEPTION 'register your boat before going online';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bangkero_online_gate ON bangkeros;
CREATE TRIGGER trg_bangkero_online_gate
  BEFORE UPDATE ON bangkeros
  FOR EACH ROW
  EXECUTE FUNCTION bangkero_online_gate();

-- =============================================================
-- 4. Patch the offer assignment (full body from 009 + gates_ok on
--    every candidate and on holder retention). Run 009 first.
-- =============================================================
CREATE OR REPLACE FUNCTION assign_next_hold(p_booking_id UUID)
RETURNS VOID AS $$
DECLARE
  v bookings%ROWTYPE;
  v_route routes%ROWTYPE;
  v_port TEXT;
  v_dest TEXT;
  v_holder UUID;
BEGIN
  SELECT * INTO v FROM bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking not found';
  END IF;

  IF v.trip_stat <> 'open' THEN
    IF v.held_by IS NOT NULL OR v.hold_expires_at IS NOT NULL THEN
      UPDATE bookings SET held_by = NULL, hold_expires_at = NULL WHERE id = p_booking_id;
    END IF;
    RETURN;
  END IF;

  SELECT * INTO v_route FROM routes WHERE id = v.route_id;
  v_port := v_route.start_port_id;
  v_dest := v_route.end_port_id;

  -- A live holder that is still eligible — dispatch AND bangkero
  -- gates — keeps the offer. Losing the gate mid-hold (rating drop,
  -- verification revoked) releases it to the next boat.
  IF v.held_by IS NOT NULL
     AND v.hold_expires_at IS NOT NULL
     AND v.hold_expires_at > now()
     AND dispatch_eligible(v.held_by, v_port)
     AND gates_ok(v.held_by)
     AND NOT (COALESCE(v.rejected_by, '{}') @> ARRAY[v.held_by])
     AND route_ok(v.held_by, v_dest)
     AND fits_booking(v.held_by, v.service_type, v.num_of_passenger) THEN
    RETURN;
  END IF;

  -- Timed out: their turn is over. Mark it so the queue moves on
  -- permanently for this request (never bounces back to them).
  IF v.held_by IS NOT NULL AND v.hold_expires_at IS NOT NULL AND v.hold_expires_at <= now() THEN
    UPDATE bookings
    SET rejected_by = array_append(COALESCE(rejected_by, '{}'), v.held_by),
        held_by = NULL,
        hold_expires_at = NULL
    WHERE id = p_booking_id;
    v.rejected_by := COALESCE(v.rejected_by, '{}') || ARRAY[v.held_by];
    v.held_by := NULL;
    v.hold_expires_at := NULL;
  END IF;

  IF dev_dispatch_bypass() THEN
    -- Demo path: any online, gate-passing bangkero that has not
    -- passed on this request (queue/route/fit lifted by 009).
    SELECT b.id INTO v_holder
    FROM bangkeros b
    WHERE b.is_available
      AND gates_ok(b.id)
      AND NOT (COALESCE(v.rejected_by, '{}') @> ARRAY[b.id])
    ORDER BY b.id
    LIMIT 1;
  ELSE
    -- Next eligible boat, FCFS by the moment they entered the perimeter.
    SELECT pq.bangkero_id INTO v_holder
    FROM port_queue pq
    WHERE pq.port_id = v_port
      AND pq.left_at IS NULL
      AND pq.entered_at <= now() - INTERVAL '5 minutes'
      AND NOT (COALESCE(v.rejected_by, '{}') @> ARRAY[pq.bangkero_id])
      AND dispatch_eligible(pq.bangkero_id, v_port)
      AND gates_ok(pq.bangkero_id)
      AND route_ok(pq.bangkero_id, v_dest)
      AND fits_booking(pq.bangkero_id, v.service_type, v.num_of_passenger)
    ORDER BY pq.entered_at ASC
    LIMIT 1;
  END IF;

  IF v_holder IS NULL THEN
    IF v.held_by IS NOT NULL OR v.hold_expires_at IS NOT NULL THEN
      UPDATE bookings SET held_by = NULL, hold_expires_at = NULL WHERE id = p_booking_id;
    END IF;
  ELSIF v.held_by IS DISTINCT FROM v_holder
     OR v.hold_expires_at IS NULL
     OR v.hold_expires_at <= now() THEN
    UPDATE bookings
    SET held_by = v_holder, hold_expires_at = now() + INTERVAL '3 minutes'
    WHERE id = p_booking_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- =============================================================
-- 5. Patch the accept gates (full body from 009 + documents/rating
--    checks right after registered/online). The dispatch bypass
--    still lifts only the queue rules; gates need gates_bypass.
-- =============================================================
CREATE OR REPLACE FUNCTION accept_booking_hold(
  p_booking_id UUID, p_operator_name TEXT
) RETURNS VOID AS $$
DECLARE
  v bookings%ROWTYPE;
  v_route routes%ROWTYPE;
  v_port TEXT;
  v_dest TEXT;
  v_cap INT;
  v_load NUMERIC;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v FROM bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking not found';
  END IF;
  IF v.trip_stat <> 'open' THEN
    RAISE EXCEPTION 'taken by another bangkero';
  END IF;

  -- Re-read the hold if it is not (or no longer) ours, so a just-
  -- expired offer cascades before the eligibility checks below.
  IF v.held_by IS DISTINCT FROM auth.uid()
     OR v.hold_expires_at IS NULL
     OR v.hold_expires_at <= now() THEN
    PERFORM assign_next_hold(p_booking_id);
    SELECT * INTO v FROM bookings WHERE id = p_booking_id;
    IF v.trip_stat <> 'open' THEN
      RAISE EXCEPTION 'taken by another bangkero';
    END IF;
  END IF;

  IF v.rejected_by IS NOT NULL AND v.rejected_by @> ARRAY[auth.uid()] THEN
    RAISE EXCEPTION 'you already passed on this request';
  END IF;

  SELECT * INTO v_route FROM routes WHERE id = v.route_id;
  v_port := v_route.start_port_id;
  v_dest := v_route.end_port_id;

  IF NOT dev_dispatch_bypass() THEN
    -- Queued at the departure port (strict queue-only)…
    IF NOT EXISTS (
      SELECT 1 FROM port_queue pq
      WHERE pq.bangkero_id = auth.uid()
        AND pq.port_id = v_port
        AND pq.left_at IS NULL
    ) THEN
      RAISE EXCEPTION 'your boat is not queued at this port';
    END IF;
    -- …with the 5-minute dwell already served.
    IF EXISTS (
      SELECT 1 FROM port_queue pq
      WHERE pq.bangkero_id = auth.uid()
        AND pq.port_id = v_port
        AND pq.left_at IS NULL
        AND pq.entered_at > now() - INTERVAL '5 minutes'
    ) THEN
      RAISE EXCEPTION 'your boat is still entering the port queue';
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM bangkeros b WHERE b.id = auth.uid()) THEN
    RAISE EXCEPTION 'not a registered bangkero';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM bangkeros b WHERE b.id = auth.uid() AND b.is_available
  ) THEN
    RAISE EXCEPTION 'you are offline — turn on availability to accept';
  END IF;

  -- Bangkero gates (010): documents approved + rating above floor.
  IF NOT dev_gates_bypass() THEN
    IF NOT EXISTS (
      SELECT 1 FROM bangkeros b
      WHERE b.id = auth.uid() AND b.verification_stat = 'verified'
    ) THEN
      RAISE EXCEPTION 'your documents are not approved yet';
    END IF;
    IF NOT bangkero_rating_ok(auth.uid()) THEN
      RAISE EXCEPTION 'your rating is too low to accept bookings';
    END IF;
  END IF;

  IF NOT dev_dispatch_bypass() THEN
    -- Fresh fix = the presence sync proved the boat is still parked.
    IF NOT EXISTS (
      SELECT 1 FROM vessel_tracking vt
      JOIN bangkas bk ON bk.id = vt.bangka_id
      WHERE bk.bangkero_id = auth.uid()
        AND vt.recorded_at > now() - INTERVAL '3 minutes'
    ) THEN
      RAISE EXCEPTION 'your boat has no recent GPS position';
    END IF;
  END IF;

  IF NOT route_ok(auth.uid(), v_dest) THEN
    RAISE EXCEPTION 'you have accepted trips to another destination';
  END IF;

  IF NOT fits_booking(auth.uid(), v.service_type, v.num_of_passenger) THEN
    RAISE EXCEPTION 'not enough space on your boat for this trip';
  END IF;

  -- The whole point: only the boat the offer is held for may take it.
  IF v.held_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'this request is being offered to another boat right now';
  END IF;

  UPDATE bookings
  SET trip_stat = 'accepted',
      operator_id = auth.uid(),
      operator_name = p_operator_name,
      accepted_at = now(),
      held_by = NULL,
      hold_expires_at = NULL
  WHERE id = p_booking_id
    AND trip_stat = 'open';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'taken by another bangkero';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- =============================================================
-- DONE.
--
-- Verify:
--   SELECT * FROM dev_flags;                       -- gates_bypass = false
--   SELECT dev_gates_bypass();                     -- false
--   SELECT gates_ok('<uid>');                      -- true only if verified + rating > 3.0
--   SELECT set_gates_bypass(true);                 -- as admin → then gates_ok returns true
-- =============================================================
