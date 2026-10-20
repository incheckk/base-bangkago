-- =============================================================
-- 061. FRONTPAGE SUBMISSIONS — PUBLIC CONTACT + PARTNER FORMS
-- =============================================================
-- Why: the web FrontPage has shipped forms that write to a table no
-- migration ever created. web/FrontPage/script.js inserts as the anon
-- key from two places — the Contact Us "Send Message" button
-- (submission_type = 'contact') and the "Join Us" application
-- (submission_type = 'partner') — and Admin → Report & Compliance →
-- User Feedback reads contact rows back. Without this table both paths
-- fail (PGRST205 / 42P01) and the panel shows its "not configured yet"
-- notice.
--
-- Shape: one table, two mutually exclusive submission shapes, enforced
-- twice — a table CHECK (frontpage_submission_fields_match_type) for
-- data at rest, and the same predicate inside the INSERT policy so bad
-- rows are rejected on the way in rather than on the way out.
--
--   * contact → subject required; phone and partner_role must be NULL
--   * partner → phone + partner_role required; subject must be NULL
--
-- Security posture (cf. LAUNCH_DEFERRED E3 — wide-open SELECTs):
--   * INSERT only, to anon + authenticated, with a validating WITH CHECK
--     that repeats every length/regex bound. Column-level GRANT covers
--     exactly the seven writable columns; id and created_at are not
--     client-settable.
--   * No UPDATE and no DELETE policy exists, so submissions are
--     append-only from a client's point of view.
--   * SELECT is admin-only, using the same
--     EXISTS (users WHERE id = auth.uid() AND user_role = 'admin')
--     predicate the 003–007 policies already rely on. Message bodies are
--     stranger-supplied PII, so this table starts closed.
--
-- partner_role mirrors the three <option> values of #joinRole in
-- web/FrontPage/index.html ('Passenger', 'Bangkero', 'Bangka Operator').
-- If the form grows a role, change BOTH the column CHECK and the policy
-- below in the same migration.
--
-- Validation bounds match the client-side checks in script.js
-- (name ≥ 2, email format, subject ≥ 3, message ≥ 10), so a form the
-- browser already accepted is a form the database accepts too. The
-- browser sets no maxlength, so a message over 5000 chars still lands
-- here as a generic submit error — a known, accepted limit.
--
-- ⚠ No demo reset. Safe to run on a live database.
-- Run order: AFTER 060. Forward-only — never delete 002-061.
-- =============================================================

-- 1. Table. CREATE ... IF NOT EXISTS keeps this re-runnable: if an
--    earlier copy of this migration was pasted into the SQL editor
--    under a different number, the run converges on the same schema.
CREATE TABLE IF NOT EXISTS public.frontpage_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_type TEXT NOT NULL CHECK (submission_type IN ('contact', 'partner')),
  full_name TEXT NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 2 AND 120),
  email TEXT NOT NULL CHECK (
    char_length(btrim(email)) BETWEEN 3 AND 254
    AND btrim(email) ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  phone TEXT CHECK (phone IS NULL OR char_length(btrim(phone)) BETWEEN 7 AND 32),
  subject TEXT CHECK (subject IS NULL OR char_length(btrim(subject)) BETWEEN 3 AND 160),
  message TEXT NOT NULL CHECK (char_length(btrim(message)) BETWEEN 10 AND 5000),
  partner_role TEXT CHECK (partner_role IS NULL OR partner_role IN (
    'Passenger', 'Bangkero', 'Bangka Operator'
  )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT frontpage_submission_fields_match_type CHECK (
    (submission_type = 'contact' AND subject IS NOT NULL AND partner_role IS NULL)
    OR
    (submission_type = 'partner' AND phone IS NOT NULL AND partner_role IS NOT NULL AND subject IS NULL)
  )
);

-- 2. Newest-first, matching report-compliance.html's
--    .order('created_at', { ascending: false }).limit(200).
CREATE INDEX IF NOT EXISTS frontpage_submissions_created_at_idx
  ON public.frontpage_submissions (created_at DESC);

ALTER TABLE public.frontpage_submissions ENABLE ROW LEVEL SECURITY;

-- 3. Grants: revoke the whole table first, then hand back only the two
--    verbs that matter — an authenticated client may write a new
--    submission and may read it back if (and only if) the SELECT policy
--    below says it is an admin. No UPDATE, no DELETE, no TRUNCATE.
REVOKE ALL ON TABLE public.frontpage_submissions FROM PUBLIC, anon, authenticated;
GRANT INSERT (submission_type, full_name, email, phone, subject, message, partner_role)
  ON TABLE public.frontpage_submissions TO anon, authenticated;
GRANT SELECT ON TABLE public.frontpage_submissions TO authenticated;

-- 4. Public write path. The WITH CHECK restates every column CHECK the
--    shape constraint depends on, so an anonymous visitor cannot smuggle
--    a half-formed row past the table definition.
DROP POLICY IF EXISTS frontpage_submissions_public_insert ON public.frontpage_submissions;
CREATE POLICY frontpage_submissions_public_insert
  ON public.frontpage_submissions
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    char_length(btrim(full_name)) BETWEEN 2 AND 120
    AND char_length(btrim(email)) BETWEEN 3 AND 254
    AND btrim(email) ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    AND char_length(btrim(message)) BETWEEN 10 AND 5000
    AND (
      (submission_type = 'contact'
        AND subject IS NOT NULL
        AND char_length(btrim(subject)) BETWEEN 3 AND 160
        AND partner_role IS NULL)
      OR
      (submission_type = 'partner'
        AND phone IS NOT NULL
        AND char_length(btrim(phone)) BETWEEN 7 AND 32
        AND partner_role IN ('Passenger', 'Bangkero', 'Bangka Operator')
        AND subject IS NULL)
    )
  );

-- 5. Read path: admins only. The subquery runs as the caller, and an
--    admin always passes users_select_own (002) on their own row, so the
--    EXISTS resolves to true for them and to false for everyone else.
DROP POLICY IF EXISTS frontpage_submissions_admin_select ON public.frontpage_submissions;
CREATE POLICY frontpage_submissions_admin_select
  ON public.frontpage_submissions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND user_role = 'admin'
    )
  );
