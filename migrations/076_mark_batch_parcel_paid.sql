-- =============================================================
-- 076. MARK A BATCHED PARCEL'S STUB PAYMENT PAID
-- =============================================================
-- The shared batch master carries every sender's cargo, but each
-- sender's payment row hangs off their demoted stub. The operating
-- bangkero can now settle those stub rows one parcel at a time.
--
-- Run order: AFTER 075. Safe to re-run.
-- =============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.mark_batch_parcel_paid(p_parcel_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parcel public.parcels%ROWTYPE;
  v_master public.bookings%ROWTYPE;
  v_stub public.bookings%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_parcel
  FROM public.parcels
  WHERE id = p_parcel_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'parcel not found';
  END IF;
  IF v_parcel.delivery_type IS DISTINCT FROM 'batched' THEN
    RAISE EXCEPTION 'this is not a batched parcel';
  END IF;

  SELECT * INTO v_master
  FROM public.bookings
  WHERE id = v_parcel.carrier_booking_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_master.trip_stat <> 'accepted'
     OR v_master.operator_id IS DISTINCT FROM auth.uid()
  THEN
    RAISE EXCEPTION 'this trip changed';
  END IF;

  SELECT * INTO v_stub
  FROM public.bookings
  WHERE id = v_parcel.booking_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_stub.id = v_master.id
     OR v_stub.operator_id IS NOT NULL
     OR COALESCE(v_stub.is_dispatchable, true)
     OR v_stub.group_booking_id IS DISTINCT FROM v_master.group_booking_id
  THEN
    RAISE EXCEPTION 'this parcel is not a consolidated batch member';
  END IF;

  UPDATE public.payments
  SET payment_status = 'completed'
  WHERE booking_id = v_stub.id;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_batch_parcel_paid(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_batch_parcel_paid(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_batch_parcel_paid(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_batch_parcel_paid(UUID) TO service_role;

DROP POLICY IF EXISTS "payments_select_operator_batch_member" ON public.payments;
CREATE POLICY "payments_select_operator_batch_member" ON public.payments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.parcels p
      JOIN public.bookings master ON master.id = p.carrier_booking_id
      WHERE p.booking_id = payments.booking_id
        AND p.delivery_type = 'batched'
        AND master.trip_stat = 'accepted'
        AND master.operator_id = auth.uid()
    )
  );

COMMIT;

NOTIFY pgrst, 'reload schema';
