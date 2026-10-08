-- =============================================================
-- 024. DEMAND_PREDICTIONS — idempotent prediction loads
-- =============================================================
-- Why: the ML pipeline (ml/src/export_sql.py) writes next-week
-- predictions as INSERT ... ON CONFLICT DO NOTHING. That clause
-- needs a matching unique constraint — without it Postgres errors
-- ("no unique or exclusion constraint matching the ON CONFLICT").
-- With it, re-running the export (or re-pasting the SQL) just
-- no-ops instead of duplicating rows, so the home screen's
-- "AI DEMAND TODAY" sum can never double-count.
--
-- route_id is nullable (002); Postgres treats NULLs as distinct in
-- unique indexes, so legacy/wildcard rows are unaffected. Our
-- prediction rows always carry a route_id.
--
-- Run order: after 021, 022, 023. Safe to re-run.
-- =============================================================

CREATE UNIQUE INDEX IF NOT EXISTS demand_predictions_route_date_key
  ON demand_predictions (route_id, prediction_date);
