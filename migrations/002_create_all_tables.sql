-- =============================================================
-- BangkaGo Full Schema Migration
-- Follows the ERD exactly. BANKEROS → BANGKEROS typo fix applied.
-- Run this in Supabase SQL Editor.
--
-- WARNING: This drops existing tables (profiles, operators, piers,
-- routes, bookings) and recreates everything from scratch.
-- =============================================================

-- Clean up old tables and triggers
DROP TABLE IF EXISTS manifest_parcels CASCADE;
DROP TABLE IF EXISTS manifest_passengers CASCADE;
DROP TABLE IF EXISTS trip_manifest CASCADE;
DROP TABLE IF EXISTS demand_predictions CASCADE;
DROP TABLE IF EXISTS weather_data CASCADE;
DROP TABLE IF EXISTS route_stops CASCADE;
DROP TABLE IF EXISTS parcel_items CASCADE;
DROP TABLE IF EXISTS parcels CASCADE;
DROP TABLE IF EXISTS island_packages CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS passenger_details CASCADE;
DROP TABLE IF EXISTS bookings CASCADE;
DROP TABLE IF EXISTS ratings CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS wallet_transactions CASCADE;
DROP TABLE IF EXISTS wallets CASCADE;
DROP TABLE IF EXISTS boat_rentals CASCADE;
DROP TABLE IF EXISTS safety_alerts CASCADE;
DROP TABLE IF EXISTS vessel_tracking CASCADE;
DROP TABLE IF EXISTS bangkero_verification CASCADE;
DROP TABLE IF EXISTS bangkas CASCADE;
DROP TABLE IF EXISTS routes CASCADE;
DROP TABLE IF EXISTS bangkeros CASCADE;
DROP TABLE IF EXISTS ports CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Drop old tables if they exist
DROP TABLE IF EXISTS profiles CASCADE;
DROP TABLE IF EXISTS operators CASCADE;
DROP TABLE IF EXISTS piers CASCADE;

-- Drop old triggers/functions
DROP FUNCTION IF EXISTS set_booking_ref();
DROP FUNCTION IF EXISTS append_rejected_by(booking_id uuid, operator_uid uuid);
DROP FUNCTION IF EXISTS update_display_name(p_uid uuid, p_first_name text, p_last_name text, p_is_bangkero boolean);

-- =============================================================
-- 1. USERS (was profiles)
-- =============================================================
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  middle_name TEXT,
  last_name TEXT NOT NULL,
  email TEXT,
  phone_number TEXT NOT NULL,
  password_hash TEXT, -- managed by Supabase Auth, kept for ERD compliance
  user_role TEXT NOT NULL CHECK (user_role IN ('passenger', 'bangkero', 'admin')),
  profile_photo TEXT,
  is_verified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================
-- 2. PORTS (was piers)
-- =============================================================
CREATE TABLE ports (
  id TEXT PRIMARY KEY,
  port_name TEXT NOT NULL,
  location TEXT,
  longitude DECIMAL(10, 7),
  latitude DECIMAL(10, 7),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true
);

-- =============================================================
-- 3. ISLAND_PACKAGES
-- =============================================================
CREATE TABLE island_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_name TEXT NOT NULL,
  description TEXT,
  price DECIMAL(10, 2) NOT NULL,
  max_capacity INTEGER NOT NULL,
  duration_hours DECIMAL(5, 2) NOT NULL
);

-- =============================================================
-- 4. BANGKEROS (was operators, typo fixed from BANKEROS)
-- =============================================================
CREATE TABLE bangkeros (
  id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  gov_issued_id TEXT,
  boat_registration_cert TEXT,
  coastal_permit TEXT,
  brgy_clearance TEXT,
  verification_stat TEXT NOT NULL DEFAULT 'pending' CHECK (verification_stat IN ('pending', 'verified', 'rejected')),
  permit_number TEXT,
  display_name TEXT NOT NULL,
  is_available BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================
-- 5. BANGKAS
-- =============================================================
CREATE TABLE bangkas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bangka_name TEXT NOT NULL,
  bangka_type TEXT,
  permit_number TEXT,
  bangka_photo TEXT,
  capacity INTEGER NOT NULL,
  max_load_kg DECIMAL(10, 2),
  bangkero_id UUID NOT NULL REFERENCES bangkeros(id) ON DELETE CASCADE
);

