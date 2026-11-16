-- =============================================================
-- 084 — Island-hop package assignment and boat-capacity availability
-- Run AFTER 083_rbac_matrix_alignment.sql.
-- Reuses island_packages and bookings; no new tables are added.
-- =============================================================

BEGIN;

ALTER TABLE public.island_packages
  ADD COLUMN IF NOT EXISTS bangka_id UUID
    REFERENCES public.bangkas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS island_packages_bangka_active_idx
  ON public.island_packages (bangka_id)
  WHERE is_active;

CREATE OR REPLACE FUNCTION public.guard_island_package_configuration()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (
       NEW.bangka_id IS DISTINCT FROM OLD.bangka_id
       OR NEW.max_capacity IS DISTINCT FROM OLD.max_capacity
       OR NEW.stops IS DISTINCT FROM OLD.stops
       OR NEW.is_active IS DISTINCT FROM OLD.is_active
     )
     AND EXISTS (
       SELECT 1
       FROM public.bookings b
       WHERE b.package_id = OLD.id
         AND b.trip_stat IN ('pending', 'open', 'accepted')
     ) THEN
    RAISE EXCEPTION
      'Cancel or complete this package’s active bookings before changing its boat, itinerary, capacity, or availability.';
  END IF;

  IF NEW.is_active AND NEW.bangka_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.bangkas k
    JOIN public.bangkeros o ON o.id = k.bangkero_id
    WHERE k.id = NEW.bangka_id
      AND k.is_active
      AND NOT k.is_deleted
      AND k.deleted_at IS NULL
      AND o.verification_stat = 'verified'
      AND NOT o.is_deleted
  ) THEN
    RAISE EXCEPTION 'Choose an active Bangka with a verified, non-deleted bangkero.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_island_package_configuration ON public.island_packages;
CREATE TRIGGER trg_island_package_configuration
  BEFORE INSERT OR UPDATE OF bangka_id, max_capacity, stops, is_active
  ON public.island_packages
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_island_package_configuration();

CREATE OR REPLACE FUNCTION public.island_package_availability(
  p_package_id UUID,
  p_sailing_date DATE
)
RETURNS TABLE (
  capacity INTEGER,
  reserved INTEGER,
  available INTEGER,
  bangka_name TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_bangka UUID;
  v_bangkero UUID;
  v_package_capacity INTEGER;
  v_boat_capacity INTEGER;
  v_name TEXT;
  v_boat_reserved INTEGER;
  v_package_reserved INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT p.bangka_id,
         k.bangkero_id,
         p.max_capacity,
         k.capacity,
         k.bangka_name
  INTO v_bangka, v_bangkero, v_package_capacity, v_boat_capacity, v_name
  FROM public.island_packages p
  JOIN public.bangkas k ON k.id = p.bangka_id
  JOIN public.bangkeros o ON o.id = k.bangkero_id
  WHERE p.id = p_package_id
    AND p.is_active
    AND k.is_active
    AND NOT k.is_deleted
    AND k.deleted_at IS NULL
    AND o.verification_stat = 'verified'
    AND NOT o.is_deleted;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(b.num_of_passenger), 0)::INTEGER
  INTO v_boat_reserved
  FROM public.bookings b
  WHERE b.trip_stat IN ('pending', 'open', 'accepted')
    AND b.service_type <> 'cargo'
    AND COALESCE(b.scheduled_date, (now() AT TIME ZONE 'Asia/Manila')::DATE) = p_sailing_date
    AND (
      b.bangka_id = v_bangka
      OR (
        b.bangka_id IS NULL
        AND (
          b.operator_id = v_bangkero
          OR EXISTS (
            SELECT 1
            FROM public.island_packages p
            WHERE p.id = b.package_id
              AND p.bangka_id = v_bangka
          )
        )
      )
    );

  SELECT COALESCE(SUM(b.num_of_passenger), 0)::INTEGER
  INTO v_package_reserved
  FROM public.bookings b
  WHERE b.package_id = p_package_id
    AND b.trip_stat IN ('pending', 'open', 'accepted')
    AND COALESCE(b.scheduled_date, (now() AT TIME ZONE 'Asia/Manila')::DATE) = p_sailing_date;

  RETURN QUERY
  SELECT LEAST(v_package_capacity, v_boat_capacity),
         LEAST(v_package_reserved, v_package_capacity),
         GREATEST(
           LEAST(v_package_capacity - v_package_reserved, v_boat_capacity - v_boat_reserved),
           0
         ),
         v_name;
