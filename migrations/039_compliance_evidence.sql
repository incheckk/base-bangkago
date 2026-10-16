-- 039 — Private evidence uploads for Admin and Coast Guard compliance reports.
-- Run manually in the Supabase SQL editor after migration 038.

ALTER TABLE public.safety_alerts
  ADD COLUMN IF NOT EXISTS evidence_paths TEXT[] NOT NULL DEFAULT '{}';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'compliance-evidence',
  'compliance-evidence',
  false,
  20971520,
  ARRAY['image/jpeg', 'image/png', 'application/pdf', 'video/mp4']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 20971520,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'application/pdf', 'video/mp4'];

CREATE OR REPLACE FUNCTION public.has_compliance_evidence_role(allowed_roles TEXT[])
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users AS u
    WHERE u.id = auth.uid()
      AND u.user_role = ANY (allowed_roles)
  );
$$;

REVOKE ALL ON FUNCTION public.has_compliance_evidence_role(TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_compliance_evidence_role(TEXT[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.has_compliance_evidence_role(TEXT[]) TO authenticated;

DROP POLICY IF EXISTS "compliance_evidence_upload_own" ON storage.objects;
CREATE POLICY "compliance_evidence_upload_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'compliance-evidence'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND public.has_compliance_evidence_role(ARRAY['admin', 'coastguard'])
  );

DROP POLICY IF EXISTS "compliance_evidence_read_admin_or_owner" ON storage.objects;
CREATE POLICY "compliance_evidence_read_admin_or_owner" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'compliance-evidence'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.has_compliance_evidence_role(ARRAY['admin'])
    )
  );

DROP POLICY IF EXISTS "compliance_evidence_delete_own" ON storage.objects;
CREATE POLICY "compliance_evidence_delete_own" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'compliance-evidence'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND public.has_compliance_evidence_role(ARRAY['admin', 'coastguard'])
  );
