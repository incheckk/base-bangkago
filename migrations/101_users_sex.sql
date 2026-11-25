-- =============================================================
-- 101 — BOOKER GENDER FOR THE MANIFEST
--
-- The View Manifest report shows a Gender column per passenger. Companions
-- have carried `passenger_details.sex` since 002, but the booker is a `users`
-- row and that table had no gender column at all — so the booker's cell
-- always read "Not on file" no matter what the passenger had entered.
--
-- This adds the account-level field beside the 079 age/address pair. Existing
-- rows remain null until the passenger picks a gender in Profile; the app now
-- requires the profile details before allowing a new booking.
--
-- Run in the SQL editor AFTER 100.
-- =============================================================

BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS sex TEXT
  CHECK (sex IN ('male', 'female', 'other'));

COMMENT ON COLUMN public.users.sex IS
  'Gender picked in Profile. Required by the app before a new booking; companions keep passenger_details.sex.';

COMMIT;
