-- =============================================================
-- 062 — Booking rules v3 (passenger per-day rule + bangkero multi-accept)
--
-- 1. Bangkero multi-accept. 027's trigger refused a SECOND accepted
--    booking on the same calendar day — which blocked the whole point
--    of accepting several bookings until the boat is full. Drop that
--    trigger. Route and capacity are already enforced server-side by
--    008's route_ok() and fits_booking() inside accept_booking_hold,
--    so a bangkero can now fill their boat with same-route bookings.
--    has_day_conflict() and the rental triggers stay untouched: a
--    charter still can't be booked on a day the operator has trips.
--
-- 2. Passenger per-day rule. 023's partial unique index allowed ONE
--    active booking per passenger ever. Replace with a trigger (an
--    index can't call now(), and same-day rows carry today's date):
--      * at most one active SAME-DAY booking;
--      * advance bookings clash only on the same date AND slot —
--        same date with a different sailing time is allowed.
--    Occupying statuses: pending (advance awaiting escrow), open,
--    accepted.
--
-- Run manually in the SQL editor, after 056.
-- No demo reset.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Bangkero: allow multiple accepted bookings per day.
-- -------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_bookings_day_conflict ON bookings;

-- -------------------------------------------------------------
-- 2. Passenger per-day rule.
-- -------------------------------------------------------------
DROP INDEX IF EXISTS bookings_one_active_per_passenger;

CREATE OR REPLACE FUNCTION enforce_passenger_booking_slot()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'Asia/Manila')::date;
  v_day DATE := COALESCE(NEW.scheduled_date, v_today);
  v_same_day BOOLEAN := v_day <= v_today;
  v_clash INTEGER;
BEGIN
  SELECT count(*) INTO v_clash
  FROM bookings b
  WHERE b.user_id = NEW.user_id
    AND b.id <> NEW.id
    AND b.trip_stat IN ('pending', 'open', 'accepted')
    AND COALESCE(b.scheduled_date, v_today) = v_day
    AND (v_same_day OR b.scheduled_time IS NOT DISTINCT FROM NEW.scheduled_time);

  IF v_clash > 0 THEN
    IF v_same_day THEN
      RAISE EXCEPTION 'You already have a same-day booking. Finish or cancel it first.';
    ELSE
      RAISE EXCEPTION 'You already have an advance booking for that date and sailing time.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bookings_passenger_slot ON bookings;
CREATE TRIGGER trg_bookings_passenger_slot
  BEFORE INSERT OR UPDATE OF trip_stat, scheduled_date, scheduled_time ON bookings
  FOR EACH ROW
  WHEN (NEW.trip_stat IN ('pending', 'open', 'accepted'))
  EXECUTE FUNCTION enforce_passenger_booking_slot();

REVOKE ALL ON FUNCTION enforce_passenger_booking_slot() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION enforce_passenger_booking_slot() TO authenticated;
GRANT EXECUTE ON FUNCTION enforce_passenger_booking_slot() TO service_role;

-- Verify:
--   -- trg_bookings_day_conflict and bookings_one_active_per_passenger gone
--   SELECT tgname FROM pg_trigger WHERE tgrelid = 'bookings'::regclass;
--   -- a 2nd same-day booking must raise; a 2nd advance on another
--   -- date/slot must succeed.
