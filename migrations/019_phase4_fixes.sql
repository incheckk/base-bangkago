-- =============================================================
-- 019 — PHASE 4 FIX PASS (P0/P1 leftovers)
--
-- Run this in Supabase SQL Editor AFTER applying the app code that
-- ships with it (018_login_fix.sql runs FIRST, on its own).
--
--   1. passenger_details_select_operator — the bangkero running a trip
--      could not read the companion rows booked on it (003 gave SELECT
--      only to the passenger, admin and service role). Manifest-facing
--      screens join this table; without the policy they render blanks.
--
--   2. assign_next_hold — SECURITY DEFINER with EXECUTE granted to
--      PUBLIC (Postgres default): anon could call it straight over
--      PostgREST and rewrite held_by / hold_expires_at on any open
--      booking. Add the same auth.uid() guard every sibling function
--      already has, and revoke the public/anon EXECUTE grants.
--
--   3. downpayments — 015 created rows without a uniqueness rule, so a
--      double-tap filed two escrows for one booking/rental and the
--      admin screen showed the same money twice. Partial UNIQUE
--      indexes make the second insert fail loudly instead.
--
--   4. boat_rentals — one live charter per boat per day: the createRental
--      pre-check only sees the renter's own rows (RLS), so a second
--      renter could still race in. The partial UNIQUE index is the
--      real guarantee (error 23505 maps to the friendly message).
--
--   5. Package 3 stops — 'Nalusuan via Caohagan Express' booked
--      mactan-pier-1 → caohagan (stops had Nalusuan in the middle), so
--      the passenger paid the Nalusuan express but the resolved route
--      ended at Caohagan. Reorder stops to pier 1 → Caohagan →
--      Nalusuan: the name, description and resolved route
--      (mactan-pier-1__nalusuan, seeded in 002) then all agree.
--
-- Run AFTER 018_login_fix.sql.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Bangkero reads companion details of bookings they operate.
-- -------------------------------------------------------------
DROP POLICY IF EXISTS "passenger_details_select_operator" ON passenger_details;
CREATE POLICY "passenger_details_select_operator" ON passenger_details
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM bookings b WHERE b.id = booking_id AND b.operator_id = auth.uid()
  ));

-- -------------------------------------------------------------
-- 2. assign_next_hold: same guard as refresh_holds / accept_booking_hold
--    (008) and mark_paid (012), plus explicit EXECUTE grants. Body is
--    010's version verbatim with only the guard added.
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

REVOKE EXECUTE ON FUNCTION assign_next_hold(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION assign_next_hold(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION assign_next_hold(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION assign_next_hold(UUID) TO service_role;

-- -------------------------------------------------------------
-- 3. One escrow row per booking / per rental.
-- -------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS downpayments_one_per_booking
  ON downpayments (booking_id) WHERE booking_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS downpayments_one_per_rental
  ON downpayments (boat_rental_id) WHERE boat_rental_id IS NOT NULL;

-- -------------------------------------------------------------
-- 4. One live charter per boat per day.
-- -------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS boat_rentals_one_live_per_day
  ON boat_rentals (bangka_id, rental_date) WHERE status IN ('pending', 'confirmed');

-- -------------------------------------------------------------
-- 5. Package 3 itinerary order.
-- -------------------------------------------------------------
UPDATE island_packages
SET stops = '["mactan-pier-1","caohagan","nalusuan"]'::jsonb
WHERE package_name = 'Nalusuan via Caohagan Express'
  AND stops <> '["mactan-pier-1","caohagan","nalusuan"]'::jsonb;

-- =============================================================
-- DONE.
--
-- Verify:
--   SELECT package_name, stops FROM island_packages ORDER BY price;
--     -- package 3: mactan-pier-1, caohagan, nalusuan (in that order)
--   SELECT indexname FROM pg_indexes
--    WHERE tablename IN ('downpayments', 'boat_rentals');
--     -- downpayments_one_per_booking, downpayments_one_per_rental,
--     -- boat_rentals_one_live_per_day
--   SELECT p.prosecdef, p.proacl FROM pg_proc p
--    WHERE p.proname = 'assign_next_hold';
--     -- proacl must NOT contain =X/anonymous
--   -- Then as a signed-in bangkero: open an accepted trip's Departure
--   -- screen — companion rows now select (policy 1).
-- =============================================================
