-- =============================================================
-- 067 — A boat at sea never gets a booking offer
--
-- 008/009/019 hand a request to the next eligible boat, but no
-- eligibility check knows whether that boat is already sailing. A
-- sailing bangkero's home blocks Accept ("You are sailing — finish this
-- trip first"), so the offer sat on them for the full 3 minutes (and in
-- demo-bypass mode the request kept coming back to the same boat) while
-- every other boat read "Offered to another boat".
--
-- bangkero_at_sea() is the shared truth: an accepted booking departed
-- with no arrival, or a draft/finalized manifest departed with no
-- arrival. assign_next_hold skips such a boat in all three places (live
-- holder, demo bypass, FCFS queue); refresh_holds now also sweeps a
-- LIVE hold held by one — today it only revisits expired holds.
--
-- Advance accepts are untouched: assign_next_hold only runs for
-- trip_stat = 'open' same-day rows; advance rows are 'pending' and take
-- the v_advance path in accept_booking_hold.
--
-- Run manually in the SQL editor, after 066.
-- No demo reset.
-- =============================================================

CREATE OR REPLACE FUNCTION bangkero_at_sea(p_bangkero UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.operator_id = p_bangkero
        AND b.trip_stat = 'accepted'
        AND b.depart_time IS NOT NULL
        AND b.arrival_time IS NULL
    )
    OR EXISTS (
      SELECT 1 FROM trip_manifest tm
      WHERE tm.bangkero_id = p_bangkero
        AND tm.actual_departure_time IS NOT NULL
        AND tm.actual_arrival_time IS NULL
        AND tm.status IN ('draft', 'finalized')
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION bangkero_at_sea(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION bangkero_at_sea(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION bangkero_at_sea(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION bangkero_at_sea(UUID) TO service_role;

-- -------------------------------------------------------------
-- assign_next_hold — 019's body verbatim, plus the at-sea exclusion
-- on the live-holder gate and both selection branches.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION assign_next_hold(p_booking_id UUID)
RETURNS VOID AS $$
DECLARE
  v bookings%ROWTYPE;
  v_route routes%ROWTYPE;
  v_port TEXT;
  v_dest TEXT;
  v_holder UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

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
  -- verification revoked, or the boat has now departed) releases it to
  -- the next boat.
  IF v.held_by IS NOT NULL
     AND v.hold_expires_at IS NOT NULL
     AND v.hold_expires_at > now()
     AND dispatch_eligible(v.held_by, v_port)
     AND gates_ok(v.held_by)
     AND NOT bangkero_at_sea(v.held_by)
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
      AND NOT bangkero_at_sea(b.id)
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
      AND NOT bangkero_at_sea(pq.bangkero_id)
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

-- -------------------------------------------------------------
-- refresh_holds — 008's loop, plus: a LIVE hold held by a boat that
-- has since departed is swept too (expiry alone used to keep it stuck
-- for up to 3 minutes after the boat left the pier).
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION refresh_holds()
RETURNS VOID AS $$
DECLARE
  b UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  FOR b IN
    SELECT id FROM bookings
    WHERE trip_stat = 'open'
      AND (
        held_by IS NULL
        OR hold_expires_at IS NULL
        OR hold_expires_at <= now()
        OR bangkero_at_sea(held_by)
      )
  LOOP
    PERFORM assign_next_hold(b);
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

NOTIFY pgrst, 'reload schema';
