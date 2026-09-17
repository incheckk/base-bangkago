-- =============================================================
-- BangkaGo RLS Bug Fixes
-- Run this in Supabase SQL Editor AFTER 003_add_rls_policies.sql
-- Fixes 4 critical RLS issues found during audit.
-- =============================================================

-- =============================================================
-- FIX 1: bookings_update_bangkero — WITH CHECK blocks state transitions
--
-- PROBLEM: The original policy requires trip_stat = 'open' in both
-- USING and WITH CHECK. When a bangkero accepts a booking, the new
-- trip_stat is 'accepted', so WITH CHECK fails and the UPDATE is denied.
--
-- FIX: Drop the broken policy and replace with two separate policies:
--   1. bookings_bangkero_accept: open → accepted
--   2. bookings_bangkero_complete: accepted → completed
-- =============================================================

DROP POLICY IF EXISTS "bookings_update_bangkero" ON bookings;

-- Accept: current row must be 'open', new row must be 'accepted'
CREATE POLICY "bookings_bangkero_accept" ON bookings
  FOR UPDATE TO authenticated
  USING (
    trip_stat = 'open'
    AND EXISTS (SELECT 1 FROM bangkeros WHERE id = auth.uid())
  ) WITH CHECK (
    trip_stat = 'accepted'
    AND EXISTS (SELECT 1 FROM bangkeros WHERE id = auth.uid())
  );

-- Complete: current row must be 'accepted' and assigned to this bangkero,
-- new row must be 'completed'
CREATE POLICY "bookings_bangkero_complete" ON bookings
  FOR UPDATE TO authenticated
  USING (
    trip_stat = 'accepted'
    AND operator_id = auth.uid()
  ) WITH CHECK (
    trip_stat = 'completed'
    AND operator_id = auth.uid()
  );

-- =============================================================
-- FIX 2: bangkero_verification — admin cannot INSERT
--
-- PROBLEM: The insert policy requires bangkero_id = auth.uid(), but
-- when an admin verifies a bangkero, the admin is the caller and
-- bangkero_id is a different user's ID.
--
-- FIX: Add an admin INSERT policy alongside the existing bangkero one.
-- =============================================================

CREATE POLICY "bangkero_verification_insert_admin" ON bangkero_verification
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin')
  );

-- =============================================================
-- FIX 3: wallets — no INSERT policy
--
-- PROBLEM: If a bangkero's wallet doesn't exist (not pre-seeded),
-- the app cannot create one. getWallet() only reads.
--
-- FIX: Allow bangkeros to insert their own wallet row.
-- =============================================================

CREATE POLICY "wallets_insert_own" ON wallets
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM bangkeros WHERE id = auth.uid() AND id = bangkero_id)
  );

-- =============================================================
-- FIX 4: payments — admin cannot SELECT for revenue stats
--
-- PROBLEM: payments_select_own only allows the booking owner to read.
-- Admin getAdminStats() queries payments for revenue but admin is
-- never the booking owner, so revenue always returns 0.
--
-- FIX: Add admin SELECT policy.
-- =============================================================

CREATE POLICY "payments_select_admin" ON payments
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin')
  );

-- =============================================================
-- DONE. All 4 critical RLS bugs fixed.
-- =============================================================
