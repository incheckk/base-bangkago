-- =============================================================
-- 026 — RENTAL COMPANIONS + ARRIVAL CLOSE-OUT
--
-- 1. passenger_details can hang off a boat rental instead of a
--    booking (M5): rental-form captures companions, My Rentals and
--    the bangkero's charter desk read them. Exactly one owner
--    column is set, and the three RLS policies gain a rental
--    branch (renter reads/inserts; operator reads via bangkas).
-- 2. dev_flags.arrival_bypass (demo tooling, mirrors 009/010): the
--    arrived screen can close out a trip whose passengers were never
--    marked onboarded (stage shortcut — complete_trip refuses it).
--    Admin → Developer Options, server-enforced. Remove before
--    public launch — LAUNCH_DEFERRED_FEATURES.txt C7.
-- =============================================================

-- -------------------------------------------------------------
-- 1. boat_rental_id ownership on passenger_details.
--    booking_id becomes nullable; the CHECK keeps the XOR honest.
--    qr_token keeps its 020 DEFAULT, so rentals get tokens too.
-- -------------------------------------------------------------
ALTER TABLE passenger_details ALTER COLUMN booking_id DROP NOT NULL;

ALTER TABLE passenger_details
  ADD COLUMN IF NOT EXISTS boat_rental_id UUID REFERENCES boat_rentals(id) ON DELETE CASCADE;

ALTER TABLE passenger_details
  DROP CONSTRAINT IF EXISTS passenger_details_one_owner;
ALTER TABLE passenger_details
  ADD CONSTRAINT passenger_details_one_owner
  CHECK (num_nonnulls(booking_id, boat_rental_id) = 1);

-- RLS: owner branch — rides (bookings) OR charters (boat_rentals).
DROP POLICY IF EXISTS "passenger_details_select_own" ON passenger_details;
CREATE POLICY "passenger_details_select_own" ON passenger_details
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM bookings b WHERE b.id = booking_id AND b.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM boat_rentals r WHERE r.id = boat_rental_id AND r.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "passenger_details_insert_own" ON passenger_details;
CREATE POLICY "passenger_details_insert_own" ON passenger_details
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM bookings b WHERE b.id = booking_id AND b.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM boat_rentals r WHERE r.id = boat_rental_id AND r.user_id = auth.uid()
    )
  );

-- RLS: operator branch — trips they run OR charters on their boats.
DROP POLICY IF EXISTS "passenger_details_select_operator" ON passenger_details;
CREATE POLICY "passenger_details_select_operator" ON passenger_details
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM bookings b WHERE b.id = booking_id AND b.operator_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM boat_rentals r
      JOIN bangkas bk ON bk.id = r.bangka_id
      WHERE r.id = boat_rental_id AND bk.bangkero_id = auth.uid()
    )
  );

-- -------------------------------------------------------------
-- 2. Arrival-bypass flag — single-row pattern of 009/010.
--    ADD COLUMN backfills the existing row with false.
-- -------------------------------------------------------------
ALTER TABLE dev_flags ADD COLUMN IF NOT EXISTS arrival_bypass BOOLEAN NOT NULL DEFAULT false;

-- Reader used by force_complete_trip below. SECURITY DEFINER so RLS
-- can never hide the flag, COALESCE so a missing row reads as OFF.
CREATE OR REPLACE FUNCTION dev_arrival_bypass()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT arrival_bypass FROM dev_flags WHERE id = 1),
    false
  );
$$;

-- Admin-only writer — mirrors set_dispatch_bypass (009).
CREATE OR REPLACE FUNCTION set_arrival_bypass(p_on BOOLEAN)
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
  UPDATE dev_flags SET arrival_bypass = p_on WHERE id = 1;
END;
$$;

REVOKE ALL ON FUNCTION set_arrival_bypass(BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_arrival_bypass(BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION set_arrival_bypass(BOOLEAN) TO service_role;

-- -------------------------------------------------------------
-- 3. force_complete_trip — complete_trip (023) without the
--    onboarded requirement, and ONLY while the demo flag is on.
--    Same caller guard: the assigned bangkero, accepted booking.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION force_complete_trip(p_booking_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v public.bookings%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT dev_arrival_bypass() THEN
    RAISE EXCEPTION 'arrival bypass is off (Admin > Developer Options)';
  END IF;
  SELECT * INTO v FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND OR v.trip_stat <> 'accepted'
     OR v.operator_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'this trip changed';
  END IF;
  UPDATE public.bookings
  SET trip_stat = 'completed',
      completed_at = now(),
      arrival_time = now(),
      depart_time = COALESCE(depart_time, now())
  WHERE id = p_booking_id
    AND trip_stat = 'accepted';
END;
$$;

REVOKE ALL ON FUNCTION force_complete_trip(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION force_complete_trip(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION force_complete_trip(UUID) TO service_role;

-- -------------------------------------------------------------
-- Verify:
--   SELECT arrival_bypass FROM dev_flags WHERE id = 1;  -- false
--   SELECT set_arrival_bypass(true);                    -- as admin
--   SELECT dev_arrival_bypass();                        -- true
-- -------------------------------------------------------------
