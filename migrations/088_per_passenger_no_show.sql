-- =============================================================
-- 088 — Per-passenger no-show
-- Run AFTER 087_booking_intent_id.sql (also needs 083's guard
-- trigger, which allows operator boarding writes after departure).
--
-- The bangkero now picks exactly who missed the boat instead of
-- marking the whole party:
--   * boarding a row after depart_time is refused (085 already
--     closed the booker/QR paths; this closes companions);
--   * a scanned boarding can no longer be silently un-scanned by
--     marking the same companion 'not_boarded';
--   * a companion left behind lands on the BOOKER's record
--     (bookings.no_show_at -> ban + notice) while onboarded_at
--     stays set, because the booker did sail.
--
-- mark_no_show stays strictly single-row: other accepted bookings
-- on the same boat keep their seats, hold and manifest rows.
-- =============================================================

BEGIN;

-- -------------------------------------------------------------
-- 1. Companion boarding tick
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_passenger_boarded(
  p_detail_id uuid, p_state text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_detail  public.passenger_details%ROWTYPE;
  v_booking public.bookings%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_state NOT IN ('boarded', 'not_boarded', 'pending') THEN
    RAISE EXCEPTION 'bad state';
  END IF;

  SELECT * INTO v_detail
  FROM public.passenger_details
  WHERE id = p_detail_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'this trip changed';
  END IF;

  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = v_detail.booking_id
    AND trip_stat = 'accepted'
    AND operator_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'this trip changed';
  END IF;

  IF p_state IN ('boarded', 'pending') AND v_booking.depart_time IS NOT NULL THEN
    RAISE EXCEPTION 'This trip has already sailed — boarding is closed.';
  END IF;
  IF p_state = 'not_boarded' AND v_detail.boarded_at IS NOT NULL THEN
    RAISE EXCEPTION 'This passenger already boarded — a scanned boarding cannot be undone here.';
  END IF;

  UPDATE public.passenger_details
  SET boarded_at = CASE WHEN p_state = 'boarded' THEN now() END,
      no_show_at = CASE WHEN p_state = 'not_boarded' THEN now() END
  WHERE id = p_detail_id;

  -- The booker sailed but a companion did not: the booker carries the
  -- no-show ban and notification, exactly as if the whole party missed.
  IF p_state = 'not_boarded' AND v_booking.onboarded_at IS NOT NULL THEN
    UPDATE public.bookings
    SET no_show_at = COALESCE(no_show_at, now())
    WHERE id = v_booking.id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_passenger_boarded(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_passenger_boarded(uuid, text)
  TO authenticated, service_role;

-- -------------------------------------------------------------
-- 2. Booker absent while companions sail
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_booker_absent(p_booking_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  UPDATE public.bookings
  SET no_show_at = COALESCE(no_show_at, now()),
      onboarded_at = NULL
  WHERE id = p_booking_id
    AND trip_stat = 'accepted'
    AND operator_id = auth.uid()
    AND onboarded_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'this trip changed';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_booker_absent(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_booker_absent(UUID)
  TO authenticated, service_role;

-- -------------------------------------------------------------
-- 3. Whole-booking no-show
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_no_show(
  p_booking_id UUID, p_reason TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  UPDATE public.bookings
  SET trip_stat = 'cancelled',
      cancelled_at = now(),
      no_show_at = now(),
      cancel_reason = COALESCE(
        p_reason,
        'Passenger(s) did not board — marked no-show by the bangkero.'
      )
  WHERE id = p_booking_id
    AND trip_stat = 'accepted'
    AND operator_id = auth.uid()
    AND onboarded_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'this trip changed';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_no_show(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_no_show(UUID, TEXT)
  TO authenticated, service_role;

COMMIT;
