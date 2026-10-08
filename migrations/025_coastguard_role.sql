-- =============================================================
-- 025. FOURTH MOBILE ROLE — COASTGUARD / LGU (B12)
-- =============================================================
-- Why: the papers/design treat BangkaGo as FOUR mobile roles —
-- Admin, Bangkero, Passenger, Coastguard/LGU — a view-only tier
-- below admin (live port queues + routes/fares, no editing).
-- 002's inline CHECK on users.user_role only allows the first three.
--
-- Postgres names an inline column CHECK <table>_<column>_check;
-- DROP IF EXISTS keeps the run idempotent if a hosted project
-- auto-renamed it.
--
-- Run order: after 021-024. Safe to re-run. Re-run `npm run seed`
-- afterwards so the coastguard demo account is created with the
-- new role accepted.
-- =============================================================

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_user_role_check;

ALTER TABLE users ADD CONSTRAINT users_user_role_check
  CHECK (user_role IN ('passenger', 'bangkero', 'admin', 'coastguard'));
