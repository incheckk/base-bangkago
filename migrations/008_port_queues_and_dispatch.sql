-- =============================================================
-- BangkaGo — Port Queues & FCFS Dispatch (Phase 2)
-- Run this in Supabase SQL Editor AFTER 007_accepted_trip_rules.sql
--
-- First-come-first-serve is preserved end to end: boats queue at a
-- port in the order they entered its GPS perimeter, and every open
-- request departing that port is HELD for the first eligible boat in
-- the queue for 3 minutes before it cascades to the next one.
--
-- Contents:
--   1. ports.geofence_radius_m (default 300m, admin-tunable)
--   2. port_queue — one active row per boat (cross-port exclusive)
--   3. bookings.held_by + hold_expires_at — the dispatch hold
--   4. haversine_m / dispatch_eligible / route_ok / fits_booking
--   5. report_boat_position — GPS fix + presence sync (one call)
--   6. assign_next_hold / refresh_holds — FCFS hold cascade
--   7. accept_booking_hold — every gate enforced server-side
--   8. decline_booking_hold — decline + cascade in one write
--   9. RLS + realtime for port_queue
--
-- The app calls report_boat_position every ~10s while a bangkero has
-- the app open (foreground only for now), assign_next_hold right after
-- a booking is created, refresh_holds when the open-requests list
-- loads, and accept/decline_booking_hold from the request cards.
-- =============================================================

-- =============================================================
-- 1. ports.geofence_radius_m
--
-- How far from the port center a boat's fix may be and still count
-- as "parked here". 300m covers the pier plus the water immediately
-- off it without counting boats still circling offshore.
-- =============================================================
ALTER TABLE ports ADD COLUMN IF NOT EXISTS geofence_radius_m INTEGER NOT NULL DEFAULT 300;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ports_geofence_radius_m_check'
  ) THEN
    ALTER TABLE ports ADD CONSTRAINT ports_geofence_radius_m_check
      CHECK (geofence_radius_m >= 50 AND geofence_radius_m <= 5000);
  END IF;
END $$;

