-- =============================================================
-- 091 — Reversible island-hop package deletion
-- Run AFTER 090_compliance_report_dismissal.sql (and 084).
-- Retains package history while keeping deleted packages out of
-- passenger listings and preventing bookings during a delete race.
-- =============================================================

BEGIN;

ALTER TABLE public.island_packages
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS island_packages_deleted_at_idx
  ON public.island_packages (deleted_at DESC)
  WHERE deleted_at IS NOT NULL;

COMMENT ON COLUMN public.island_packages.deleted_at IS
  'When an admin moved this package to the Deleted Packages restore list; the package row is retained.';

CREATE OR REPLACE FUNCTION public.guard_island_package_booking_not_deleted()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_deleted_at TIMESTAMPTZ;
BEGIN
  IF NEW.package_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.deleted_at
  INTO v_deleted_at
  FROM public.island_packages p
  WHERE p.id = NEW.package_id
  FOR UPDATE;

  IF NOT FOUND OR v_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'This island-hopping package is no longer available for booking.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_island_package_booking_not_deleted ON public.bookings;
CREATE TRIGGER trg_island_package_booking_not_deleted
  BEFORE INSERT OR UPDATE OF package_id
  ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_island_package_booking_not_deleted();

CREATE OR REPLACE FUNCTION public.admin_delete_island_package(p_package_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_deleted_at TIMESTAMPTZ;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = auth.uid() AND user_role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only admins may delete island-hopping packages.'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.deleted_at
  INTO v_deleted_at
  FROM public.island_packages p
  WHERE p.id = p_package_id
  FOR UPDATE;

  IF NOT FOUND OR v_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Island-hopping package not found or already deleted.'
      USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bookings b WHERE b.package_id = p_package_id
  ) THEN
    RAISE EXCEPTION 'This package has booking history. Deactivate it instead so records are preserved.';
  END IF;

  UPDATE public.island_packages
  SET deleted_at = now()
  WHERE id = p_package_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_restore_island_package(p_package_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_deleted_at TIMESTAMPTZ;
  v_is_active BOOLEAN;
  v_bangka_id UUID;
  v_bangka_capacity INTEGER;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = auth.uid() AND user_role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only admins may restore island-hopping packages.'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.deleted_at, p.is_active, p.bangka_id, k.capacity
  INTO v_deleted_at, v_is_active, v_bangka_id, v_bangka_capacity
  FROM public.island_packages p
  LEFT JOIN public.bangkas k ON k.id = p.bangka_id
  WHERE p.id = p_package_id
  FOR UPDATE OF p;

  IF NOT FOUND OR v_deleted_at IS NULL THEN
    RAISE EXCEPTION 'Deleted island-hopping package not found.'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_is_active AND NOT EXISTS (
    SELECT 1
    FROM public.bangkas k
    JOIN public.bangkeros o ON o.id = k.bangkero_id
    WHERE k.id = v_bangka_id
      AND k.is_active
      AND NOT k.is_deleted
      AND k.deleted_at IS NULL
      AND o.verification_stat = 'verified'
      AND NOT o.is_deleted
  ) THEN
    RAISE EXCEPTION 'Assign an active Bangka with a verified, non-deleted Bangkero before restoring this available package.';
  END IF;

  UPDATE public.island_packages
  SET deleted_at = NULL,
      max_capacity = CASE
        WHEN v_bangka_capacity IS NOT NULL THEN LEAST(max_capacity, v_bangka_capacity)
        ELSE max_capacity
      END
  WHERE id = p_package_id;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_island_package_booking_not_deleted() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_delete_island_package(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_restore_island_package(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_island_package(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_restore_island_package(UUID) TO authenticated;

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
    AND p.deleted_at IS NULL
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

COMMIT;
