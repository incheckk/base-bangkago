-- =============================================================
-- 016 — BOAT RENTALS (Phase 4C)
--
-- The "Boat Rental" tile was disabled since the first build. Rentals
-- reuse the boat_rentals table that has existed since 002 (status
-- flow pending → confirmed → cancelled/completed), but three things
-- were missing:
--
--   * bangkas.hourly_rate — what a charter costs per hour. DEFAULT 500
--     so every registered boat is rentable immediately; the bangkero
--     can update it (bangkas_update_own, 002).
--
--   * boat_rentals RLS for the OTHER side of the table: so far only
--     the renter could select/update their own rows. The rental's
--     bangkero needs to read incoming requests and confirm / decline /
--     complete them; the admin needs to read them for the escrow
--     screen (015 joins boat_rentals from downpayments).
--
--   * notifications_insert_rental_parties — cross-user notices without
--     a shared booking. Mirrors 005's notifications_insert_related
--     pattern: renter ↔ that boat's bangkero may notify each other.
--
-- Money: total = hourly_rate × hours. 50% is filed as a downpayments
-- escrow row (015, admin QR) at request time; the remainder is
-- collected IN PERSON on completion — no payments row is ever created
-- for rentals (012's mark_paid and the Phase 3 stack stay untouched).
--
-- Run this in Supabase SQL Editor AFTER 015_downpayments.sql
-- =============================================================

-- 1. Charter rate per boat + a creation stamp (002 gave boat_rentals
--    neither — the list screens need a sane newest-first order).
ALTER TABLE bangkas
  ADD COLUMN IF NOT EXISTS hourly_rate DECIMAL(10, 2) NOT NULL DEFAULT 500;

ALTER TABLE boat_rentals
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- 2. The bangkero side of boat_rentals.
DROP POLICY IF EXISTS "boat_rentals_select_bangkero" ON boat_rentals;
CREATE POLICY "boat_rentals_select_bangkero" ON boat_rentals
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM bangkas k WHERE k.id = bangka_id AND k.bangkero_id = auth.uid()
  ));

DROP POLICY IF EXISTS "boat_rentals_update_bangkero" ON boat_rentals;
CREATE POLICY "boat_rentals_update_bangkero" ON boat_rentals
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM bangkas k WHERE k.id = bangka_id AND k.bangkero_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM bangkas k WHERE k.id = bangka_id AND k.bangkero_id = auth.uid()
  ));

-- Admin: reads (escrow review joins rentals) and can cancel a rental
-- on a passenger's behalf, same as bookings.
DROP POLICY IF EXISTS "boat_rentals_select_admin" ON boat_rentals;
CREATE POLICY "boat_rentals_select_admin" ON boat_rentals
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin'
  ));

DROP POLICY IF EXISTS "boat_rentals_update_admin" ON boat_rentals;
CREATE POLICY "boat_rentals_update_admin" ON boat_rentals
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin'
  ));

-- 3. Rental notifications — requester ↔ the boat's bangkero.
DROP POLICY IF EXISTS "notifications_insert_rental_parties" ON notifications;
CREATE POLICY "notifications_insert_rental_parties" ON notifications
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM boat_rentals r
      JOIN bangkas k ON k.id = r.bangka_id
      WHERE (r.user_id = auth.uid() AND k.bangkero_id = user_id)
         OR (r.user_id = user_id AND k.bangkero_id = auth.uid())
    )
  );

-- 4. Name tags: users is otherwise own-row/admin-only (002/003), but a
--    rental carries no denormalized passenger name — the bangkero's
--    rentals screen joins users for the renter, and the passenger can
--    see who they are renting from. Only across an existing rental.
DROP POLICY IF EXISTS "users_select_rental_parties" ON users;
CREATE POLICY "users_select_rental_parties" ON users
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM boat_rentals r
      JOIN bangkas k ON k.id = r.bangka_id
      WHERE (k.bangkero_id = auth.uid() AND r.user_id = users.id)
         OR (r.user_id = auth.uid() AND k.bangkero_id = users.id)
    )
  );

-- =============================================================
-- DONE.
--
-- Verify:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'bangkas' AND column_name = 'hourly_rate';
--   SELECT polname FROM pg_policies WHERE tablename = 'boat_rentals'
--    ORDER BY polname;   -- expect 6 rows (own/bangkero/admin × select/update+insert)
--   SELECT polname FROM pg_policies
--    WHERE tablename = 'notifications' AND polname LIKE '%rental%';
-- =============================================================
