-- 045 — Allow admins to manage vessels and support unassigned vessels.

ALTER TABLE public.bangkas
  ALTER COLUMN bangkero_id DROP NOT NULL;

DROP POLICY IF EXISTS "bangkas_admin_insert" ON public.bangkas;
CREATE POLICY "bangkas_admin_insert" ON public.bangkas
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND user_role = 'admin'
    )
  );

DROP POLICY IF EXISTS "bangkas_admin_update" ON public.bangkas;
CREATE POLICY "bangkas_admin_update" ON public.bangkas
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND user_role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND user_role = 'admin'
    )
  );

DROP POLICY IF EXISTS "bangkas_admin_delete" ON public.bangkas;
CREATE POLICY "bangkas_admin_delete" ON public.bangkas
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND user_role = 'admin'
    )
  );