-- =============================================================
-- 6. ROUTES
-- =============================================================
CREATE TABLE routes (
  id TEXT PRIMARY KEY, -- format: ${start_port_id}__${end_port_id}
  distance_km DECIMAL(8, 2),
  base_fare DECIMAL(10, 2) NOT NULL,
  estimated_minutes INTEGER NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  start_port_id TEXT NOT NULL REFERENCES ports(id),
  end_port_id TEXT NOT NULL REFERENCES ports(id)
);

-- =============================================================
-- 7. BANGKERO_VERIFICATION
-- =============================================================
CREATE TABLE bangkero_verification (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  remarks TEXT,
  bangkero_id UUID NOT NULL REFERENCES bangkeros(id) ON DELETE CASCADE,
  admin_id UUID REFERENCES users(id)
);

-- =============================================================
-- 8. BOOKINGS
-- =============================================================
CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ref TEXT NOT NULL, -- BGO-XXXXXX format
  service_type TEXT NOT NULL DEFAULT 'passenger' CHECK (service_type IN ('passenger', 'cargo', 'rental')),
  num_of_passenger INTEGER NOT NULL DEFAULT 1,
  trip_stat TEXT NOT NULL DEFAULT 'open' CHECK (trip_stat IN ('open', 'accepted', 'completed', 'cancelled')),
  cancel_reason TEXT,
  depart_time TIMESTAMPTZ,
  arrival_time TIMESTAMPTZ,
  total_price DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id UUID NOT NULL REFERENCES users(id),
  bangka_id UUID REFERENCES bangkas(id),
  route_id TEXT NOT NULL REFERENCES routes(id),
  package_id UUID REFERENCES island_packages(id),
  -- Additional fields for the prototype (not in ERD but needed by app)
  passenger_name TEXT,
  passenger_phone TEXT,
  from_port_name TEXT,
  to_port_name TEXT,
  operator_id UUID REFERENCES bangkeros(id),
  operator_name TEXT,
  operator_boat_name TEXT,
  rejected_by UUID[] DEFAULT '{}',
  accepted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ
);

-- =============================================================
-- 9. PASSENGER_DETAILS
-- =============================================================
CREATE TABLE passenger_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  age INTEGER,
  sex TEXT CHECK (sex IN ('male', 'female', 'other')),
  contact_number TEXT,
  passenger_type TEXT NOT NULL DEFAULT 'regular' CHECK (passenger_type IN ('regular', 'senior', 'student', 'child')),
  declared_weight_kg DECIMAL(6, 2),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE
);

-- =============================================================
-- 10. PAYMENTS
-- =============================================================
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  amount DECIMAL(10, 2) NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'gcash', 'maya', 'bank_transfer')),
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'completed', 'failed', 'refunded')),
  reference_num TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE
);

-- =============================================================
-- 11. VESSEL_TRACKING
-- =============================================================
CREATE TABLE vessel_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  latitude DECIMAL(10, 7) NOT NULL,
  longitude DECIMAL(10, 7) NOT NULL,
  speed DECIMAL(5, 2),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  bangka_id UUID NOT NULL REFERENCES bangkas(id) ON DELETE CASCADE
);

-- =============================================================
-- 12. SAFETY_ALERTS
-- =============================================================
CREATE TABLE safety_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'low' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  is_resolved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  bangka_id UUID REFERENCES bangkas(id),
  port_id TEXT REFERENCES ports(id)
);

-- =============================================================
-- 13. BOAT_RENTALS
-- =============================================================
CREATE TABLE boat_rentals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name TEXT,
  rental_date DATE NOT NULL,
  hours DECIMAL(5, 2) NOT NULL,
  total_price DECIMAL(10, 2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled')),
  user_id UUID NOT NULL REFERENCES users(id),
  bangka_id UUID NOT NULL REFERENCES bangkas(id),
  payment_id UUID -- FK added after payments table
);

-- =============================================================
-- 14. WALLETS
-- =============================================================
CREATE TABLE wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  balance DECIMAL(12, 2) NOT NULL DEFAULT 0,
  bangkero_id UUID NOT NULL REFERENCES bangkeros(id) ON DELETE CASCADE
);

-- =============================================================
-- 15. WALLET_TRANSACTIONS
-- =============================================================
CREATE TABLE wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('credit', 'debit', 'withdrawal', 'top_up')),
  amount DECIMAL(12, 2) NOT NULL,
  wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  booking_id UUID REFERENCES bookings(id)
);

-- =============================================================
-- 16. NOTIFICATIONS
-- =============================================================
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE
);

