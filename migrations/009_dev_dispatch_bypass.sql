-- =============================================================
-- 009 — DEV DISPATCH BYPASS (demo tooling)
--
-- An admin-only switch that lifts the Phase 2 FCFS rules so a
-- classroom demo can accept bookings away from any port
-- perimeter. EVERY rule resumes the moment the flag is off.
--
-- Skipped while ON:
--   * port-perimeter queue membership + 5-minute dwell
--   * 3-minute GPS freshness
--   * route lock (accepted trips to another destination)
--   * capacity fit-check
--
-- Still enforced while ON:
--   * boat must be online (bangkeros.is_available)
--   * registered bangkero, booking still open
--   * the offer must be held for this boat (3-min hold rule)
--   * "already passed on this request"
--
-- REMOVE this tooling before public launch — see
-- LAUNCH_DEFERRED_FEATURES.txt C7.
-- =============================================================

-- 1. The flag: single row, readable by any signed-in user,
--    writable ONLY through the admin RPC below.
CREATE TABLE IF NOT EXISTS dev_flags (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  dispatch_bypass BOOLEAN NOT NULL DEFAULT false
);

ALTER TABLE dev_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dev_flags_select" ON dev_flags;
CREATE POLICY "dev_flags_select" ON dev_flags
  FOR SELECT TO authenticated USING (true);

INSERT INTO dev_flags (id, dispatch_bypass) VALUES (1, false)
  ON CONFLICT (id) DO NOTHING;

-- 2. Reader used by every patched rule. SECURITY DEFINER so RLS
--    can never hide the flag from the dispatch functions, and
--    COALESCE so a missing row reads as OFF, never NULL.
CREATE OR REPLACE FUNCTION dev_dispatch_bypass()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT dispatch_bypass FROM dev_flags WHERE id = 1),
    false
  );
$$;

-- 3. Admin-only writer. Mirrors the is-admin checks the RLS
--    policies in 003/007 use (users.user_role).
CREATE OR REPLACE FUNCTION set_dispatch_bypass(p_on BOOLEAN)
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
  UPDATE dev_flags SET dispatch_bypass = p_on WHERE id = 1;
END;
$$;

-- =============================================================
-- 4. Patch the rules (CREATE OR REPLACE keeps 008's definitions
--    in place — run 008 first, then this file).
-- =============================================================

-- Availability always required; the queue + fresh-GPS pair is
-- what the bypass lifts. Off-state semantics are unchanged.
CREATE OR REPLACE FUNCTION dispatch_eligible(p_bangkero UUID, p_port TEXT)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
      SELECT 1 FROM bangkeros b
      WHERE b.id = p_bangkero AND b.is_available
    )
    AND (
      dev_dispatch_bypass()
      OR (
        EXISTS (
          SELECT 1 FROM port_queue pq
          WHERE pq.bangkero_id = p_bangkero
            AND pq.port_id = p_port
            AND pq.left_at IS NULL
            AND pq.entered_at <= now() - INTERVAL '5 minutes'
        )
        AND EXISTS (
          SELECT 1 FROM vessel_tracking vt
          JOIN bangkas bk ON bk.id = vt.bangka_id
          WHERE bk.bangkero_id = p_bangkero
            AND vt.recorded_at > now() - INTERVAL '3 minutes'
        )
      )
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION route_ok(p_bangkero UUID, p_dest TEXT)
RETURNS BOOLEAN AS $$
  SELECT dev_dispatch_bypass()
    OR NOT EXISTS (
      SELECT 1 FROM bookings b
      JOIN routes r ON r.id = b.route_id
      WHERE b.operator_id = p_bangkero
        AND b.trip_stat = 'accepted'
        AND r.end_port_id <> p_dest
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION fits_booking(p_bangkero UUID, p_service TEXT, p_pax INT)
RETURNS BOOLEAN AS $$
  SELECT dev_dispatch_bypass()
    OR p_service = 'rental'
    OR COALESCE((
      SELECT k.capacity FROM bangkas k
      WHERE k.bangkero_id = p_bangkero
      ORDER BY k.id LIMIT 1
    ), 0) >= p_pax + COALESCE((
      SELECT SUM(b.num_of_passenger) FROM bookings b
      WHERE b.operator_id = p_bangkero AND b.trip_stat = 'accepted'
    ), 0);
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Candidate source is the only thing dispatch_eligible cannot
-- fix: offers are picked FROM port_queue, and a boat far from
-- every perimeter has no row there. Under bypass, pick from all
-- available bangkeros instead (the hold rule itself is kept —
-- the offer still targets exactly one boat).
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

  -- A live, still-eligible holder keeps the offer — nothing to do.
  IF v.held_by IS NOT NULL
     AND v.hold_expires_at IS NOT NULL
     AND v.hold_expires_at > now()
     AND dispatch_eligible(v.held_by, v_port)
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
    -- Demo path: any online bangkero that has not passed on this
    -- request (deterministic order; route/fit are lifted above).
    SELECT b.id INTO v_holder
    FROM bangkeros b
    WHERE b.is_available
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

-- The accept gates: queue membership, dwell and fresh GPS are
-- skipped under bypass. Registered/online/open/held/rejected
-- checks and the route_ok/fits_booking calls (already patched
-- above) stay exactly where they are.
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
-- 5. Realtime — the toggle must flip the bangkero's chips live.
-- =============================================================
DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER TABLE public.dev_flags REPLICA IDENTITY FULL';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'replica identity skipped for dev_flags: %', SQLERRM;
  END;
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.dev_flags';
  EXCEPTION
    WHEN duplicate_object THEN RAISE NOTICE 'dev_flags already in supabase_realtime';
    WHEN undefined_object THEN RAISE NOTICE 'publication supabase_realtime missing — enable Realtime first';
    WHEN OTHERS THEN RAISE NOTICE 'publish skipped for dev_flags: %', SQLERRM;
  END;
END $$;

-- =============================================================
-- DONE.
--
-- Verify:
--   SELECT * FROM dev_flags;                          -- dispatch_bypass = false
--   SELECT dev_dispatch_bypass();                     -- false
--   SELECT set_dispatch_bypass(true);                 -- as admin → then:
--   SELECT dev_dispatch_bypass();                     -- true
--   SELECT tablename FROM pg_publication_tables
--    WHERE pubname = 'supabase_realtime' AND tablename IN ('dev_flags','port_queue');
-- =============================================================
