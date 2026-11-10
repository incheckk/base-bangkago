-- =============================================================
-- 078. PARCEL LOAD ALSO STAMPS THE SENDER'S OWN BOOKING
-- =============================================================
-- 073 made set_parcel_loaded stamp onboarded_at on the booking the parcel
-- rides on. For a batched parcel that link resolves to the SHARED MASTER
-- only, so in a Wenzy + John batch the master's onboarded_at flips while
-- John's member booking keeps onboarded_at = NULL forever. Departure
-- reads onboarded_at per booking, so batch members stayed under
-- "cargo not loaded" and kept both Mark as Paid and Ready to Depart
-- locked even after every parcel was checked.
--
-- set_parcel_loaded now stamps/clears onboarded_at on BOTH:
--   * the carrier-linked booking (073 behavior, unchanged: the batch
--     aggregate lives on the master), and
--   * the parcel's own booking_id (the sender's member booking), so every
--     batch member reads as loaded the moment its parcel is checked.
--
-- Run order: AFTER 073 (whole-file replacement of the function; no
-- schema change). Safe to re-run.
-- =============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.set_parcel_loaded(
  p_parcel_id UUID,
  p_loaded BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parcel public.parcels%ROWTYPE;
  v_booking public.bookings%ROWTYPE;
  v_booking_id UUID;
  v_any_loaded BOOLEAN;
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

  IF v_parcel.status IN ('delivered', 'returned') THEN
    RAISE EXCEPTION 'this parcel is already closed';
  END IF;
  IF v_parcel.status <> 'pending' THEN
    RAISE EXCEPTION 'this parcel has already left the pier';
  END IF;
  IF v_parcel.delivery_type = 'piggyback'
     AND v_parcel.approval_status IS DISTINCT FROM 'accepted' THEN
    RAISE EXCEPTION 'this piggyback request is not accepted';
  END IF;

  -- Piggyback parcels point at the passenger ride in carrier_booking_id,
  -- but their accepted cargo stub is booking_id. Batched parcels point at
  -- the shared master in carrier_booking_id.
  IF v_parcel.delivery_type = 'piggyback' THEN
    v_booking_id := v_parcel.booking_id;
  ELSE
    v_booking_id := COALESCE(v_parcel.carrier_booking_id, v_parcel.booking_id);
  END IF;

  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = v_booking_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_booking.trip_stat <> 'accepted'
     OR v_booking.operator_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'this trip changed';
  END IF;

  IF v_booking.depart_time IS NOT NULL THEN
    RAISE EXCEPTION 'this trip has already departed';
  END IF;

  IF p_loaded THEN
    UPDATE public.parcels
    SET loaded_at = COALESCE(loaded_at, now())
    WHERE id = p_parcel_id;
  ELSE
    UPDATE public.parcels
    SET loaded_at = NULL
    WHERE id = p_parcel_id;

    -- If this parcel was already snapped into a manifest, take it back out.
    -- The next populate/finalize pass recalculates the manifest totals.
    DELETE FROM public.manifest_parcels
    WHERE parcel_id = p_parcel_id;
  END IF;

  IF v_booking.service_type = 'cargo' THEN
    -- 073 behavior: the carrier-linked booking (the batch master) carries
    -- the aggregate "any parcel loaded" state.
    SELECT EXISTS (
      SELECT 1
      FROM public.parcels p
      WHERE p.status = 'pending'
        AND p.loaded_at IS NOT NULL
        AND (p.carrier_booking_id = v_booking.id OR p.booking_id = v_booking.id)
    ) INTO v_any_loaded;

    UPDATE public.bookings
    SET onboarded_at = CASE
      WHEN v_any_loaded THEN COALESCE(onboarded_at, now())
      ELSE NULL
    END
    WHERE id = v_booking.id;

    -- 078: the sender's own member booking must read as loaded too —
    -- until 078 only the master was stamped, so departure's per-booking
    -- onboarded_at check kept batch members locked. Unchecking this
    -- parcel clears that member's stamp alone.
    IF v_parcel.booking_id IS NOT NULL
       AND v_parcel.booking_id <> v_booking.id
       AND v_parcel.delivery_type IS DISTINCT FROM 'piggyback' THEN
      UPDATE public.bookings
      SET onboarded_at = CASE
        WHEN p_loaded THEN COALESCE(onboarded_at, now())
        ELSE NULL
      END
      WHERE id = v_parcel.booking_id
        AND trip_stat = 'accepted'
        AND service_type = 'cargo';
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_parcel_loaded(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_parcel_loaded(UUID, BOOLEAN) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =============================================================
-- VERIFY after apply:
--   SELECT proname, prosrc
--   FROM pg_proc
--   WHERE proname = 'set_parcel_loaded';
--   -- the body must contain the "078" member-booking update
--
--   -- On a batch: check a member's parcel, then
--   SELECT id, trip_stat, onboarded_at
--   FROM public.bookings
--   WHERE id IN (<master id>, <member id>);
--   -- BOTH rows must now show onboarded_at IS NOT NULL (trip_stat
--   -- 'accepted'). Uncheck the parcel: the member's onboarded_at clears.
-- =============================================================
