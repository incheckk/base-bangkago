-- 017_flat_fare_70.sql
-- Flatten all route fares to ₱70 for pilot (already applied manually via dashboard).
-- Idempotent: safe to re-run.
UPDATE routes SET base_fare = 70;
