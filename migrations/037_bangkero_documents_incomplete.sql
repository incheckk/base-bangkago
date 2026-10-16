-- =============================================================
-- 037 — BANGKERO DOCUMENTS: 'incomplete' status + DEMO RESET
--
-- Bug: sign-up wrote verification_stat = 'pending' with all four
-- document columns NULL, so a fresh bangkero landed in "Documents
-- Under Review" without uploading anything, the upload screen
-- bounced them away (verify-boat redirects 'pending'), and the
-- admin queue (mobile document-review + web manage-bangkeros) could
-- APPROVE an empty submission.
--
-- Fix: a new status 'incomplete' = signed up, nothing submitted.
--   * 'incomplete' → the upload screen (documentsRoute fallthrough)
--   * 'pending'    → ONLY reachable through submitForReview, which
--                    throws unless all four paths exist, so the
--                    admin queue can no longer see an empty row.
-- The going-online trigger (010) and gates_ok only accept
-- 'verified' — unchanged.
--
-- ⚠ DEMO RESET at the bottom: every bangkero back to 'incomplete'
-- with their four doc paths cleared (files stay in the `docs`
-- bucket; only the references are dropped) so you can test the
-- full upload flow. The gcash_qr_url is NOT touched.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Widen the 002 CHECK and move the default off 'pending'
-- -------------------------------------------------------------
ALTER TABLE bangkeros
  DROP CONSTRAINT IF EXISTS bangkeros_verification_stat_check;

ALTER TABLE bangkeros
  ADD CONSTRAINT bangkeros_verification_stat_check
  CHECK (verification_stat IN ('incomplete', 'pending', 'verified', 'rejected'));

ALTER TABLE bangkeros
  ALTER COLUMN verification_stat SET DEFAULT 'incomplete';

-- -------------------------------------------------------------
-- 2. ⚠ DEMO RESET — status AND document references.
--    Every bangkero must re-upload; the admin queue empties until
--    they submit. Irreversible for the references (image files
--    themselves stay in storage).
-- -------------------------------------------------------------
UPDATE bangkeros
   SET verification_stat = 'incomplete',
       gov_issued_id = NULL,
       boat_registration_cert = NULL,
       coastal_permit = NULL,
       brgy_clearance = NULL,
       updated_at = now();
