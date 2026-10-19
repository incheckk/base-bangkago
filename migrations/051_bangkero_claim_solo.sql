-- =============================================================
-- 051. BANGKERO CLAIM SOLO RPC
-- =============================================================

CREATE OR REPLACE FUNCTION bangkero_claim_solo(p_booking_id UUID)
RETURNS VOID AS $$
DECLARE
  v bookings%ROWTYPE;
  v_parcel parcels%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- Verify caller is a verified bangkero
  IF NOT EXISTS (
    SELECT 1 FROM bangkeros b WHERE b.id = auth.uid() AND b.verification_stat = 'verified' AND b.is_deleted = false
  ) THEN
    RAISE EXCEPTION 'not a verified bangkero';
  END IF;

  SELECT * INTO v FROM bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking not found';
  END IF;

  -- Must be an open cargo booking
  IF v.trip_stat <> 'open' OR v.service_type <> 'cargo' THEN
    RAISE EXCEPTION 'booking is not an open cargo trip';
  END IF;

  -- Find the parcel
  SELECT * INTO v_parcel FROM parcels WHERE booking_id = p_booking_id LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no parcel on this booking';
  END IF;

  IF v_parcel.delivery_type <> 'solo' THEN
    RAISE EXCEPTION 'not a solo parcel';
  END IF;

  -- Flip the booking to dispatchable
  UPDATE bookings
  SET is_dispatchable = true,
      trip_stat = 'open'
  WHERE id = p_booking_id;

  -- Update the parcel
  UPDATE parcels
  SET batching_status = 'solo',
      carrier_booking_id = p_booking_id
  WHERE id = v_parcel.id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION bangkero_claim_solo(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION bangkero_claim_solo(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION bangkero_claim_solo(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION bangkero_claim_solo(UUID) TO service_role;
