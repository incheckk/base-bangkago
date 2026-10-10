-- =============================================================
-- 029 — MARK_PAID BOARDING GATE (audit #14)
--
-- mark_paid (012) flipped any operated booking to paid with no boarding
-- check — the sailing/departure "all aboard" gates were client-only and
-- bypassable by calling the RPC directly. This re-defines mark_paid with
-- the same guard complete_trip uses (023): the party must show a boarding
-- signal (onboarded / disputed / no-show-resolved) before money moves.
--
-- Nothing else changes: operator check, method keep, reference handling
-- and the upsert are verbatim from 012. Run manually in the SQL editor
-- after 028.
-- =============================================================

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

  -- Boarding gate (mirrors complete_trip, 023): no money moves for a
  -- party that was never marked on board, disputed, or no-show-resolved.
  IF v.onboarded_at IS NULL
     AND v.disputed_at IS NULL
     AND v.no_show_at IS NULL THEN
    RAISE EXCEPTION 'confirm boarding before collecting payment';
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

-- =============================================================
-- DONE.
--
-- Verify (as the trip's operator):
--   SELECT mark_paid('<accepted-but-never-boarded id>');
--     -- must raise 'confirm boarding before collecting payment'
--   SELECT mark_paid('<boarded booking id>', 'GCASH-REF-1');
--   SELECT booking_id, payment_status, reference_num FROM payments
--    WHERE booking_id = '<boarded booking id>';
-- =============================================================
