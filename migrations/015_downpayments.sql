-- =============================================================
-- 015 — GCASH ESCROW DOWNPAYMENTS (Phase 4B)
--
-- Island-hopping packages and boat rentals take a 50% downpayment
-- through the ADMIN's GCash QR (escrow): the passenger pays outside
-- the app, then files the GCash reference number plus a screenshot
-- here. The admin approves it in-app; only bookkeeping — nothing is
-- gated on it.
--
-- Why its own table instead of rows in `payments`:
--   * payments.booking_id is NOT NULL (002) — rentals have no booking.
--   * payments has exactly ONE row per booking (the onboard fare);
--     a second row would break getPaymentByBooking's maybeSingle(),
--     the departure/sailing/manifest Record<bookingId, payment>
--     collapse, and mark_paid's unfiltered UPDATE (012).
--   So: downpayments holds the escrow rows, payments keeps its single
--   onboard-fare row (package remainder = total − downpayment), and
--   NOTHING in the Phase 3 payment stack changes.
--
-- Also in this migration:
--   * app_settings — key/value store for the admin's GCash QR URL.
--   * notifications_insert_admin — the approval notice crosses users
--     without a shared booking (005's policy only covers booking
--     parties).
--   * downpayments into the realtime publication so the passenger's
--     booking screen flips "awaiting confirmation" live.
--
-- Run this in Supabase SQL Editor AFTER 014_island_hopping.sql
-- =============================================================

-- 1. The escrow table.
CREATE TABLE IF NOT EXISTS downpayments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  amount DECIMAL(10, 2) NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'gcash',
  reference_num TEXT NOT NULL,
  proof_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'refunded')),
  booking_id UUID REFERENCES bookings(id) ON DELETE CASCADE,
  boat_rental_id UUID REFERENCES boat_rentals(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  CONSTRAINT downpayments_target CHECK (
    (booking_id IS NOT NULL AND boat_rental_id IS NULL)
    OR (boat_rental_id IS NOT NULL AND booking_id IS NULL)
  )
);

ALTER TABLE downpayments ENABLE ROW LEVEL SECURITY;

-- Insert: only your own booking or your own rental request.
DROP POLICY IF EXISTS "downpayments_insert_own" ON downpayments;
CREATE POLICY "downpayments_insert_own" ON downpayments
  FOR INSERT TO authenticated
  WITH CHECK (
    (booking_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM bookings b WHERE b.id = booking_id AND b.user_id = auth.uid()
    ))
    OR (boat_rental_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM boat_rentals r WHERE r.id = boat_rental_id AND r.user_id = auth.uid()
    ))
  );

-- Read: the passenger, the booking's operator, the rental's bangkero,
-- and the admin who holds the money.
DROP POLICY IF EXISTS "downpayments_select_passenger" ON downpayments;
CREATE POLICY "downpayments_select_passenger" ON downpayments
  FOR SELECT TO authenticated
  USING (
    (booking_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM bookings b WHERE b.id = booking_id AND b.user_id = auth.uid()
    ))
    OR (boat_rental_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM boat_rentals r WHERE r.id = boat_rental_id AND r.user_id = auth.uid()
    ))
  );

DROP POLICY IF EXISTS "downpayments_select_booking_operator" ON downpayments;
CREATE POLICY "downpayments_select_booking_operator" ON downpayments
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM bookings b WHERE b.id = booking_id AND b.operator_id = auth.uid()
  ));

DROP POLICY IF EXISTS "downpayments_select_rental_bangkero" ON downpayments;
CREATE POLICY "downpayments_select_rental_bangkero" ON downpayments
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM boat_rentals r
    JOIN bangkas k ON k.id = r.bangka_id
    WHERE r.id = boat_rental_id AND k.bangkero_id = auth.uid()
  ));

DROP POLICY IF EXISTS "downpayments_select_admin" ON downpayments;
CREATE POLICY "downpayments_select_admin" ON downpayments
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin'
  ));

-- Write: only the admin approves or refunds.
DROP POLICY IF EXISTS "downpayments_update_admin" ON downpayments;
CREATE POLICY "downpayments_update_admin" ON downpayments
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin'
  ));

-- 2. Realtime — the passenger's booking screen updates live.
DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER TABLE public.downpayments REPLICA IDENTITY FULL';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'replica identity skipped for downpayments: %', SQLERRM;
  END;
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.downpayments';
  EXCEPTION
    WHEN duplicate_object THEN RAISE NOTICE 'downpayments already in supabase_realtime';
    WHEN undefined_object THEN RAISE NOTICE 'publication supabase_realtime missing — enable Realtime first';
    WHEN OTHERS THEN RAISE NOTICE 'publish skipped for downpayments: %', SQLERRM;
  END;
END $$;

-- 3. app_settings — the admin's GCash QR lives here.
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_settings_select_all" ON app_settings;
CREATE POLICY "app_settings_select_all" ON app_settings
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "app_settings_insert_admin" ON app_settings;
CREATE POLICY "app_settings_insert_admin" ON app_settings
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin'
  ));

DROP POLICY IF EXISTS "app_settings_update_admin" ON app_settings;
CREATE POLICY "app_settings_update_admin" ON app_settings
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin'
  ));

INSERT INTO app_settings (key, value)
VALUES ('gcash_qr_url', '')
ON CONFLICT (key) DO NOTHING;

-- 4. Admin → anyone notifications (escrow approvals are not booking
--    parties, so 005's related policy does not apply).
DROP POLICY IF EXISTS "notifications_insert_admin" ON notifications;
CREATE POLICY "notifications_insert_admin" ON notifications
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin'
  ));

-- =============================================================
-- DONE.
--
-- Verify:
--   SELECT * FROM app_settings WHERE key = 'gcash_qr_url';
--   SELECT tablename FROM pg_publication_tables
--    WHERE pubname = 'supabase_realtime' AND tablename = 'downpayments';
--   SELECT polname FROM pg_policies WHERE tablename = 'downpayments';
-- =============================================================
