-- =============================================================
-- 092 — Allow soft-delete when only historical bookings remain
-- Run AFTER 091_island_package_restore.sql.
-- Active bookings stay protected; completed/cancelled history is retained.
-- =============================================================

BEGIN;

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
    SELECT 1
    FROM public.bookings b
    WHERE b.package_id = p_package_id
      AND b.trip_stat IN ('pending', 'open', 'accepted')
  ) THEN
    RAISE EXCEPTION 'This package has active bookings. Cancel or complete them before deleting it; past booking history will be retained.';
  END IF;

  UPDATE public.island_packages
  SET deleted_at = now()
  WHERE id = p_package_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_island_package(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_island_package(UUID) TO authenticated;

COMMIT;