-- =============================================================
-- 17. RATINGS
-- =============================================================
CREATE TABLE ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  booking_id UUID NOT NULL REFERENCES bookings(id),
  user_id UUID NOT NULL REFERENCES users(id),
  bangkero_id UUID NOT NULL REFERENCES bangkeros(id)
);

-- =============================================================
-- 18. PARCELS
-- =============================================================
CREATE TABLE parcels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receiver_name TEXT NOT NULL,
  receiver_contact TEXT,
  total_price DECIMAL(10, 2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_transit', 'delivered', 'returned')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id UUID NOT NULL REFERENCES users(id),
  booking_id UUID NOT NULL REFERENCES bookings(id)
);

-- =============================================================
-- 19. PARCEL_ITEMS
-- =============================================================
CREATE TABLE parcel_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  kilogram DECIMAL(8, 2) NOT NULL,
  parcel_id UUID NOT NULL REFERENCES parcels(id) ON DELETE CASCADE
);

-- =============================================================
-- 20. ROUTE_STOPS
-- =============================================================
CREATE TABLE route_stops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stop_order INTEGER NOT NULL,
  route_id TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  port_id TEXT NOT NULL REFERENCES ports(id)
);

-- =============================================================
-- 21. WEATHER_DATA
-- =============================================================
CREATE TABLE weather_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wind_speed DECIMAL(5, 2),
  wave_height DECIMAL(5, 2),
  weather_condition TEXT,
  is_safe BOOLEAN NOT NULL DEFAULT true,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  port_id TEXT NOT NULL REFERENCES ports(id)
);

-- =============================================================
-- 22. DEMAND_PREDICTIONS
-- =============================================================
CREATE TABLE demand_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_date DATE NOT NULL,
  day_of_week TEXT,
  hour_of_day INTEGER,
  is_weekend BOOLEAN NOT NULL DEFAULT false,
  is_holiday BOOLEAN NOT NULL DEFAULT false,
  previous_demand INTEGER,
  avg_demand_last_7_days DECIMAL(8, 2),
  avg_demand_last_30_days DECIMAL(8, 2),
  predicted_passengers INTEGER,
  confidence_score DECIMAL(5, 4),
  weather_id UUID REFERENCES weather_data(id),
  route_id TEXT REFERENCES routes(id)
);

-- =============================================================
-- 23. TRIP_MANIFEST
-- =============================================================
CREATE TABLE trip_manifest (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actual_departure_time TIMESTAMPTZ,
  actual_arrival_time TIMESTAMPTZ,
  total_passengers_on_board INTEGER NOT NULL DEFAULT 0,
  total_parcels_on_board INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized', 'cancelled')),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  bangka_id UUID NOT NULL REFERENCES bangkas(id),
  bangkero_id UUID NOT NULL REFERENCES bangkeros(id),
  departure_port_id TEXT NOT NULL REFERENCES ports(id),
  arrival_port_id TEXT NOT NULL REFERENCES ports(id)
);

-- =============================================================
-- 24. MANIFEST_PASSENGERS
-- =============================================================
CREATE TABLE manifest_passengers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  passenger_name TEXT NOT NULL,
  actual_weight_kg DECIMAL(6, 2),
  boarded_at TIMESTAMPTZ,
  manifest_id UUID NOT NULL REFERENCES trip_manifest(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL REFERENCES bookings(id),
  passenger_id UUID REFERENCES passenger_details(id)
);

-- =============================================================
-- 25. MANIFEST_PARCELS
-- =============================================================
CREATE TABLE manifest_parcels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_description TEXT NOT NULL,
  weight_kg DECIMAL(8, 2),
  loaded_at TIMESTAMPTZ,
  manifest_id UUID NOT NULL REFERENCES trip_manifest(id) ON DELETE CASCADE,
  parcel_id UUID NOT NULL REFERENCES parcels(id)
);

-- Add FK for boat_rentals now that payments table exists
ALTER TABLE boat_rentals ADD CONSTRAINT fk_boat_rentals_payment
  FOREIGN KEY (payment_id) REFERENCES payments(id);

-- =============================================================
-- TRIGGERS & FUNCTIONS
-- =============================================================

-- Auto-generate booking ref on insert
CREATE OR REPLACE FUNCTION set_booking_ref()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.ref IS NULL OR NEW.ref = '' THEN
    NEW.id := gen_random_uuid();
    NEW.ref := 'BGO-' || upper(substring(md5(random()::text) from 1 for 6));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER SET_BOOKING_REF
  BEFORE INSERT ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION set_booking_ref();

