-- =============================================================
-- 070 — Money and parcel-weight integrity checks
--
-- Closes the data holes behind the alpha-test findings:
--   * parcel_items accepted negative / zero weights and quantities;
--   * parcels.total_weight_kg could be zero or negative;
--   * bookings.total_price and num_of_passenger had no floor, so a
--     crafted payment URL could persist a ₱0 / negative fare or a
--     0-passenger booking.
--
-- The app now validates these before insert, and createBooking
-- recomputes the fare server-side. These constraints are the database
-- backstop, so a future caller cannot reintroduce the hole.
--
-- NOT VALID: rows written before this migration are not scanned, so a
-- demo database that already holds a negative weight still applies the
-- migration. New and updated rows are checked immediately. After
-- cleaning any bad rows, run:
--   ALTER TABLE parcel_items VALIDATE CONSTRAINT parcel_items_kilogram_range;
--   ALTER TABLE parcel_items VALIDATE CONSTRAINT parcel_items_quantity_positive;
--   ALTER TABLE parcels     VALIDATE CONSTRAINT parcels_total_weight_positive;
--   ALTER TABLE bookings    VALIDATE CONSTRAINT bookings_total_price_nonnegative;
--   ALTER TABLE bookings    VALIDATE CONSTRAINT bookings_pax_positive;
--
-- Run manually in the SQL editor, after 069.
-- No demo reset.
-- =============================================================

-- 1. PARCEL_ITEMS — each line is 1–50 kg and a positive whole quantity.
ALTER TABLE parcel_items DROP CONSTRAINT IF EXISTS parcel_items_kilogram_range;
ALTER TABLE parcel_items ADD CONSTRAINT parcel_items_kilogram_range
  CHECK (kilogram >= 1 AND kilogram <= 50) NOT VALID;

ALTER TABLE parcel_items DROP CONSTRAINT IF EXISTS parcel_items_quantity_positive;
ALTER TABLE parcel_items ADD CONSTRAINT parcel_items_quantity_positive
  CHECK (quantity > 0) NOT VALID;

-- 2. PARCELS — a recorded total weight is always positive (NULL = not set).
ALTER TABLE parcels DROP CONSTRAINT IF EXISTS parcels_total_weight_positive;
ALTER TABLE parcels ADD CONSTRAINT parcels_total_weight_positive
  CHECK (total_weight_kg IS NULL OR total_weight_kg >= 1) NOT VALID;

-- 3. BOOKINGS — the fare is never negative and a booking has at least one seat.
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_total_price_nonnegative;
ALTER TABLE bookings ADD CONSTRAINT bookings_total_price_nonnegative
  CHECK (total_price >= 0) NOT VALID;

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_pax_positive;
ALTER TABLE bookings ADD CONSTRAINT bookings_pax_positive
  CHECK (num_of_passenger >= 1) NOT VALID;

NOTIFY pgrst, 'reload schema';