END;
$$;

REVOKE ALL ON FUNCTION public.island_package_availability(UUID, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.island_package_availability(UUID, DATE) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.guard_island_package_booking()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_package RECORD;
  v_day DATE;
  v_bangka UUID;
  v_bangkero UUID;
  v_boat_capacity INTEGER;
  v_package_taken INTEGER;
  v_boat_taken INTEGER;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.trip_stat IN ('cancelled', 'completed') THEN
    RETURN NEW;
  END IF;
  IF NEW.package_id IS NULL AND NEW.service_type = 'cargo' THEN
    RETURN NEW;
  END IF;

  IF NEW.package_id IS NOT NULL THEN
    SELECT p.id, p.is_active, p.bangka_id, p.max_capacity, p.stops,
           k.bangkero_id, k.capacity, k.is_active AS bangka_active,
           k.is_deleted AS bangka_deleted, k.deleted_at,
           o.verification_stat, o.is_deleted AS bangkero_deleted
    INTO v_package
    FROM public.island_packages p
    LEFT JOIN public.bangkas k ON k.id = p.bangka_id
    LEFT JOIN public.bangkeros o ON o.id = k.bangkero_id
    WHERE p.id = NEW.package_id;

    IF NOT FOUND OR NOT v_package.is_active OR v_package.bangka_id IS NULL
       OR NOT COALESCE(v_package.bangka_active, false)
       OR COALESCE(v_package.bangka_deleted, true)
       OR v_package.deleted_at IS NOT NULL
       OR v_package.verification_stat IS DISTINCT FROM 'verified'
       OR COALESCE(v_package.bangkero_deleted, true) THEN
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
    IF NEW.num_of_passenger < 1 OR NEW.num_of_passenger > v_package.max_capacity THEN
      RAISE EXCEPTION 'This package has a limit of % passengers per sailing date.', v_package.max_capacity;
    END IF;

    v_bangka := v_package.bangka_id;
    v_bangkero := v_package.bangkero_id;
    v_boat_capacity := v_package.capacity;
    NEW.bangka_id := v_bangka;
    IF NEW.trip_stat = 'accepted'
       AND NEW.operator_id IS DISTINCT FROM v_bangkero THEN
      RAISE EXCEPTION 'This package is assigned to a different Bangkero.';
    END IF;
  ELSIF NEW.trip_stat = 'accepted' AND NEW.operator_id IS NOT NULL THEN
    SELECT k.id, k.bangkero_id, k.capacity
    INTO v_bangka, v_bangkero, v_boat_capacity
    FROM public.bangkas k
    WHERE k.bangkero_id = NEW.operator_id
      AND k.is_active
      AND NOT k.is_deleted
      AND k.deleted_at IS NULL
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN NEW;
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  IF NEW.trip_stat IN ('pending', 'open', 'accepted') THEN
    v_day := COALESCE(NEW.scheduled_date, (now() AT TIME ZONE 'Asia/Manila')::DATE);
    PERFORM pg_advisory_xact_lock(hashtext('bangka-capacity:' || v_bangkero::TEXT));

    SELECT COALESCE(SUM(b.num_of_passenger), 0)::INTEGER
    INTO v_boat_taken
    FROM public.bookings b
    WHERE b.trip_stat IN ('pending', 'open', 'accepted')
      AND b.service_type <> 'cargo'
      AND COALESCE(b.scheduled_date, (now() AT TIME ZONE 'Asia/Manila')::DATE) = v_day
      AND b.id IS DISTINCT FROM NEW.id
      AND (
        b.bangka_id = v_bangka
        OR (
          b.bangka_id IS NULL
          AND (
            b.operator_id = v_bangkero
            OR EXISTS (
              SELECT 1
              FROM public.island_packages p
              WHERE p.id = b.package_id
                AND p.bangka_id = v_bangka
            )
          )
        )
      );

    IF v_boat_taken + NEW.num_of_passenger > v_boat_capacity THEN
      RAISE EXCEPTION
        'The assigned Bangka has only % of % seats left for this sailing date.',
        GREATEST(v_boat_capacity - v_boat_taken, 0), v_boat_capacity;
    END IF;

    IF NEW.package_id IS NOT NULL THEN
      SELECT COALESCE(SUM(b.num_of_passenger), 0)::INTEGER
      INTO v_package_taken
      FROM public.bookings b
      WHERE b.package_id = NEW.package_id
        AND b.trip_stat IN ('pending', 'open', 'accepted')
        AND COALESCE(b.scheduled_date, (now() AT TIME ZONE 'Asia/Manila')::DATE) = v_day
        AND b.id IS DISTINCT FROM NEW.id;

      IF v_package_taken + NEW.num_of_passenger > v_package.max_capacity THEN
        RAISE EXCEPTION
          'This package has only % of % seats left for this sailing date.',
          GREATEST(v_package.max_capacity - v_package_taken, 0), v_package.max_capacity;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bookings_island_package_capacity ON public.bookings;
CREATE TRIGGER trg_bookings_island_package_capacity
  BEFORE INSERT OR UPDATE OF package_id, trip_stat, num_of_passenger,
    scheduled_date, scheduled_time, operator_id, bangka_id, route_id
  ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_island_package_booking();

-- Island-hop bookings are offered only to the Bangkero who owns the
-- package’s assigned boat. Keep 067’s FCFS and at-sea behavior unchanged.
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
     AND fits_booking(v.held_by, v.service_type, v.num_of_passenger)
     AND (
       v.package_id IS NULL OR EXISTS (
         SELECT 1 FROM public.island_packages p
         JOIN public.bangkas k ON k.id = p.bangka_id
         WHERE p.id = v.package_id AND k.bangkero_id = v.held_by
       )
     ) THEN
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
      AND (
        v.package_id IS NULL OR EXISTS (
          SELECT 1 FROM public.island_packages p
          JOIN public.bangkas k ON k.id = p.bangka_id
          WHERE p.id = v.package_id AND k.bangkero_id = b.id
        )
      )
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
      AND (
        v.package_id IS NULL OR EXISTS (
          SELECT 1 FROM public.island_packages p
          JOIN public.bangkas k ON k.id = p.bangka_id
          WHERE p.id = v.package_id AND k.bangkero_id = pq.bangkero_id
        )
      )
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

CREATE OR REPLACE FUNCTION public.admin_reschedule_island_booking(
  p_booking_id UUID,
  p_scheduled_date DATE,
  p_scheduled_time TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v public.bookings%ROWTYPE;
  v_today DATE := (now() AT TIME ZONE 'Asia/Manila')::DATE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF p_scheduled_date IS NULL OR p_scheduled_date < v_today THEN
    RAISE EXCEPTION 'Choose today or a future sailing date.';
  END IF;
  IF p_scheduled_date > v_today AND COALESCE(p_scheduled_time, '') = '' THEN
    RAISE EXCEPTION 'Choose a departure time for an advance sailing.';
  END IF;
  IF p_scheduled_time IS NOT NULL
     AND p_scheduled_time NOT IN ('07:00', '10:00', '13:00', '17:00') THEN
    RAISE EXCEPTION 'Choose a valid departure time.';
  END IF;

  SELECT * INTO v
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking not found';
  END IF;
  IF v.package_id IS NULL THEN
    RAISE EXCEPTION 'This is not an island-hopping booking.';
  END IF;
  IF v.trip_stat NOT IN ('pending', 'open') THEN
    RAISE EXCEPTION 'Only pending or open bookings can be rescheduled.';
  END IF;
  IF v.depart_time IS NOT NULL OR v.onboarded_at IS NOT NULL THEN
    RAISE EXCEPTION 'A departed or boarded booking cannot be rescheduled.';
  END IF;

  UPDATE public.bookings
  SET scheduled_date = p_scheduled_date,
      scheduled_time = p_scheduled_time,
      held_by = NULL,
      hold_expires_at = NULL
  WHERE id = v.id;

  PERFORM public.assign_next_hold(v.id);

  BEGIN
    INSERT INTO public.notifications (user_id, title, message, category)
    VALUES (
      v.user_id,
      'Island-hop sailing rescheduled',
      'Booking ' || v.ref || ' is now scheduled for ' || p_scheduled_date::TEXT ||
        COALESCE(' at ' || p_scheduled_time, '') || '.',
      'booking'
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reschedule_island_booking(UUID, DATE, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reschedule_island_booking(UUID, DATE, TEXT) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
