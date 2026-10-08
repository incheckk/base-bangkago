-- =============================================================
-- 023 — C6 / C3 / C8 code TODOs (LAUNCH_DEFERRED_FEATURES [C])
--
-- C6. payments.payment_status drops 'refunded' — refunds live only on
--     downpayments (015) now; no code path writes 'refunded' to
--     payments. Any legacy row is mapped to 'failed' first so the
--     constraint change cannot fail.
-- C3. bookings_one_active_per_passenger — verify-then-create: the
--     unique index stays OFF if any passenger still holds 2+
--     open/accepted bookings (legacy demo rows), with a NOTICE.
-- C8. bookings.depart_time / arrival_time are stamped through
--     SECURITY DEFINER RPCs (the 004 bangkero UPDATE policy only
--     allows trip_stat='completed', so a direct partial update of a
--     depart time is rejected):
--       * stamp_booking_depart() — operator stamps on Ready to Depart;
--       * complete_trip() re-defined to stamp arrival_time (and
--         depart_time if it is still null) with the completion.
--
-- Run manually in the SQL editor, in numeric order (D2).
-- Run AFTER 022. NEVER re-run 017 or 021 after this.
-- =============================================================

-- -------------------------------------------------------------
-- C6 — payments CHECK without 'refunded'
-- -------------------------------------------------------------
UPDATE payments SET payment_status = 'failed' WHERE payment_status = 'refunded';

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_payment_status_check;
ALTER TABLE payments
  ADD CONSTRAINT payments_payment_status_check
  CHECK (payment_status IN ('pending', 'completed', 'failed'));

-- -------------------------------------------------------------
-- C3 — one open/accepted booking per passenger (verify-then-create)
-- -------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT user_id FROM bookings
    WHERE trip_stat IN ('open', 'accepted')
    GROUP BY user_id
    HAVING count(*) > 1
  ) THEN
    RAISE NOTICE 'C3 SKIPPED: legacy rows violate one-active-per-passenger — clean them, then run this index by hand';
  ELSE
    CREATE UNIQUE INDEX bookings_one_active_per_passenger
      ON bookings (user_id) WHERE trip_stat IN ('open', 'accepted');
  END IF;
END $$;

-- -------------------------------------------------------------
-- C8 — depart stamp: operator, accepted. Refreshing an existing stamp
-- is harmless (Ready to Depart fires once) but must not error on a
-- re-run, so the WHERE keeps the accepted/operator guards only.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION stamp_booking_depart(p_booking_id UUID)
RETURNS VOID AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  UPDATE public.bookings
  SET depart_time = now()
  WHERE id = p_booking_id
    AND trip_stat = 'accepted'
    AND operator_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'this trip changed';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION stamp_booking_depart(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION stamp_booking_depart(UUID) TO authenticated;

-- -------------------------------------------------------------
-- C8 — complete_trip (022 copy) also stamps arrival_time
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
      completed_at = now(),
      arrival_time = now(),
      depart_time = COALESCE(depart_time, now())
  WHERE id = p_booking_id
    AND trip_stat = 'accepted';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'this trip changed';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';
