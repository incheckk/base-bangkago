CREATE OR REPLACE FUNCTION public.upgrade_batch_to_solo(p_parcel_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
  v_route_key TEXT;
  v_parcel public.parcels%ROWTYPE;
  v_booking public.bookings%ROWTYPE;
  v_surcharge NUMERIC(10,2) := 150.00;
  v_total NUMERIC(10,2);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT user_id, batching_route_key
    INTO v_owner, v_route_key
  FROM public.parcels
  WHERE id = p_parcel_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'parcel not found';
  END IF;
  IF v_owner <> auth.uid() THEN
    RAISE EXCEPTION 'not your parcel';
  END IF;
  IF v_route_key IS NULL THEN
    RAISE EXCEPTION 'parcel has no batch route';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('batch_resolve'),
    hashtext(v_route_key)
  );

  SELECT * INTO v_parcel
  FROM public.parcels
  WHERE id = p_parcel_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'parcel not found';
  END IF;
  IF v_parcel.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'not your parcel';
  END IF;
  IF v_parcel.status <> 'pending' THEN
    RAISE EXCEPTION 'parcel is no longer pending';
  END IF;
  IF v_parcel.batching_status IS DISTINCT FROM 'pending_batch' THEN
    RAISE EXCEPTION 'parcel is not waiting for batching';
  END IF;
  IF v_parcel.batching_route_key IS DISTINCT FROM v_route_key THEN
    RAISE EXCEPTION 'parcel batch changed; refresh and try again';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.parcels p
    WHERE p.batching_route_key = v_route_key
      AND p.batching_status = 'pending_batch'
      AND p.status = 'pending'
      AND p.id <> v_parcel.id
  ) THEN
    RAISE EXCEPTION 'other parcels are still waiting in this batch';
  END IF;

  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = v_parcel.booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking not found';
  END IF;
  IF v_booking.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'not your booking';
  END IF;
  IF v_booking.service_type <> 'cargo' THEN
    RAISE EXCEPTION 'solo upgrade is cargo-only';
  END IF;
  IF v_booking.trip_stat NOT IN ('open', 'pending') THEN
    RAISE EXCEPTION 'booking is no longer open';
  END IF;

  v_total := GREATEST(COALESCE(v_parcel.total_price, 150.00), 150.00)
             + v_surcharge;

  UPDATE public.parcels
  SET batching_status = 'solo',
      solo_surcharge = v_surcharge,
      total_price = v_total,
      scheduled_departure_at = NULL,
      batching_route_key = NULL,
      carrier_booking_id = v_booking.id
  WHERE id = v_parcel.id;

  UPDATE public.bookings
  SET trip_stat = 'open',
      is_dispatchable = true,
      cargo_mode = 'solo',
      total_price = v_total,
      batch_route_key = NULL,
      held_by = NULL,
      hold_expires_at = NULL
  WHERE id = v_booking.id;

  UPDATE public.payments
  SET amount = v_total
  WHERE booking_id = v_booking.id
    AND payment_status = 'pending';

  RETURN v_booking.id;
END;
$$;

REVOKE ALL ON FUNCTION public.upgrade_batch_to_solo(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upgrade_batch_to_solo(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.upgrade_batch_to_solo(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upgrade_batch_to_solo(UUID) TO service_role;
