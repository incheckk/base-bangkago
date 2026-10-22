-- =============================================================
-- 068 — One flat standard price per boat
--
-- Island hopping is sold per boat (island_packages.price is the
-- whole-boat price in the app now) and boat rental is a whole-day
-- charter, not hourly. bangkas.standard_price is the bangkero-
-- editable flat price for that day; while it is NULL the app falls
-- back to the demo capacity tier: under 15 pax ₱3,500, 15+ ₱7,000.
--
-- hourly_rate stays for historical rentals (total_price is already
-- stored per row); nothing reads it for new pricing.
--
-- Safe to run late: before this, the app reads bangkas with `*`, so
-- standard_price simply reads absent and every boat shows its tier.
-- Only saving a price errors until the migration is applied.
--
-- Run manually in the SQL editor, after 067.
-- No demo reset.
-- =============================================================
ALTER TABLE bangkas ADD COLUMN IF NOT EXISTS standard_price DECIMAL(10, 2);

ALTER TABLE bangkas DROP CONSTRAINT IF EXISTS bangkas_standard_price_positive;
ALTER TABLE bangkas ADD CONSTRAINT bangkas_standard_price_positive
  CHECK (standard_price IS NULL OR standard_price > 0);

NOTIFY pgrst, 'reload schema';