-- Atomic reject booking (array append)
CREATE OR REPLACE FUNCTION append_rejected_by(booking_id uuid, operator_uid uuid)
RETURNS VOID AS $$
BEGIN
  UPDATE bookings
  SET rejected_by = array_append(rejected_by, operator_uid)
  WHERE id = booking_id
    AND NOT (operator_uid = ANY(rejected_by));
END;
$$ LANGUAGE plpgsql;

-- Atomic two-table name update
CREATE OR REPLACE FUNCTION update_display_name(
  p_uid uuid,
  p_first_name text,
  p_last_name text,
  p_is_bangkero boolean
)
RETURNS VOID AS $$
BEGIN
  UPDATE users
  SET first_name = p_first_name, last_name = p_last_name
  WHERE id = p_uid;

  IF p_is_bangkero THEN
    UPDATE bangkeros
    SET display_name = p_first_name || ' ' || p_last_name,
        updated_at = now()
    WHERE id = p_uid;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- =============================================================
-- ROW LEVEL SECURITY
-- =============================================================

-- USERS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_insert_own" ON users
  FOR INSERT TO anon, authenticated WITH CHECK (auth.uid() = id);

CREATE POLICY "users_select_own" ON users
  FOR SELECT TO authenticated USING (auth.uid() = id);

CREATE POLICY "users_update_own" ON users
  FOR UPDATE TO authenticated
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- BANGKEROS
ALTER TABLE bangkeros ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bangkeros_insert_own" ON bangkeros
  FOR INSERT TO anon, authenticated WITH CHECK (auth.uid() = id);

CREATE POLICY "bangkeros_select_all" ON bangkeros
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "bangkeros_update_own" ON bangkeros
  FOR UPDATE TO authenticated
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- PORTS
ALTER TABLE ports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ports_select_all" ON ports
  FOR SELECT TO anon, authenticated USING (true);

-- ROUTES
ALTER TABLE routes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "routes_select_all" ON routes
  FOR SELECT TO anon, authenticated USING (true);

-- BOOKINGS
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bookings_insert_own" ON bookings
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "bookings_select_all" ON bookings
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "bookings_update_owner" ON bookings
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "bookings_update_bangkero" ON bookings
  FOR UPDATE TO authenticated
  USING (
    trip_stat = 'open'
    AND EXISTS (SELECT 1 FROM bangkeros WHERE id = auth.uid())
  ) WITH CHECK (
    trip_stat = 'open'
    AND EXISTS (SELECT 1 FROM bangkeros WHERE id = auth.uid())
  );

-- BANGKAS
ALTER TABLE bangkas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bangkas_select_all" ON bangkas
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "bangkas_insert_own" ON bangkas
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM bangkeros WHERE id = auth.uid() AND id = bangkero_id));

CREATE POLICY "bangkas_update_own" ON bangkas
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM bangkeros WHERE id = auth.uid() AND id = bangkero_id));

-- WALLETS
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wallets_select_own" ON wallets
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM bangkeros WHERE id = auth.uid() AND id = bangkero_id));

-- WALLET_TRANSACTIONS
ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wallet_transactions_select_own" ON wallet_transactions
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM wallets w
    JOIN bangkeros b ON b.id = w.bangkero_id
    WHERE w.id = wallet_id AND b.id = auth.uid()
  ));

-- NOTIFICATIONS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notifications_select_own" ON notifications
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "notifications_insert_own" ON notifications
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- RATINGS
ALTER TABLE ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ratings_select_all" ON ratings
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "ratings_insert_own" ON ratings
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- PASSENGER_DETAILS
ALTER TABLE passenger_details ENABLE ROW LEVEL SECURITY;

CREATE POLICY "passenger_details_select_own" ON passenger_details
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM bookings b WHERE b.id = booking_id AND b.user_id = auth.uid()
  ));

-- PAYMENTS
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payments_select_own" ON payments
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM bookings b WHERE b.id = booking_id AND b.user_id = auth.uid()
  ));

-- PARCELS
ALTER TABLE parcels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "parcels_select_own" ON parcels
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- ISLAND_PACKAGES
ALTER TABLE island_packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "island_packages_select_all" ON island_packages
  FOR SELECT TO anon, authenticated USING (true);

-- VESSEL_TRACKING
ALTER TABLE vessel_tracking ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vessel_tracking_select_all" ON vessel_tracking
  FOR SELECT TO authenticated USING (true);

