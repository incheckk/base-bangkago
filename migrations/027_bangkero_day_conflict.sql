-- =============================================================
-- 027 — LISTED BOATS + WHOLE-DAY BOOKING CONFLICT
--
-- 1. bangkas.rental_listed — opt-in visibility: a bangkero puts their
--    boat into the passenger Boat Rental catalog from the Boat
--    Rentals screen. Existing boats are backfilled to true (the
--    catalog showed every verified boat before, so nothing vanishes);
--    newly registered boats start unlisted.
-- 2. One committed day per bangkero: once a booking is accepted or a
--    charter is live for a date, the bangkero cannot take any other
--    ride / island-hop / charter for that date, and new charters for
--    that operator are refused at insert. Enforced with triggers so
--    every write path is covered (accept_booking_hold, confirmRental,
--    direct inserts) — no client-side race possible.
--    Day = scheduled_date, or today for same-day trips (NULL date).
--    Charter statuses counted match boat_rentals_one_live_per_day
--    (020): awaiting_payment, pending, confirmed.
-- 3. bangka_blocked_dates — read for the rental-form date chips
--    (RLS hides other renters' rows from a browsing passenger, so the
--    blocked dates come from this SECURITY DEFINER RPC; it returns
--    dates only — no PII).
-- =============================================================

-- -------------------------------------------------------------
-- 1. Opt-in listing for the passenger catalog.
-- -------------------------------------------------------------
ALTER TABLE bangkas ADD COLUMN IF NOT EXISTS rental_listed BOOLEAN NOT NULL DEFAULT false;
UPDATE bangkas SET rental_listed = true;

-- -------------------------------------------------------------
-- 2. Day-conflict helper. SECURITY DEFINER: the check must see every
--    row regardless of who is writing (a passenger inserting a
--    charter cannot read the operator's other rentals under RLS).
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION has_day_conflict(
  p_bangkero UUID,
  p_day DATE,
  p_ignore_booking UUID DEFAULT NULL,
  p_ignore_rental UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.operator_id = p_bangkero
      AND b.trip_stat = 'accepted'
      AND b.id IS DISTINCT FROM p_ignore_booking
      AND COALESCE(b.scheduled_date, (now() AT TIME ZONE 'Asia/Manila')::date) = p_day
  )
  OR EXISTS (
    SELECT 1
    FROM boat_rentals r
    JOIN bangkas bk ON bk.id = r.bangka_id
    WHERE bk.bangkero_id = p_bangkero
      AND r.status IN ('awaiting_payment', 'pending', 'confirmed')
      AND r.id IS DISTINCT FROM p_ignore_rental
      AND r.rental_date = p_day
  );
$$;

REVOKE ALL ON FUNCTION has_day_conflict(UUID, DATE, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION has_day_conflict(UUID, DATE, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION has_day_conflict(UUID, DATE, UUID, UUID) TO service_role;

-- One trigger function for both tables: bookings block on entering
-- 'accepted', rentals block at insert and on entering 'confirmed'
-- (admin approval into 'pending' is never refused — decline/refund is
-- the way out if the day got taken meanwhile).
CREATE OR REPLACE FUNCTION enforce_bangkero_day_free()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_bangkero UUID;
  v_day DATE;
BEGIN
  IF TG_TABLE_NAME = 'bookings' THEN
    v_bangkero := NEW.operator_id;
    v_day := COALESCE(NEW.scheduled_date, (now() AT TIME ZONE 'Asia/Manila')::date);
    IF has_day_conflict(v_bangkero, v_day, NEW.id, NULL) THEN
      RAISE EXCEPTION 'You already have a booking or charter scheduled on that date.';
    END IF;
  ELSE
    SELECT bk.bangkero_id INTO v_bangkero
    FROM bangkas bk WHERE bk.id = NEW.bangka_id;
    v_day := NEW.rental_date;
    IF has_day_conflict(v_bangkero, v_day, NULL, NEW.id) THEN
      RAISE EXCEPTION 'That date is already booked for this boat''s operator.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bookings_day_conflict ON bookings;
CREATE TRIGGER trg_bookings_day_conflict
  BEFORE UPDATE OF trip_stat ON bookings
  FOR EACH ROW
  WHEN (NEW.trip_stat = 'accepted'
        AND OLD.trip_stat IS DISTINCT FROM 'accepted')
  EXECUTE FUNCTION enforce_bangkero_day_free();

DROP TRIGGER IF EXISTS trg_rentals_day_conflict_insert ON boat_rentals;
CREATE TRIGGER trg_rentals_day_conflict_insert
  BEFORE INSERT ON boat_rentals
  FOR EACH ROW
  WHEN (NEW.status IN ('awaiting_payment', 'pending', 'confirmed'))
  EXECUTE FUNCTION enforce_bangkero_day_free();

DROP TRIGGER IF EXISTS trg_rentals_day_conflict_confirm ON boat_rentals;
CREATE TRIGGER trg_rentals_day_conflict_confirm
  BEFORE UPDATE OF status ON boat_rentals
  FOR EACH ROW
  WHEN (NEW.status = 'confirmed'
        AND OLD.status IS DISTINCT FROM 'confirmed')
  EXECUTE FUNCTION enforce_bangkero_day_free();

REVOKE ALL ON FUNCTION enforce_bangkero_day_free() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION enforce_bangkero_day_free() TO authenticated;
GRANT EXECUTE ON FUNCTION enforce_bangkero_day_free() TO service_role;

-- -------------------------------------------------------------
-- 3. Blocked dates for one boat — powers the dehighlighted chips in
--    the rental form: charters already on this boat + days the
--    operator already committed to (accepted trips).
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION bangka_blocked_dates(p_bangka_id UUID)
RETURNS TABLE (blocked_date DATE)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.rental_date
  FROM boat_rentals r
  WHERE r.bangka_id = p_bangka_id
    AND r.status IN ('awaiting_payment', 'pending', 'confirmed')
  UNION
  SELECT COALESCE(b.scheduled_date, (now() AT TIME ZONE 'Asia/Manila')::date)
  FROM bookings b
  JOIN bangkas bk ON bk.id = p_bangka_id
  WHERE b.operator_id = bk.bangkero_id
    AND b.trip_stat = 'accepted';
$$;

REVOKE ALL ON FUNCTION bangka_blocked_dates(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION bangka_blocked_dates(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION bangka_blocked_dates(UUID) TO service_role;

-- -------------------------------------------------------------
-- Verify:
--   SELECT rental_listed FROM bangkas;                 -- true (backfill)
--   SELECT bangka_blocked_dates('<bangka id>');         -- dates only
--   -- as a bangkero with an accepted Oct 9 trip, accepting a
--   -- second Oct 9 booking must raise the conflict message.
-- -------------------------------------------------------------
