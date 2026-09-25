-- =============================================================
-- BangkaGo Service Wiring — RLS Additions
-- Run this in Supabase SQL Editor AFTER 004_fix_rls_bugs.sql
-- Enables the 9 critical service functions to write to the DB.
-- =============================================================

-- =============================================================
-- 1. NOTIFICATIONS — cross-user INSERT (booking parties only)
--    createNotification(): bangkero -> passenger on accept/complete,
--    passenger -> bangkero on cancel of an accepted booking.
--    Existing notifications_insert_own still covers self-inserts.
-- =============================================================
CREATE POLICY "notifications_insert_related" ON notifications
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM bookings b
      WHERE (b.user_id = auth.uid() AND b.operator_id = user_id)
         OR (b.user_id = user_id AND b.operator_id = auth.uid())
    )
  );

-- =============================================================
-- 2. PARCELS — bangkero assigned to the booking reads + updates
--    updateParcelStatus() by BANGKERO; arrived-screen parcel reads.
--    Without this the UPDATE silently matches 0 rows.
-- =============================================================
CREATE POLICY "parcels_select_bangkero" ON parcels
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM bookings b WHERE b.id = booking_id AND b.operator_id = auth.uid())
  );

CREATE POLICY "parcels_update_bangkero" ON parcels
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM bookings b WHERE b.id = booking_id AND b.operator_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM bookings b WHERE b.id = booking_id AND b.operator_id = auth.uid())
  );

-- =============================================================
-- 3. PARCEL_ITEMS — RLS was never enabled; 003's insert policy is
--    inert. Enable it and add a SELECT policy so items are readable.
-- =============================================================
ALTER TABLE parcel_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "parcel_items_select_own" ON parcel_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM parcels p WHERE p.id = parcel_id AND p.user_id = auth.uid())
  );

-- =============================================================
-- 4. BANGKERO_VERIFICATION — admin INSERT (idempotent re-add of
--    004 FIX 2; safe if 004 already ran). Needed by verifyBangkero().
-- =============================================================
DROP POLICY IF EXISTS "bangkero_verification_insert_admin" ON bangkero_verification;
CREATE POLICY "bangkero_verification_insert_admin" ON bangkero_verification
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin')
  );

-- Admin can read any bangkero's verification history
CREATE POLICY "bangkero_verification_select_admin" ON bangkero_verification
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin')
  );

-- =============================================================
-- 5. SAFETY_ALERTS — bangkero port-only alert (bangka_id IS NULL)
--    createAlert() from the SOS screen may not have a bangka loaded;
--    existing policy 003 requires a bangka owned by the caller.
-- =============================================================
CREATE POLICY "safety_alerts_insert_bangkero_port" ON safety_alerts
  FOR INSERT TO authenticated
  WITH CHECK (
    bangka_id IS NULL
    AND EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'bangkero')
  );

-- =============================================================
-- DONE. Items needing NO policy: createManifest (003 covers it),
-- createParcel -> parcels (passenger self), createBooking,
-- createPayment, updateName RPC, updateBoat,
-- bangkas/bookings/routes/ports reads, notifications read.
-- =============================================================
