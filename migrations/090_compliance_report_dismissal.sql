-- =============================================================
-- 090 — Persist dismissal of compliance reports
-- Run AFTER 089_rental_today.sql.
-- Dismissed reports remain stored for audit/history; the admin UI hides them.
-- Admin updates are protected by safety_alerts_update_admin from migration 003.
-- =============================================================

BEGIN;

ALTER TABLE public.safety_alerts
  ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.safety_alerts.dismissed_at IS
  'When an admin dismissed a compliance report from the review list; the report row is retained.';

COMMIT;
