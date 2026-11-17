-- =============================================================
-- 098 — ISLAND HOP OPEN TO ALL BANGKEROS
--
-- 084 bound every package to one Bangka: the config guard demanded an
-- active boat, the booking trigger rejected a boatless package, forced
-- the boat onto the booking, capped pax at max_capacity and blocked any
-- other bangkero from accepting, and assign_next_hold only offered the
-- booking to that boat's owner.
--
-- Packages are now sold to whoever is eligible: no assigned boat, no
-- package passenger limit. Capacity is enforced where it belongs — the
-- boat's own capacity at accept time (fits_booking, 081) and the
-- one-boat-one-service day lock. Date/time/itinerary validation stays.
--
-- Run in the SQL editor AFTER 097.
-- =============================================================

BEGIN;

-- A package no longer carries a passenger limit.
ALTER TABLE public.island_packages ALTER COLUMN max_capacity DROP NOT NULL;

-- -------------------------------------------------------------
-- 1. Config guard: an itinerary/availability change still needs
--    its active bookings closed. Boat and capacity no longer exist.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_island_package_configuration()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (
       NEW.stops IS DISTINCT FROM OLD.stops
       OR NEW.is_active IS DISTINCT FROM OLD.is_active
     )
     AND EXISTS (
       SELECT 1
       FROM public.bookings b
       WHERE b.package_id = OLD.id
         AND b.trip_stat IN ('pending', 'open', 'accepted')
     ) THEN
    RAISE EXCEPTION
      'Cancel or complete this package''s active bookings before changing its itinerary or availability.';
  END IF;

  RETURN NEW;
END;
$$;

-- -------------------------------------------------------------
-- 2. Booking guard: keep the sailing rules, drop the boat rules.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_island_package_booking()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_package RECORD;
BEGIN
  IF NEW.package_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.trip_stat IN ('cancelled', 'completed') THEN
    RETURN NEW;
  END IF;

  SELECT p.id, p.is_active, p.stops, p.deleted_at
  INTO v_package
  FROM public.island_packages p
  WHERE p.id = NEW.package_id;

  IF NOT FOUND OR NOT v_package.is_active OR v_package.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'This island-hopping package is not available for booking.';
  END IF;

  IF jsonb_typeof(v_package.stops) <> 'array'
     OR jsonb_array_length(v_package.stops) < 2
     OR NEW.route_id IS DISTINCT FROM (
       (v_package.stops ->> 0) || '__' ||
       (v_package.stops ->> (jsonb_array_length(v_package.stops) - 1))
     ) THEN
    RAISE EXCEPTION 'The package itinerary does not match an active route.';
  END IF;

  IF NEW.num_of_passenger < 1 THEN
    RAISE EXCEPTION 'A booking needs at least one passenger.';
  END IF;
  IF NEW.scheduled_date IS NULL THEN
    RAISE EXCEPTION 'Choose a sailing date for this island-hopping package.';
  END IF;
  IF NEW.scheduled_date < (now() AT TIME ZONE 'Asia/Manila')::DATE THEN
    RAISE EXCEPTION 'The sailing date has already passed.';
  END IF;
  IF NEW.scheduled_date > (now() AT TIME ZONE 'Asia/Manila')::DATE
     AND COALESCE(NEW.scheduled_time, '') = '' THEN
    RAISE EXCEPTION 'Choose a departure time for an advance sailing.';
  END IF;
  IF NEW.scheduled_time IS NOT NULL
     AND NEW.scheduled_time NOT IN ('07:00', '10:00', '13:00', '17:00') THEN
    RAISE EXCEPTION 'Choose a valid departure time.';
  END IF;

  RETURN NEW;
END;
$$;

-- -------------------------------------------------------------
-- 3. Dispatch: 084's body minus the "only the package's boat owner"
--    filters, so FCFS/gates/route/capacity pick any eligible bangkero.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_next_hold(p_booking_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v public.bookings%ROWTYPE;
  v_route public.routes%ROWTYPE;
  v_port TEXT;
  v_dest TEXT;
  v_holder UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'booking not found'; END IF;

  IF v.trip_stat <> 'open' OR NOT COALESCE(v.is_dispatchable, true)
     OR (v.scheduled_date IS NOT NULL
         AND v.scheduled_date > (now() AT TIME ZONE 'Asia/Manila')::DATE) THEN
    UPDATE public.bookings SET held_by = NULL, hold_expires_at = NULL
    WHERE id = p_booking_id AND (held_by IS NOT NULL OR hold_expires_at IS NOT NULL);
    RETURN;
  END IF;

  SELECT * INTO v_route FROM public.routes WHERE id = v.route_id;
  v_port := v_route.start_port_id;
  v_dest := v_route.end_port_id;

  IF v.held_by IS NOT NULL AND v.hold_expires_at > now()
     AND dispatch_eligible(v.held_by, v_port)
     AND gates_ok(v.held_by)
     AND NOT bangkero_at_sea(v.held_by)
     AND NOT (COALESCE(v.rejected_by, '{}') @> ARRAY[v.held_by])
     AND route_ok(v.held_by, v_dest)
     AND fits_booking(v.held_by, v.service_type, v.num_of_passenger) THEN
    RETURN;
  END IF;

  IF v.held_by IS NOT NULL AND v.hold_expires_at <= now() THEN
    UPDATE public.bookings
    SET rejected_by = array_append(COALESCE(rejected_by, '{}'), v.held_by),
        held_by = NULL, hold_expires_at = NULL
    WHERE id = p_booking_id;
    v.rejected_by := COALESCE(v.rejected_by, '{}') || ARRAY[v.held_by];
    v.held_by := NULL;
    v.hold_expires_at := NULL;
  END IF;

  IF dev_dispatch_bypass() THEN
    SELECT b.id INTO v_holder
    FROM public.bangkeros b
    WHERE b.is_available
      AND gates_ok(b.id)
      AND NOT bangkero_at_sea(b.id)
      AND NOT (COALESCE(v.rejected_by, '{}') @> ARRAY[b.id])
    ORDER BY b.id LIMIT 1;
  ELSE
    SELECT pq.bangkero_id INTO v_holder
    FROM public.port_queue pq
    WHERE pq.port_id = v_port
      AND pq.left_at IS NULL
      AND pq.entered_at <= now() - INTERVAL '5 minutes'
      AND NOT (COALESCE(v.rejected_by, '{}') @> ARRAY[pq.bangkero_id])
      AND dispatch_eligible(pq.bangkero_id, v_port)
      AND gates_ok(pq.bangkero_id)
      AND NOT bangkero_at_sea(pq.bangkero_id)
      AND route_ok(pq.bangkero_id, v_dest)
      AND fits_booking(pq.bangkero_id, v.service_type, v.num_of_passenger)
    ORDER BY pq.entered_at ASC LIMIT 1;
  END IF;

  IF v_holder IS NULL THEN
    UPDATE public.bookings SET held_by = NULL, hold_expires_at = NULL
    WHERE id = p_booking_id AND (held_by IS NOT NULL OR hold_expires_at IS NOT NULL);
  ELSIF v.held_by IS DISTINCT FROM v_holder
     OR v.hold_expires_at IS NULL OR v.hold_expires_at <= now() THEN
    UPDATE public.bookings
    SET held_by = v_holder, hold_expires_at = now() + INTERVAL '3 minutes'
    WHERE id = p_booking_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.assign_next_hold(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_next_hold(UUID) TO authenticated, service_role;

COMMIT;
