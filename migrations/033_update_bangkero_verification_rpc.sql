-- 033 — Admin bangkero verification RPC.
-- Run manually in the Supabase SQL editor after migration 032.

CREATE OR REPLACE FUNCTION public.update_bangkero_verification(
  p_bangkero_id UUID,
  p_status TEXT,
  p_remarks TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = auth.uid()
      AND user_role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only admins may update bangkero verification.'
      USING ERRCODE = '42501';
  END IF;

  IF p_status IS NULL OR p_status NOT IN ('verified', 'rejected') THEN
    RAISE EXCEPTION 'Verification status must be verified or rejected.'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.bangkeros
  SET verification_stat = p_status,
      updated_at = now()
  WHERE id = p_bangkero_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bangkero not found.'
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.bangkero_verification (
    bangkero_id,
    admin_id,
    status,
    remarks
  )
  VALUES (
    p_bangkero_id,
    auth.uid(),
    CASE p_status
      WHEN 'verified' THEN 'approved'
      ELSE 'rejected'
    END,
    p_remarks
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_bangkero_verification(UUID, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_bangkero_verification(UUID, TEXT, TEXT)
  TO authenticated;

NOTIFY pgrst, 'reload schema';