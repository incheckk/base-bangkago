-- =============================================================
-- BangkaGo — Accepted-Trip Rules
-- Run this in Supabase SQL Editor AFTER 006_enable_realtime_everywhere.sql
--
-- EVERY booking-state write the app performs now goes through one of
-- the SECURITY DEFINER RPCs below. This migration MUST be applied
-- before any demo — boarding toggles, no-shows, passenger cancels and
-- trip completion all fail without it.
--
-- Contents:
--   1. bookings.onboarded_at + bookings.no_show_at (no-show ban marker)
--   2. bangkeros.rating_penalty + check constraint
--   3. apply_bangkero_penalty (hardened: caller must be its passenger)
--   4. RLS — bangkero accepted-trip windows (onboard / no-show / note)
--   5. RLS — passenger safety alerts (escape / dispute trail)
--   6. payments refund policy REMOVED (fare is collected on board,
--      the app never refunds — payment_status is written once at
--      creation and never again)
--   7. RLS — notifications DELETE
--   8. trip_manifest checklist + 'completed' status
--   9. increment_wallet_balance (hardened: wallet owner or admin)
--  10. Write-path RPCs: set_booking_boarded, mark_no_show,
--      cancel_own_booking, complete_trip
--  11. bookings_bangkero_complete re-created with onboarded_at guard
-- =============================================================

-- =============================================================
-- 1. bookings.onboarded_at + bookings.no_show_at
--
-- onboarded_at: set when the bangkero confirms the party is aboard;
-- cleared if they un-check it.
-- no_show_at:   stamped when the bangkero marks the passenger(s)
--               didn't-board. The no-show ban reads the 2 newest
--               stamps for a passenger (30 min, 60 min if a repeat
--               within 30 days).
-- =============================================================
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS no_show_at TIMESTAMPTZ;

-- =============================================================
-- 2. bangkeros.rating_penalty
--
-- Deducted from the passenger average by the accept gate:
--   effective = avg(ratings) (5.0 when unrated) - rating_penalty
--   effective <= 3.0  ->  acceptBooking throws
-- =============================================================
ALTER TABLE bangkeros ADD COLUMN IF NOT EXISTS rating_penalty NUMERIC(3, 1) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bangkeros_rating_penalty_check'
  ) THEN
    ALTER TABLE bangkeros ADD CONSTRAINT bangkeros_rating_penalty_check
      CHECK (rating_penalty >= 0 AND rating_penalty <= 5);
  END IF;
END $$;

-- Star penalties are only ever one of the two fixed incident amounts.
-- SECURITY DEFINER: RLS stops passengers writing bangkeros directly.
-- Hardened: a caller may only penalise a bangkero they were actually
-- matched with (or they must be an admin) — otherwise any signed-in
-- user could weaponise the RPC against any operator.
CREATE OR REPLACE FUNCTION apply_bangkero_penalty(p_bangkero UUID, p_stars NUMERIC)
RETURNS VOID AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_stars NOT IN (0.5, 1.0) THEN
    RAISE EXCEPTION 'penalty must be 0.5 (missed pickup) or 1.0 (false onboard)';
  END IF;
  IF NOT EXISTS (
        SELECT 1 FROM bookings WHERE operator_id = p_bangkero AND user_id = auth.uid()
      )
      AND NOT EXISTS (
        SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin'
      ) THEN
    RAISE EXCEPTION 'no booking with this bangkero';
  END IF;
  UPDATE bangkeros
  SET rating_penalty = COALESCE(rating_penalty, 0) + p_stars,
      updated_at = now()
  WHERE id = p_bangkero;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- =============================================================
-- 3. RLS — the bangkero accepted-trip windows
--
-- The app writes through the RPCs in section 10; these policies stay
-- as defense-in-depth for any direct update and document the intent.
-- =============================================================

-- Boarding toggle: operator updates an accepted booking and it must
-- STAY accepted (only onboarded_at changes).
DROP POLICY IF EXISTS "bookings_bangkero_onboard" ON bookings;
CREATE POLICY "bookings_bangkero_onboard" ON bookings
  FOR UPDATE TO authenticated
  USING (trip_stat = 'accepted' AND operator_id = auth.uid())
  WITH CHECK (trip_stat = 'accepted' AND operator_id = auth.uid());