-- =============================================================
-- 2. port_queue
--
-- One row per arrival at a port. left_at IS NULL means the boat is
-- inside the perimeter right now; the moment its fix lands outside,
-- report_boat_position closes the row. The partial unique index is
-- what makes membership EXCLUSIVE — a boat can never sit on two
-- port lists at once (the user's Mactan → Olango rule).
--
-- entered_at is the FCFS clock: it is recorded at first entry and
-- survives the 60s jitter grace, so a GPS blip never demotes a
-- parked boat to the back of the line.
-- =============================================================
CREATE TABLE IF NOT EXISTS port_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  port_id TEXT NOT NULL REFERENCES ports(id),
  bangkero_id UUID NOT NULL REFERENCES bangkeros(id),
  entered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS port_queue_one_active_per_bangkero
  ON port_queue (bangkero_id) WHERE left_at IS NULL;

CREATE INDEX IF NOT EXISTS port_queue_active_port
  ON port_queue (port_id, entered_at) WHERE left_at IS NULL;

-- =============================================================
-- 3. bookings dispatch hold
--
-- held_by        — whose offer the request is sitting on right now
-- hold_expires_at— when it cascades to the next boat (3 minutes)
-- =============================================================
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS held_by UUID REFERENCES bangkeros(id);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS hold_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS bookings_open_dispatch
  ON bookings (id) WHERE trip_stat = 'open';

-- =============================================================
-- 4. Helpers
-- =============================================================

-- Great-circle distance in meters.
CREATE OR REPLACE FUNCTION haversine_m(
  p_lat1 NUMERIC, p_lng1 NUMERIC, p_lat2 NUMERIC, p_lng2 NUMERIC
) RETURNS DOUBLE PRECISION
LANGUAGE sql IMMUTABLE AS $$
  SELECT 6371000.0 * 2 * asin(
    LEAST(1.0, sqrt(
      power(sin(radians(p_lat2::DOUBLE PRECISION - p_lat1::DOUBLE PRECISION) / 2), 2)
      + cos(radians(p_lat1::DOUBLE PRECISION))
        * cos(radians(p_lat2::DOUBLE PRECISION))
        * power(sin(radians(p_lng2::DOUBLE PRECISION - p_lng1::DOUBLE PRECISION) / 2), 2)
    ))
  );
$$;

-- A boat may receive a hold at a port only when it is queued there,
-- its 5-minute dwell has passed, its availability is on, and it has
-- reported a GPS fix in the last 3 minutes (the fix and the queue row
-- are written together, so a fresh fix implies it is still inside).
CREATE OR REPLACE FUNCTION dispatch_eligible(p_bangkero UUID, p_port TEXT)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
      SELECT 1 FROM port_queue pq
      WHERE pq.bangkero_id = p_bangkero
        AND pq.port_id = p_port
        AND pq.left_at IS NULL
        AND pq.entered_at <= now() - INTERVAL '5 minutes'
    )
    AND EXISTS (
      SELECT 1 FROM bangkeros b
      WHERE b.id = p_bangkero AND b.is_available
    )
    AND EXISTS (
      SELECT 1 FROM vessel_tracking vt
      JOIN bangkas bk ON bk.id = vt.bangka_id
      WHERE bk.bangkero_id = p_bangkero
        AND vt.recorded_at > now() - INTERVAL '3 minutes'
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Route lock: while ANY of the boat's trips is accepted to a different
-- destination, no new booking to another destination can be accepted.
-- A mixed legacy set (two destinations already) locks the boat out of
-- everything until those trips clear — safe by construction.
CREATE OR REPLACE FUNCTION route_ok(p_bangkero UUID, p_dest TEXT)
RETURNS BOOLEAN AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM bookings b
    JOIN routes r ON r.id = b.route_id
    WHERE b.operator_id = p_bangkero
      AND b.trip_stat = 'accepted'
      AND r.end_port_id <> p_dest
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Fit-check: the boat's capacity must hold this booking plus
-- everything already accepted. Rentals take the whole boat — skipped.
CREATE OR REPLACE FUNCTION fits_booking(p_bangkero UUID, p_service TEXT, p_pax INT)
RETURNS BOOLEAN AS $$
  SELECT p_service = 'rental'
    OR COALESCE((
      SELECT k.capacity FROM bangkas k
      WHERE k.bangkero_id = p_bangkero
      ORDER BY k.id LIMIT 1
    ), 0) >= p_pax + COALESCE((
      SELECT SUM(b.num_of_passenger) FROM bookings b
      WHERE b.operator_id = p_bangkero AND b.trip_stat = 'accepted'
    ), 0);
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- =============================================================
-- 5. report_boat_position
--
-- One round trip per GPS tick: log the fix, then sync presence.
--   inside a perimeter  → open (or reopen) this port's row
--   outside             → close it
--   inside ANOTHER port → close the old row, open the new one
-- Re-entering the SAME port within 60s reopens the original row with
-- its entered_at intact — GPS jitter cannot shuffle the FCFS order,
-- while a boat truly gone for over a minute re-queues with a fresh
-- 5-minute dwell (the drive-by guard).
-- =============================================================
CREATE OR REPLACE FUNCTION report_boat_position(
  p_lat NUMERIC, p_lng NUMERIC, p_speed NUMERIC DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
  v_bangka UUID;
  v_active port_queue%ROWTYPE;
  v_recent port_queue%ROWTYPE;
  v_port ports%ROWTYPE;
  v_now TIMESTAMPTZ := now();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- One boat per bangkero (profile.service upserts a single row).
  SELECT id INTO v_bangka
  FROM bangkas
  WHERE bangkero_id = auth.uid()
  ORDER BY id
  LIMIT 1;
  IF v_bangka IS NULL THEN
    RAISE EXCEPTION 'no bangka registered for this bangkero';
  END IF;

  INSERT INTO vessel_tracking (latitude, longitude, speed, bangka_id)
  VALUES (p_lat, p_lng, p_speed, v_bangka);

  SELECT * INTO v_active
  FROM port_queue
  WHERE bangkero_id = auth.uid() AND left_at IS NULL;

  -- Which perimeter (if any) contains this fix?
  SELECT * INTO v_port
  FROM ports
  WHERE is_active
    AND latitude IS NOT NULL
    AND longitude IS NOT NULL
    AND haversine_m(p_lat, p_lng, latitude, longitude) <= geofence_radius_m
  ORDER BY haversine_m(p_lat, p_lng, latitude, longitude)
  LIMIT 1;

  IF v_port.id IS NULL THEN
    -- Outside every perimeter: off the list.
    IF v_active.id IS NOT NULL THEN
      UPDATE port_queue SET left_at = v_now WHERE id = v_active.id;
    END IF;
    RETURN;
  END IF;

  IF v_active.id IS NOT NULL AND v_active.port_id = v_port.id THEN
    RETURN; -- already on this port's list
  END IF;

  -- Jitter grace: a row closed at THIS port within the last 60s is
  -- reopened with entered_at preserved (FCFS order survives the blip).
  SELECT * INTO v_recent
  FROM port_queue
  WHERE bangkero_id = auth.uid()
    AND port_id = v_port.id
    AND left_at IS NOT NULL
    AND left_at > v_now - INTERVAL '60 seconds'
  ORDER BY left_at DESC
  LIMIT 1;

  -- Cross-port exclusivity: whatever row is open must close first.
  UPDATE port_queue
  SET left_at = v_now
  WHERE bangkero_id = auth.uid() AND left_at IS NULL;

  IF v_recent.id IS NOT NULL THEN
    UPDATE port_queue SET left_at = NULL WHERE id = v_recent.id;
  ELSE
    INSERT INTO port_queue (port_id, bangkero_id, entered_at)
    VALUES (v_port.id, auth.uid(), v_now);
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- =============================================================
-- 6. assign_next_hold / refresh_holds
--
-- The cascade: hold the request for the first eligible boat in FCFS
-- order; on decline or 3-minute expiry move to the next; when nobody
-- is eligible the hold is NULL (strict queue-only — the request waits
-- until a boat enters the perimeter).
--
-- An EXPIRED holder is appended to rejected_by: that is their turn
-- being over, it keeps the client's existing "hide acted requests"
-- filter working, and it stops the hold from ping-ponging back to
-- #1 every time #2 times out.
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

-- Sweep for every request whose hold is missing or expired. Called
-- when the open-requests list loads; a booking whose state would not
-- change produces only SELECTs (no UPDATE → no realtime event loop).
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
      AND (held_by IS NULL OR hold_expires_at IS NULL OR hold_expires_at <= now())
  LOOP
    PERFORM assign_next_hold(b);
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- =============================================================
-- 7. accept_booking_hold
--
-- Every gate lives here; the screen's disabled buttons are UX only.
-- Self-healing: if the hold is stale it cascades FIRST, so a boat
-- that taps accept the moment a hold expires takes over cleanly.
-- Each failure RAISEs a sentence friendlyAuthError passes through.
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

  IF NOT EXISTS (SELECT 1 FROM bangkeros b WHERE b.id = auth.uid()) THEN
    RAISE EXCEPTION 'not a registered bangkero';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM bangkeros b WHERE b.id = auth.uid() AND b.is_available
  ) THEN
    RAISE EXCEPTION 'you are offline — turn on availability to accept';
  END IF;

  -- Fresh fix = the presence sync proved the boat is still parked.
  IF NOT EXISTS (
    SELECT 1 FROM vessel_tracking vt
    JOIN bangkas bk ON bk.id = vt.bangka_id
    WHERE bk.bangkero_id = auth.uid()
      AND vt.recorded_at > now() - INTERVAL '3 minutes'
  ) THEN
    RAISE EXCEPTION 'your boat has no recent GPS position';
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
-- 8. decline_booking_hold
--
-- Append the caller (their uid only — no more arbitrary uid like
-- append_rejected_by), release the offer if they held it, and hand
-- it to the next boat in line. One write, one cascade.
-- =============================================================
CREATE OR REPLACE FUNCTION decline_booking_hold(p_booking_id UUID)
RETURNS VOID AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM bookings WHERE id = p_booking_id) THEN
    RETURN; -- vanished between render and tap — nothing to decline
  END IF;

  UPDATE bookings
  SET rejected_by = array_append(COALESCE(rejected_by, '{}'), auth.uid()),
      held_by = CASE WHEN held_by = auth.uid() THEN NULL ELSE held_by END,
      hold_expires_at = CASE WHEN held_by = auth.uid() THEN NULL ELSE hold_expires_at END
  WHERE id = p_booking_id
    AND trip_stat = 'open'
    AND NOT (COALESCE(rejected_by, '{}') @> ARRAY[auth.uid()]);

  PERFORM assign_next_hold(p_booking_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- =============================================================
-- 9. RLS + realtime
--
-- port_queue is world-readable to signed-in users (admins list every
-- port, passengers count theirs, bangkeros find their rank) but
-- writable ONLY through the SECURITY DEFINER functions above — no
-- INSERT/UPDATE/DELETE policies exist on purpose.
-- =============================================================
ALTER TABLE port_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "port_queue_select_all" ON port_queue;
CREATE POLICY "port_queue_select_all" ON port_queue
  FOR SELECT TO authenticated
  USING (true);

-- Realtime: chips, ranks and waiting counts live-update.
DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER TABLE public.port_queue REPLICA IDENTITY FULL';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'replica identity skipped for port_queue: %', SQLERRM;
  END;
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.port_queue';
  EXCEPTION
    WHEN duplicate_object THEN RAISE NOTICE 'port_queue already in supabase_realtime';
    WHEN undefined_object THEN RAISE NOTICE 'publication supabase_realtime missing — enable Realtime first';
    WHEN OTHERS THEN RAISE NOTICE 'publish skipped for port_queue: %', SQLERRM;
  END;
END $$;

-- =============================================================
-- DONE.
--
-- Verify:
--   SELECT tablename FROM pg_publication_tables
--    WHERE pubname = 'supabase_realtime' ORDER BY tablename;  -- includes port_queue
--   SELECT * FROM pg_constraint WHERE conname LIKE 'ports_geofence%';
-- =============================================================
