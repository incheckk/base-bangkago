-- =============================================================
-- BangkaGo RLS Policy Additions
-- Adds INSERT/UPDATE/DELETE policies for tables that only had SELECT.
-- Run this in Supabase SQL Editor AFTER 002_create_all_tables.sql
-- =============================================================

-- =============================================================
-- NOTIFICATIONS — add UPDATE (mark as read)
-- =============================================================
CREATE POLICY "notifications_update_own" ON notifications
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- =============================================================
-- WALLETS — add UPDATE (balance changes)
-- =============================================================
CREATE POLICY "wallets_update_own" ON wallets
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM bangkeros WHERE id = auth.uid() AND id = bangkero_id))
  WITH CHECK (EXISTS (SELECT 1 FROM bangkeros WHERE id = auth.uid() AND id = bangkero_id));

-- =============================================================
-- WALLET_TRANSACTIONS — add INSERT
-- =============================================================
CREATE POLICY "wallet_transactions_insert_own" ON wallet_transactions
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM wallets w
    JOIN bangkeros b ON b.id = w.bangkero_id
    WHERE w.id = wallet_id AND b.id = auth.uid()
  ));

-- =============================================================
-- PAYMENTS — add INSERT
-- =============================================================
CREATE POLICY "payments_insert_own" ON payments
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM bookings b WHERE b.id = booking_id AND b.user_id = auth.uid()
  ));

-- =============================================================
-- PASSENGER_DETAILS — add INSERT
-- =============================================================
CREATE POLICY "passenger_details_insert_own" ON passenger_details
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM bookings b WHERE b.id = booking_id AND b.user_id = auth.uid()
  ));

-- =============================================================
-- PARCELS — add INSERT, UPDATE
-- =============================================================
CREATE POLICY "parcels_insert_own" ON parcels
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "parcels_update_own" ON parcels
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- =============================================================
-- PARCEL_ITEMS — add INSERT
-- =============================================================
CREATE POLICY "parcel_items_insert_own" ON parcel_items
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM parcels p WHERE p.id = parcel_id AND p.user_id = auth.uid()
  ));

-- =============================================================
-- RATINGS — already has INSERT, add UPDATE
-- =============================================================
CREATE POLICY "ratings_update_own" ON ratings
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- =============================================================
-- VESSEL_TRACKING — add INSERT (bangkeros log GPS)
-- =============================================================
CREATE POLICY "vessel_tracking_insert_bangkero" ON vessel_tracking
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM bangkas WHERE id = bangka_id AND bangkero_id = auth.uid()
  ));

-- =============================================================
-- SAFETY_ALERTS — add INSERT, UPDATE
-- =============================================================
CREATE POLICY "safety_alerts_insert_bangkero" ON safety_alerts
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM bangkas WHERE id = bangka_id AND bangkero_id = auth.uid())
    OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin')
  );

CREATE POLICY "safety_alerts_update_admin" ON safety_alerts
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin')
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin')
  );

-- =============================================================
-- TRIP_MANIFEST — add INSERT, UPDATE
-- =============================================================
CREATE POLICY "trip_manifest_insert_bangkero" ON trip_manifest
  FOR INSERT TO authenticated
  WITH CHECK (bangkero_id = auth.uid());

CREATE POLICY "trip_manifest_update_bangkero" ON trip_manifest
  FOR UPDATE TO authenticated
  USING (bangkero_id = auth.uid()) WITH CHECK (bangkero_id = auth.uid());

-- =============================================================
-- MANIFEST_PASSENGERS — add INSERT
-- =============================================================
CREATE POLICY "manifest_passengers_insert_bangkero" ON manifest_passengers
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM trip_manifest tm WHERE tm.id = manifest_id AND tm.bangkero_id = auth.uid()
  ));

-- =============================================================
-- MANIFEST_PARCELS — add INSERT
-- =============================================================
CREATE POLICY "manifest_parcels_insert_bangkero" ON manifest_parcels
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM trip_manifest tm WHERE tm.id = manifest_id AND tm.bangkero_id = auth.uid()
  ));

-- =============================================================
-- BANGKERO_VERIFICATION — add INSERT, UPDATE (admin only)
-- =============================================================
CREATE POLICY "bangkero_verification_insert_bangkero" ON bangkero_verification
  FOR INSERT TO authenticated
  WITH CHECK (bangkero_id = auth.uid());

CREATE POLICY "bangkero_verification_update_admin" ON bangkero_verification
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin')
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin')
  );

-- =============================================================
-- BOAT_RENTALS — add INSERT, UPDATE
-- =============================================================
CREATE POLICY "boat_rentals_insert_own" ON boat_rentals
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "boat_rentals_update_own" ON boat_rentals
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- =============================================================
-- PORTS — add INSERT, UPDATE, DELETE (admin only)
-- =============================================================
CREATE POLICY "ports_insert_admin" ON ports
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin'));

CREATE POLICY "ports_update_admin" ON ports
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin'));

CREATE POLICY "ports_delete_admin" ON ports
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin'));

-- =============================================================
-- ROUTES — add INSERT, UPDATE, DELETE (admin only)
-- =============================================================
CREATE POLICY "routes_insert_admin" ON routes
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin'));

CREATE POLICY "routes_update_admin" ON routes
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin'));

CREATE POLICY "routes_delete_admin" ON routes
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin'));

-- =============================================================
-- ROUTE_STOPS — add INSERT, UPDATE, DELETE (admin only)
-- =============================================================
CREATE POLICY "route_stops_insert_admin" ON route_stops
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin'));

CREATE POLICY "route_stops_update_admin" ON route_stops
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin'));

CREATE POLICY "route_stops_delete_admin" ON route_stops
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin'));

-- =============================================================
-- ISLAND_PACKAGES — add INSERT, UPDATE, DELETE (admin only)
-- =============================================================
CREATE POLICY "island_packages_insert_admin" ON island_packages
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin'));

CREATE POLICY "island_packages_update_admin" ON island_packages
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin'));

CREATE POLICY "island_packages_delete_admin" ON island_packages
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin'));

-- =============================================================
-- USERS — add admin policies for managing other users
-- =============================================================
CREATE POLICY "users_select_admin" ON users
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin'));

CREATE POLICY "users_update_admin" ON users
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin'));

-- =============================================================
-- BANGKEROS — add admin update policy
-- =============================================================
CREATE POLICY "bangkeros_update_admin" ON bangkeros
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin'));

-- =============================================================
-- DONE. All tables now have write policies.
-- =============================================================