-- No-show: accepted -> cancelled, operator only. First action wins —
-- the passenger's own escape/dispute races against this one and RLS
-- lets whichever UPDATE lands first through.
DROP POLICY IF EXISTS "bookings_bangkero_no_show" ON bookings;
CREATE POLICY "bookings_bangkero_no_show" ON bookings
  FOR UPDATE TO authenticated
  USING (trip_stat = 'accepted' AND operator_id = auth.uid())
  WITH CHECK (trip_stat = 'cancelled' AND operator_id = auth.uid());

-- Cancelled-row notes: kept for the rare direct reason write; the
-- mark_no_show RPC now stamps the reason in the same statement.
DROP POLICY IF EXISTS "bookings_bangkero_cancelled_note" ON bookings;
CREATE POLICY "bookings_bangkero_cancelled_note" ON bookings
  FOR UPDATE TO authenticated
  USING (trip_stat = 'cancelled' AND operator_id = auth.uid())
  WITH CHECK (trip_stat = 'cancelled' AND operator_id = auth.uid());

-- =============================================================
-- 4. RLS — passenger safety alerts (escape / dispute trail)
--
-- The bangkero-side inserts already exist (003, 005); passengers had
-- no way to file the alert that accompanies a penalty.
-- =============================================================
DROP POLICY IF EXISTS "safety_alerts_insert_passenger" ON safety_alerts;
CREATE POLICY "safety_alerts_insert_passenger" ON safety_alerts
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'passenger')
  );

-- =============================================================
-- 5. payments — refund policy REMOVED
--
-- The app no longer refunds: the fare is collected on board, so a
-- cancelled / no-show / disputed trip simply charges nothing.
-- refundBookingPayment() and updatePaymentStatus() were deleted from
-- payment.service.ts and payments rows are never UPDATEd.
-- =============================================================
DROP POLICY IF EXISTS "payments_update_refund" ON payments;

-- =============================================================
-- 6. RLS — notifications DELETE
--
-- No screen clears notifications yet; this is the policy that lets
-- "clear all" exist when it does.
-- =============================================================
DROP POLICY IF EXISTS "notifications_delete_own" ON notifications;
CREATE POLICY "notifications_delete_own" ON notifications
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- =============================================================
-- 7. trip_manifest — persisted safety checklist + 'completed'
--
-- The departure checklist was app-state only; it now survives a
-- restart. 'completed' lets the manifest close out after arrival.
-- =============================================================
ALTER TABLE trip_manifest ADD COLUMN IF NOT EXISTS checklist JSONB;

ALTER TABLE trip_manifest DROP CONSTRAINT IF EXISTS trip_manifest_status_check;
ALTER TABLE trip_manifest ADD CONSTRAINT trip_manifest_status_check
  CHECK (status IN ('draft', 'finalized', 'completed', 'cancelled'));

-- =============================================================
-- 8. increment_wallet_balance (hardened)
--
-- wallet.service.ts calls this RPC in three places. SECURITY DEFINER
-- means RLS no longer applies — so the function itself must verify
-- the caller owns the wallet (or is an admin), otherwise any signed
-- in user could credit their own balance.
-- =============================================================
CREATE OR REPLACE FUNCTION increment_wallet_balance(p_wallet_id UUID, p_amount NUMERIC)
RETURNS VOID AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT EXISTS (
        SELECT 1 FROM wallets w
        JOIN bangkeros bk ON bk.id = w.bangkero_id
        WHERE w.id = p_wallet_id AND bk.id = auth.uid()
      )
      AND NOT EXISTS (
        SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin'
      ) THEN
    RAISE EXCEPTION 'not your wallet';
  END IF;
  UPDATE wallets
  SET balance = COALESCE(balance, 0) + p_amount
  WHERE id = p_wallet_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wallet % not found', p_wallet_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- =============================================================
