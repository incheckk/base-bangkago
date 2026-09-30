-- =============================================================
-- 012 — MARK AS PAID (Phase 3B)
--
-- The fare is collected on board (cash or GCash). Passengers book
-- without paying — createPayment now records 'pending' for both
-- methods — and the bangkero marks the trip paid once everyone is
-- aboard, in Departure or in the Manifest.
--
--   * mark_paid(p_booking_id, p_reference?) — SECURITY DEFINER;
--     only the bookings' operator may call it. Upserts the payment
--     row to 'completed', keeping the method the passenger chose
--     and storing an optional reference number (GCash ref, receipt
--     no.). READ is granted below — the bangkero could write a row
--     they were never allowed to see.
--
--   * payments SELECT for the trip's operator — Departure/Manifest
--     show Paid/Pending per booking; until now only the passenger
--     (payments_select_own, 002) and admin (004) could read.
--
--   * payments into the realtime publication — the passenger's
--     booking screen flips Pending → Paid live.
--
-- REMOVE before public launch if the demo tooling is dropped — see
-- LAUNCH_DEFERRED_FEATURES.txt.
-- =============================================================

-- 1. Bangkero read: rows whose booking they operate.
DROP POLICY IF EXISTS "payments_select_operator" ON payments;
CREATE POLICY "payments_select_operator" ON payments
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM bookings b WHERE b.id = booking_id AND b.operator_id = auth.uid()
  ));

-- 2. The writer. Caller must be the trip's operator; the payment row
--    keeps whatever method the passenger picked at booking time.
CREATE OR REPLACE FUNCTION mark_paid(p_booking_id UUID, p_reference TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v bookings%ROWTYPE;
  v_method TEXT;
  v_updated INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v FROM bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no booking with this trip';
  END IF;

  IF v.operator_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'you do not have permission to do that';
  END IF;

  -- Keep the passenger's chosen method; a booking booked before the
  -- payment row existed defaults to cash.
  SELECT p.payment_method INTO v_method
  FROM payments p
  WHERE p.booking_id = p_booking_id
  LIMIT 1;
  IF v_method IS NULL THEN
    v_method := 'cash';
  END IF;

  UPDATE payments
  SET payment_status = 'completed',
      reference_num = COALESCE(NULLIF(trim(p_reference), ''), reference_num)
  WHERE booking_id = p_booking_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    INSERT INTO payments (booking_id, amount, payment_method, payment_status, reference_num)
    VALUES (p_booking_id, v.total_price, v_method, 'completed', NULLIF(trim(p_reference), ''));
  END IF;
END;
$$;

-- 3. Realtime — Pending → Paid flips on the passenger's screen now.
DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER TABLE public.payments REPLICA IDENTITY FULL';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'replica identity skipped for payments: %', SQLERRM;
  END;
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.payments';
  EXCEPTION
    WHEN duplicate_object THEN RAISE NOTICE 'payments already in supabase_realtime';
    WHEN undefined_object THEN RAISE NOTICE 'publication supabase_realtime missing — enable Realtime first';
    WHEN OTHERS THEN RAISE NOTICE 'publish skipped for payments: %', SQLERRM;
  END;
END $$;

-- =============================================================
-- DONE.
--
-- Verify:
--   SELECT mark_paid('<accepted booking id>', 'GCASH-REF-1');
--   SELECT booking_id, payment_status, reference_num FROM payments
--    WHERE booking_id = '<accepted booking id>';
--   SELECT tablename FROM pg_publication_tables
--    WHERE pubname = 'supabase_realtime' AND tablename = 'payments';
-- =============================================================
