-- =============================================================
-- 085 — Departure lock: no boarding once the boat has sailed
-- Run AFTER 084_island_package_vessel_capacity.sql.
--
-- The app now closes the departure / booking-status screens after
-- depart_time; these two RPCs are the database backstop so a stale
-- screen, a replay or a late QR scan cannot board anyone on a trip
-- that is already at sea.
--
-- Cargo is already covered: 078's set_parcel_loaded and 073's
-- mark_parcel_no_show both refuse once depart_time is stamped.
-- Advance bookings have depart_time NULL until their sailing day,
-- so they are unaffected.
-- =============================================================

BEGIN;

-- -------------------------------------------------------------
-- 1. Booker / whole-party boarding toggle
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_booking_boarded(
  p_booking_id UUID, p_boarded BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  UPDATE public.bookings
  SET onboarded_at = CASE WHEN p_boarded THEN now() END
  WHERE id = p_booking_id
    AND trip_stat = 'accepted'
    AND operator_id = auth.uid()
    AND depart_time IS NULL;

  IF NOT FOUND THEN
    IF EXISTS (
      SELECT 1 FROM public.bookings
      WHERE id = p_booking_id
        AND operator_id = auth.uid()
        AND depart_time IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'This trip has already sailed — boarding is closed.';
    END IF;
    RAISE EXCEPTION 'this trip changed';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_booking_boarded(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_booking_boarded(UUID, BOOLEAN)
  TO authenticated, service_role;

-- -------------------------------------------------------------
-- 2. QR boarding (companion 'PAX' codes and the booker's ref)
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_boarding_qr(p_token text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_detail_id uuid;
  v_name text;
  v_lookup text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  v_lookup := CASE WHEN p_token LIKE 'PAX%' THEN substr(p_token, 4) ELSE p_token END;

  SELECT pd.id, pd.first_name || ' ' || pd.last_name
    INTO v_detail_id, v_name
  FROM public.passenger_details pd
  JOIN public.bookings b ON b.id = pd.booking_id
  WHERE pd.qr_token = v_lookup
    AND b.trip_stat = 'accepted'
    AND b.operator_id = auth.uid()
    AND b.depart_time IS NULL;
  IF v_detail_id IS NOT NULL THEN
    UPDATE public.passenger_details
    SET boarded_at = now(), no_show_at = NULL
    WHERE id = v_detail_id;
    RETURN v_name;
  END IF;

  SELECT b.id, b.passenger_name
    INTO v_detail_id, v_name
  FROM public.bookings b
  WHERE b.ref = upper(v_lookup)
    AND b.trip_stat = 'accepted'
    AND b.operator_id = auth.uid()
    AND b.depart_time IS NULL;
  IF v_detail_id IS NOT NULL THEN
    UPDATE public.bookings SET onboarded_at = now() WHERE id = v_detail_id;
    RETURN COALESCE(v_name, 'Booker');
  END IF;

  -- The code is this operator's, but the trip already sailed: say so
  -- instead of "does not belong to this trip".
  IF EXISTS (
    SELECT 1
    FROM public.bookings b
    WHERE b.ref = upper(v_lookup)
      AND b.operator_id = auth.uid()
      AND b.depart_time IS NOT NULL
    UNION ALL
    SELECT 1
    FROM public.passenger_details pd
    JOIN public.bookings b ON b.id = pd.booking_id
    WHERE pd.qr_token = v_lookup
      AND b.operator_id = auth.uid()
      AND b.depart_time IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'This trip has already sailed — boarding is closed.';
  END IF;

  RAISE EXCEPTION 'that QR code does not belong to this trip';
END;
$$;

REVOKE ALL ON FUNCTION public.verify_boarding_qr(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_boarding_qr(text)
  TO authenticated, service_role;

COMMIT;