-- 9. Write-path RPCs
--
-- RLS can restrict WHO updates a row but not WHICH COLUMNS — a raw
-- UPDATE from a hostile client could rewrite fares while boarding.
-- Each RPC touches only the columns its action owns, verifies the
-- caller's relationship, and RAISEs when the row is no longer in the
-- expected state (so a lost race surfaces as a real error instead of
-- a silent 0-row success).
-- =============================================================

-- Boarding toggle: writes ONLY onboarded_at. Operator + accepted only.
CREATE OR REPLACE FUNCTION set_booking_boarded(p_booking_id UUID, p_boarded BOOLEAN)
RETURNS VOID AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  UPDATE bookings
  SET onboarded_at = CASE WHEN p_boarded THEN now() END
  WHERE id = p_booking_id
    AND trip_stat = 'accepted'
    AND operator_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'this trip changed';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- No-show: accepted -> cancelled + no_show_at + cancel_reason in ONE
-- statement. Operator only. First action wins; the passenger's escape
-- or dispute racing this RPC loses with a visible error.
CREATE OR REPLACE FUNCTION mark_no_show(p_booking_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS VOID AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  UPDATE bookings
  SET trip_stat = 'cancelled',
      cancelled_at = now(),
      no_show_at = now(),
      cancel_reason = COALESCE(
        p_reason,
        'Passenger(s) did not board — marked no-show by the bangkero.'
      )
  WHERE id = p_booking_id
    AND trip_stat = 'accepted'
    AND operator_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'this trip changed';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Passenger cancel (plain, escape, dispute all funnel here): own row,
-- open or accepted, reason in the same statement.
CREATE OR REPLACE FUNCTION cancel_own_booking(p_booking_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS VOID AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  UPDATE bookings
  SET trip_stat = 'cancelled',
      cancelled_at = now(),
      cancel_reason = p_reason
  WHERE id = p_booking_id
    AND user_id = auth.uid()
    AND trip_stat IN ('open', 'accepted');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'this booking was already cancelled or has changed';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Completion: operator + accepted + everyone confirmed aboard.
-- This is the DB-level gate that stops "Mark completed" from
-- bypassing the boarding step.
CREATE OR REPLACE FUNCTION complete_trip(p_booking_id UUID)
RETURNS VOID AS $$
DECLARE
  v bookings%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  SELECT * INTO v FROM bookings WHERE id = p_booking_id;
  IF NOT FOUND OR v.trip_stat <> 'accepted'
     OR v.operator_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'this trip changed';
  END IF;
  IF v.onboarded_at IS NULL THEN
    RAISE EXCEPTION 'confirm passengers on board before completing this trip';
  END IF;
  UPDATE bookings
  SET trip_stat = 'completed',
      completed_at = now()
  WHERE id = p_booking_id
    AND trip_stat = 'accepted';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'this trip changed';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- =============================================================
-- 10. bookings_bangkero_complete — re-created with the boarding gate
--
-- Same policy as 004, plus onboarded_at IS NOT NULL in WITH CHECK:
-- even a hostile direct UPDATE cannot complete a trip whose
-- passengers were never confirmed aboard.
-- =============================================================
DROP POLICY IF EXISTS "bookings_bangkero_complete" ON bookings;
CREATE POLICY "bookings_bangkero_complete" ON bookings
  FOR UPDATE TO authenticated
  USING (
    trip_stat = 'accepted'
    AND operator_id = auth.uid()
  ) WITH CHECK (
    trip_stat = 'completed'
    AND operator_id = auth.uid()
    AND onboarded_at IS NOT NULL
  );

-- =============================================================
-- 11. One active booking per passenger (commented out on purpose)
--
-- The client now guards with getActiveBooking() before createBooking,
-- but a DB-wide unique index would REJECT the whole migration if old
-- test rows already hold duplicate open bookings. Run it manually once
-- the prototype data is clean:
--
-- CREATE UNIQUE INDEX bookings_one_active_per_passenger
--   ON bookings (user_id) WHERE trip_stat IN ('open', 'accepted');
-- =============================================================

-- =============================================================
-- DONE.
-- =============================================================