-- SAFETY_ALERTS
ALTER TABLE safety_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "safety_alerts_select_all" ON safety_alerts
  FOR SELECT TO authenticated USING (true);

-- BOAT_RENTALS
ALTER TABLE boat_rentals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "boat_rentals_select_own" ON boat_rentals
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- WEATHER_DATA
ALTER TABLE weather_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "weather_data_select_all" ON weather_data
  FOR SELECT TO anon, authenticated USING (true);

-- DEMAND_PREDICTIONS
ALTER TABLE demand_predictions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "demand_predictions_select_all" ON demand_predictions
  FOR SELECT TO authenticated USING (true);

-- TRIP_MANIFEST
ALTER TABLE trip_manifest ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trip_manifest_select_all" ON trip_manifest
  FOR SELECT TO authenticated USING (true);

-- MANIFEST_PASSENGERS
ALTER TABLE manifest_passengers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "manifest_passengers_select_all" ON manifest_passengers
  FOR SELECT TO authenticated USING (true);

-- MANIFEST_PARCELS
ALTER TABLE manifest_parcels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "manifest_parcels_select_all" ON manifest_parcels
  FOR SELECT TO authenticated USING (true);

-- ROUTE_STOPS
ALTER TABLE route_stops ENABLE ROW LEVEL SECURITY;

CREATE POLICY "route_stops_select_all" ON route_stops
  FOR SELECT TO anon, authenticated USING (true);

-- BANGKERO_VERIFICATION
ALTER TABLE bangkero_verification ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bangkero_verification_select_own" ON bangkero_verification
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM bangkeros WHERE id = auth.uid() AND id = bangkero_id));

-- =============================================================
-- SEED DATA
-- =============================================================

-- Ports (was piers)
INSERT INTO ports (id, port_name, location, latitude, longitude, sort_order, is_active) VALUES
  ('mactan-pier-1', 'Mactan Pier 1 (Punta Engaño)', 'Mactan, Cebu', 10.3068, 124.0120, 1, true),
  ('mactan-pier-2', 'Mactan Pier 2 (Maribago)', 'Mactan, Cebu', 10.2950, 124.0050, 2, true),
  ('olango-port', 'Olango Island Port (Sta. Rosa)', 'Olango, Cebu', 10.3320, 124.0450, 3, true),
  ('caohagan', 'Caohagan Island', 'Caohagan, Cebu', 10.2750, 124.0650, 4, true),
  ('nalusuan', 'Nalusuan Island', 'Nalusuan, Cebu', 10.2850, 124.0550, 5, true)
ON CONFLICT (id) DO NOTHING;

-- Routes (6 pairs, both directions)
INSERT INTO routes (id, distance_km, base_fare, estimated_minutes, is_active, start_port_id, end_port_id) VALUES
  ('mactan-pier-2__olango-port', 5.2, 150, 15, true, 'mactan-pier-2', 'olango-port'),
  ('olango-port__mactan-pier-2', 5.2, 150, 15, true, 'olango-port', 'mactan-pier-2'),
  ('mactan-pier-1__olango-port', 6.8, 180, 20, true, 'mactan-pier-1', 'olango-port'),
  ('olango-port__mactan-pier-1', 6.8, 180, 20, true, 'olango-port', 'mactan-pier-1'),
  ('mactan-pier-2__caohagan', 8.5, 280, 35, true, 'mactan-pier-2', 'caohagan'),
  ('caohagan__mactan-pier-2', 8.5, 280, 35, true, 'caohagan', 'mactan-pier-2'),
  ('mactan-pier-1__caohagan', 9.2, 320, 40, true, 'mactan-pier-1', 'caohagan'),
  ('caohagan__mactan-pier-1', 9.2, 320, 40, true, 'caohagan', 'mactan-pier-1'),
  ('mactan-pier-2__nalusuan', 7.8, 360, 45, true, 'mactan-pier-2', 'nalusuan'),
  ('nalusuan__mactan-pier-2', 7.8, 360, 45, true, 'nalusuan', 'mactan-pier-2'),
  ('mactan-pier-1__nalusuan', 8.9, 400, 55, true, 'mactan-pier-1', 'nalusuan'),
  ('nalusuan__mactan-pier-1', 8.9, 400, 55, true, 'nalusuan', 'mactan-pier-1')
ON CONFLICT (id) DO NOTHING;

-- =============================================================
-- DONE. 25 tables created. Run seed script to add accounts.
-- =============================================================
