-- =============================================================
-- 094 — Restore island-hop packages even when their Bangka changed
-- Run AFTER 093_island_package_soft_delete_with_active_bookings.sql.
-- Availability remains guarded by the package and booking queries.
-- =============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_restore_island_package(p_package_id UUID)
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
    RAISE EXCEPTION 'Only admins may restore island-hopping packages.'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.deleted_at
  INTO v_deleted_at
  FROM public.island_packages p
  WHERE p.id = p_package_id
  FOR UPDATE OF p;

  IF NOT FOUND OR v_deleted_at IS NULL THEN
    RAISE EXCEPTION 'Deleted island-hopping package not found.'
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.island_packages
  SET deleted_at = NULL
  WHERE id = p_package_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_restore_island_package(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_restore_island_package(UUID) TO authenticated;

COMMIT;
