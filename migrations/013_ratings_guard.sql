-- =============================================================
-- 013 — RATINGS GUARD (Phase 4A)
--
-- Ratings were unreachable: the rate-trip screen pushed no booking id
-- and passed the bangkero's display NAME into bangkero_id (a UUID FK),
-- so every insert failed and the table stayed empty. Now that the UI
-- is being repaired to submit booking.operator_id, one row per
-- passenger per trip must be enforced at the database level too.
--
--   * Dedupe first (keep the newest row per booking+user, rating_id
--     breaking ties on equal created_at) — a demo DB may already
--     contain double taps from before the guard.
--   * UNIQUE (booking_id, user_id) — booking_id is NOT NULL (002), so
--     no NULL-distinct loophole. A racing second submit now surfaces
--     the duplicate key error, which the client maps to "already
--     rated" copy.
--
-- Run this in Supabase SQL Editor AFTER 012_mark_paid.sql
-- =============================================================

-- 1. Remove duplicate ratings, keeping the most recent per booking+user.
DELETE FROM ratings a
USING ratings b
WHERE a.booking_id = b.booking_id
  AND a.user_id = b.user_id
  AND a.id <> b.id
  AND (a.created_at < b.created_at
       OR (a.created_at = b.created_at AND a.id < b.id));

-- 2. One rating per passenger per trip.
CREATE UNIQUE INDEX IF NOT EXISTS ratings_one_per_booking_user
  ON ratings (booking_id, user_id);

-- =============================================================
-- DONE.
--
-- Verify:
--   SELECT booking_id, user_id, COUNT(*)
--     FROM ratings GROUP BY 1, 2 HAVING COUNT(*) > 1;  -- 0 rows
--   SELECT indexname FROM pg_indexes
--     WHERE tablename = 'ratings'
--       AND indexname = 'ratings_one_per_booking_user';
-- =============================================================
