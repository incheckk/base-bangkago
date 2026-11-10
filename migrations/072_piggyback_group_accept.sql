-- =============================================================
-- 072. ACCEPT A PIGGYBACK REQUEST AS A GROUPED ADD-ON
-- =============================================================
-- Why:
--   A piggyback parcel is linked to a passenger ride the bangkero
--   already accepted, but its own booking is a non-dispatchable stub
--   (050). accept_booking_hold refuses those rows (071 guard), so the
--   old approvePiggyback only flipped parcels.approval_status and the
--   stub's operator — it never grouped the stub with the carrier trip.
--   The bangkero then saw the cargo as a separate ungrouped "trip".
--
--   accept_piggyback_request() is the only accept path for a pending
--   piggyback request. It validates that the caller operates the
--   carrier ride, approves the parcel, accepts the sender's stub, and
--   assigns group_booking_id with the SAME group key and advisory lock
--   as accept_booking_hold (071), so the carrier trip and its parcel
--   are one boat load in the app.
--
-- Group key: carrier operator + carrier route + sailing day + slot.
--   Same-day rides use Manila today and ignore the slot; advance rides
--   use the ride's scheduled_date + scheduled_time.
--
-- Forward-only. Apply after 071. No demo reset.
-- =============================================================

CREATE OR REPLACE FUNCTION public.accept_piggyback_request(p_parcel_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parcel parcels%ROWTYPE;
  v_stub bookings%ROWTYPE;
  v_ride bookings%ROWTYPE;
  v_advance BOOLEAN;
  v_group_id UUID;
  v_group_day DATE;
  v_group_slot TEXT;
  v_operator_name TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_parcel
  FROM public.parcels
  WHERE id = p_parcel_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'piggyback request not found';
  END IF;
  IF v_parcel.delivery_type IS DISTINCT FROM 'piggyback' THEN
    RAISE EXCEPTION 'not a piggyback request';
  END IF;
  IF v_parcel.approval_status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'this piggyback request was already handled';
  END IF;
  IF v_parcel.piggyback_booking_id IS NULL THEN
    RAISE EXCEPTION 'piggyback request has no carrier ride';
  END IF;
  IF v_parcel.booking_id IS NULL THEN
    RAISE EXCEPTION 'piggyback request has no cargo stub';
  END IF;

  SELECT * INTO v_ride
  FROM public.bookings
  WHERE id = v_parcel.piggyback_booking_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'carrier ride not found';
  END IF;
  IF v_ride.operator_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'this piggyback request belongs to another boat';
  END IF;
  IF v_ride.trip_stat IS DISTINCT FROM 'accepted' THEN
    RAISE EXCEPTION 'accept the passenger trip first';
  END IF;
  IF v_ride.depart_time IS NOT NULL THEN
    RAISE EXCEPTION 'this trip has already departed';
  END IF;

  SELECT * INTO v_stub
  FROM public.bookings
  WHERE id = v_parcel.booking_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cargo stub not found';
  END IF;
  IF v_stub.user_id IS DISTINCT FROM v_parcel.user_id THEN
    RAISE EXCEPTION 'cargo stub does not belong to the sender';
  END IF;
  IF v_stub.service_type IS DISTINCT FROM 'cargo' THEN
    RAISE EXCEPTION 'cargo stub is not a cargo booking';
  END IF;
  IF v_stub.trip_stat IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'this piggyback request was already handled';
  END IF;
  IF v_stub.route_id IS DISTINCT FROM v_ride.route_id THEN
    RAISE EXCEPTION 'parcel route does not match the carrier trip';
  END IF;

  -- Same account gates accept_booking_hold enforces; queue, route-lock
  -- and capacity do not apply to a parcel riding an accepted trip.
  IF NOT EXISTS (
    SELECT 1 FROM public.bangkeros b WHERE b.id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not a registered bangkero';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.bangkeros b
    WHERE b.id = auth.uid() AND b.is_available
  ) THEN
    RAISE EXCEPTION 'you are offline — turn on availability to accept';
  END IF;
  IF NOT public.dev_gates_bypass() THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.bangkeros b
      WHERE b.id = auth.uid() AND b.verification_stat = 'verified'
    ) THEN
      RAISE EXCEPTION 'your documents are not approved yet';
    END IF;
    IF NOT public.bangkero_rating_ok(auth.uid()) THEN
      RAISE EXCEPTION 'your rating is too low to accept bookings';
    END IF;
  END IF;

  v_advance := COALESCE(v_ride.scheduled_date, (now() AT TIME ZONE 'Asia/Manila')::date)
               > (now() AT TIME ZONE 'Asia/Manila')::date;

  -- 071: one group per boat + route + sailing day/slot. Advisory lock
  -- is identical to accept_booking_hold so a piggyback accept and a
  -- passenger accept cannot create two groups for the same load.
  v_group_day := COALESCE(
    v_ride.scheduled_date,
    (now() AT TIME ZONE 'Asia/Manila')::date
  );
  v_group_slot := CASE
    WHEN v_advance THEN COALESCE(v_ride.scheduled_time, '')
    ELSE ''
  END;

  PERFORM pg_advisory_xact_lock(
    hashtext('booking_group'),
    hashtext(auth.uid()::text || '|' || v_ride.route_id || '|' ||
             v_group_day::text || '|' || v_group_slot)
  );

  SELECT group_booking_id INTO v_group_id
  FROM public.bookings
  WHERE operator_id = auth.uid()
    AND route_id = v_ride.route_id
    AND trip_stat = 'accepted'
    AND group_booking_id IS NOT NULL
    AND COALESCE(scheduled_date, (now() AT TIME ZONE 'Asia/Manila')::date) = v_group_day
    AND (NOT v_advance OR COALESCE(scheduled_time, '') = v_group_slot)
  ORDER BY accepted_at ASC NULLS LAST
  LIMIT 1;

  IF v_group_id IS NULL AND EXISTS (
    SELECT 1
    FROM public.bookings
    WHERE operator_id = auth.uid()
      AND route_id = v_ride.route_id
      AND trip_stat = 'accepted'
      AND group_booking_id IS NULL
      AND COALESCE(scheduled_date, (now() AT TIME ZONE 'Asia/Manila')::date) = v_group_day
      AND (NOT v_advance OR COALESCE(scheduled_time, '') = v_group_slot)
  ) THEN
    v_group_id := gen_random_uuid();
    UPDATE public.bookings
    SET group_booking_id = v_group_id
    WHERE operator_id = auth.uid()
      AND route_id = v_ride.route_id
      AND trip_stat = 'accepted'
      AND group_booking_id IS NULL
      AND COALESCE(scheduled_date, (now() AT TIME ZONE 'Asia/Manila')::date) = v_group_day
      AND (NOT v_advance OR COALESCE(scheduled_time, '') = v_group_slot);
  END IF;

  SELECT display_name INTO v_operator_name
  FROM public.bangkeros
  WHERE id = auth.uid();

  UPDATE public.bookings
  SET trip_stat = 'accepted',
      operator_id = auth.uid(),
      operator_name = v_operator_name,
      accepted_at = now(),
      held_by = NULL,
      hold_expires_at = NULL,
      group_booking_id = v_group_id,
      scheduled_date = v_ride.scheduled_date,
      scheduled_time = v_ride.scheduled_time
  WHERE id = v_stub.id
    AND trip_stat = 'open';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'this piggyback request was already handled';
  END IF;

  UPDATE public.parcels
  SET approval_status = 'accepted',
      carrier_booking_id = v_ride.id
  WHERE id = v_parcel.id
    AND approval_status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'this piggyback request was already handled';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_piggyback_request(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_piggyback_request(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.accept_piggyback_request(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_piggyback_request(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';

-- =============================================================
-- VERIFY after apply:
--   -- function exists + grants
--   SELECT proname, prosecdef FROM pg_proc
--   WHERE proname = 'accept_piggyback_request';
--   -- one load per carrier trip (stub now shares its group)
--   SELECT b.group_booking_id, count(*), array_agg(b.ref)
--   FROM bookings b
--   WHERE b.trip_stat = 'accepted' AND b.group_booking_id IS NOT NULL
--   GROUP BY 1 ORDER BY 2 DESC LIMIT 5;
-- =============================================================
