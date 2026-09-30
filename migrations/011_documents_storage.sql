-- =============================================================
-- 011 — DOCUMENTS STORAGE + VERIFICATION TIMESTAMPS (Phase 3B)
--
-- The four verification documents and the GCash QR code are images
-- picked on the phone. They live in a PUBLIC storage bucket; the
-- bangkeros row keeps only the object path in its existing TEXT
-- columns (gov_issued_id / boat_registration_cert / coastal_permit /
-- brgy_clearance — written by no one until now).
--
-- Owner-path rule: every object is stored under
-- docs/{auth.uid()}/… and only its owner may write it. Reads are
-- public (demo decision — signed URLs for launch, see
-- LAUNCH_DEFERRED_FEATURES.txt).
--
-- Public bucket caveat: anyone with the URL can read the documents.
-- Acceptable for the classroom demo; switch the bucket to private +
-- signed URLs before public launch.
-- =============================================================

-- 1. The bucket (idempotent).
INSERT INTO storage.buckets (id, name, public)
VALUES ('docs', 'docs', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 2. Owner-only writes: folder name must start with the caller's uid.
DROP POLICY IF EXISTS "docs_owner_insert" ON storage.objects;
CREATE POLICY "docs_owner_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'docs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "docs_owner_update" ON storage.objects;
CREATE POLICY "docs_owner_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'docs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'docs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "docs_owner_delete" ON storage.objects;
CREATE POLICY "docs_owner_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'docs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 3. Public read (matches the public bucket — documents are viewable
--    by their URL; writes remain owner-scoped).
DROP POLICY IF EXISTS "docs_public_read" ON storage.objects;
CREATE POLICY "docs_public_read" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'docs');

-- 4. When each review round was submitted — the bangkero screen shows
--    "submitted" times and admin history reads newest-first.
ALTER TABLE bangkero_verification
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- 5. The bangkero's GCash QR image (path in the same public bucket).
ALTER TABLE bangkeros
  ADD COLUMN IF NOT EXISTS gcash_qr_url TEXT;

-- =============================================================
-- DONE.
--
-- Verify:
--   SELECT id, public FROM storage.buckets WHERE id = 'docs';
--   SELECT policyname FROM pg_policies
--    WHERE tablename = 'objects' AND schemaname = 'storage'
--      AND policyname LIKE 'docs%';
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'bangkero_verification' AND column_name = 'created_at';
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'bangkeros' AND column_name = 'gcash_qr_url';
-- =============================================================
