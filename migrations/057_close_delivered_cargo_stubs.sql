-- =============================================================
-- 057. CLOSE DELIVERED CARGO STUBS (SECURITY DEFINER)
-- =============================================================
-- Why: completeBooking flips attached parcels to 'delivered', but the
-- sender's cargo stub booking keeps trip_stat='open' (batched) or
-- 'accepted' (piggyback). getActiveBooking() then still refuses the
-- sender's next booking ("You already have a pending booking") and the
-- passenger home banner keeps advertising a finished delivery.
--
-- The carrier's bangkero cannot close the stub directly: the stub has
-- user_id = sender, and no bookings UPDATE policy permits open -> completed
-- (bookings_bangkero_accept's WITH CHECK rejects it; bookings_bangkero_complete
-- requires accepted + operator_id = auth.uid()).
--
-- This RPC closes only the stubs whose parcel is already delivered AND
-- attached to the caller's completed carrier booking. Idempotent.
-- Apply after 056. No schema changes.
-- =============================================================

CREATE OR REPLACE FUNCTION public.close_delivered_cargo_stubs(p_carrier_booking_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_carrier public.bookings%ROWTYPE;
  v_count   INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_carrier
  FROM public.bookings
  WHERE id = p_carrier_booking_id;

  IF NOT FOUND
     OR v_carrier.operator_id IS DISTINCT FROM auth.uid()
     OR v_carrier.trip_stat <> 'completed' THEN
    RAISE EXCEPTION 'not your completed trip';
  END IF;

  UPDATE public.bookings b
  SET trip_stat = 'completed',
      completed_at = COALESCE(b.completed_at, now())
  WHERE b.service_type = 'cargo'
    AND b.id <> p_carrier_booking_id
    AND b.trip_stat IN ('open', 'accepted', 'pending')
    AND EXISTS (
      SELECT 1
      FROM public.parcels p
      WHERE p.booking_id = b.id
        AND p.status = 'delivered'
        AND (p.carrier_booking_id = p_carrier_booking_id
             OR p.piggyback_booking_id = p_carrier_booking_id)
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.close_delivered_cargo_stubs(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_delivered_cargo_stubs(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.close_delivered_cargo_stubs(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_delivered_cargo_stubs(UUID) TO service_role;
