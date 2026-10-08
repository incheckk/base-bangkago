-- =============================================================
-- 022 — dispute + per-passenger no-show granularity
--
-- Bug fixes (all-in-one build):
--   1. "I'm NOT on board" used to CANCEL the whole bookings row even
--      though the boat had already left — the trip could never complete.
--      Now a group dispute stamps bookings.disputed_at only: the rest
--      of the party sails, the trip completes normally, the safety
--      alert and rating penalty still fire client-side.
--   2. The bangkero's no-show used to cancel the whole group when a
--      single passenger was missing. mark_booker_absent() keeps the
--      booking accepted when SOME of the party sailed; the client
--      only calls mark_no_show (cancel) when nobody boarded at all.
--   3. complete_trip must accept a disputed/absent booker — their
--      onboarded_at stays NULL, which used to block completion.
--
-- Run manually in the SQL editor, in numeric order (AGENTS/D2).
-- NEVER re-run 017 or 021 after this.
-- =============================================================

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS disputed_at TIMESTAMPTZ;

-- -------------------------------------------------------------
-- Passenger-side group dispute: mark ONLY the reporter absent.
-- Own accepted row, once. Does not touch trip_stat — the booking
-- and every other passenger are unaffected.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION dispute_boarding(p_booking_id UUID)
RETURNS VOID AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  UPDATE public.bookings
  SET disputed_at = now(),
      onboarded_at = NULL
  WHERE id = p_booking_id
    AND user_id = auth.uid()
    AND trip_stat = 'accepted'
    AND disputed_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'this trip cannot be disputed';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION dispute_boarding(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION dispute_boarding(UUID) TO authenticated;

-- -------------------------------------------------------------
-- Bangkero-side partial no-show: the booker missed the boat but
-- the rest of the party sailed. Stamps no_show_at (feeding the
-- ban) WITHOUT cancelling — trip_stat stays 'accepted'.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION mark_booker_absent(p_booking_id UUID)
RETURNS VOID AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  UPDATE public.bookings
  SET no_show_at = COALESCE(no_show_at, now()),
      onboarded_at = NULL
  WHERE id = p_booking_id
    AND trip_stat = 'accepted'
    AND operator_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'this trip changed';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION mark_booker_absent(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mark_booker_absent(UUID) TO authenticated;

-- -------------------------------------------------------------
-- complete_trip (007) re-defined: allow completion when the booker
-- was disputed or marked absent — those never stamp onboarded_at.
-- Everything else in 007's gate is unchanged.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION complete_trip(p_booking_id UUID)
RETURNS VOID AS $$
DECLARE
  v public.bookings%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  SELECT * INTO v FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND OR v.trip_stat <> 'accepted'
     OR v.operator_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'this trip changed';
  END IF;
  IF v.onboarded_at IS NULL
     AND v.disputed_at IS NULL
     AND v.no_show_at IS NULL THEN
    RAISE EXCEPTION 'confirm passengers on board before completing this trip';
  END IF;
  UPDATE public.bookings
  SET trip_stat = 'completed',
      completed_at = now()
  WHERE id = p_booking_id
    AND trip_stat = 'accepted';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'this trip changed';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';
