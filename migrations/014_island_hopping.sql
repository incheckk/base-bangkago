-- =============================================================
-- 014 — ISLAND HOPPING PACKAGES (Phase 4B)
--
-- The Island Hop tile used to open the generic quick-ride list. The
-- packages table existed since 002 but had no itinerary and no rows:
--
--   * stops JSONB — the ordered list of port IDs the hop visits
--     (["mactan-pier-1","olango-port","caohagan"]). Stored on the
--     package, NOT in route_stops: an itinerary must never disturb
--     the admin's route editing, and the booking still resolves to
--     the ordinary seeded route first-stop → last-stop, so dispatch,
--     queues and the manifest all keep working unchanged.
--
--   * Three seeded packages. CONSTRAINT: the FIRST and LAST stop
--     must be one of the six seeded route pairs (002) — createBooking
--     throws "No route runs between those two ports." otherwise.
--     Intermediate stops may be any port (no route row is needed for
--     legs the boat simply passes through).
--
-- Money: price is PER PERSON (like every other fare). The app books
-- total = price × pax and takes a 50% GCash downpayment through the
-- admin's escrow QR (migration 015).
--
-- Run this in Supabase SQL Editor AFTER 013_ratings_guard.sql
-- =============================================================

-- 1. The itinerary column.
ALTER TABLE island_packages
  ADD COLUMN IF NOT EXISTS stops JSONB NOT NULL DEFAULT '[]';

-- 2. Seed packages (idempotent by name — a rerun must not duplicate).
INSERT INTO island_packages (package_name, description, price, max_capacity, duration_hours, stops)
SELECT v.package_name, v.description, v.price, v.max_capacity, v.duration_hours, v.stops::jsonb
FROM (VALUES
  (
    'Olango & Caohagan Island Hop',
    'Mactan Pier 1 to Olango Island, then on to Caohagan. Swim stops, snorkeling, and a chance to meet the local turtles.',
    450.00, 10, 5.0,
    '["mactan-pier-1","olango-port","caohagan"]'
  ),
  (
    'Caohagan & Nalusuan Day Tour',
    'From Mactan Pier 2 to Caohagan, finishing at Nalusuan''s sandbar. Full-day island hopping with lunch on the boat.',
    650.00, 12, 6.0,
    '["mactan-pier-2","caohagan","nalusuan"]'
  ),
  (
    'Nalusuan via Caohagan Express',
    'Mactan Pier 1 straight to the Nalusuan reef via Caohagan — the longer run for divers and photo trips.',
    700.00, 10, 6.0,
    '["mactan-pier-1","nalusuan","caohagan"]'
  )
) AS v(package_name, description, price, max_capacity, duration_hours, stops)
WHERE NOT EXISTS (
  SELECT 1 FROM island_packages i WHERE i.package_name = v.package_name
);

-- =============================================================
-- DONE.
--
-- Verify:
--   SELECT package_name, price, max_capacity, duration_hours, stops
--     FROM island_packages ORDER BY price;
--   -- first→last of each stops array must be a seeded route:
--   SELECT i.package_name, r.id FROM island_packages i
--   JOIN routes r
--     ON r.id = (i.stops->>0 || '__' || i.stops->>(jsonb_array_length(i.stops) - 1))
--   WHERE jsonb_array_length(i.stops) >= 2;   -- 3 rows
-- =============================================================
