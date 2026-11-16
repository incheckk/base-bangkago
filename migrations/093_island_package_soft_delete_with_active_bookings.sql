-- =============================================================
-- 093 — Allow reversible package deletion with active bookings
-- Run AFTER 092_island_package_delete_with_history.sql.
-- Deleted packages are hidden from new listings; bookings remain linked.
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

  UPDATE public.island_packages
  SET deleted_at = now()
  WHERE id = p_package_id;
END;
$$;

COMMENT ON FUNCTION public.admin_delete_island_package(UUID) IS
  'Soft-deletes an island-hop package. Existing booking rows remain linked; the package is hidden from new passenger listings until restored.';

REVOKE ALL ON FUNCTION public.admin_delete_island_package(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_island_package(UUID) TO authenticated;

COMMIT;
