-- =============================================================
-- 021 - FINAL PORTS & ROUTES
-- =============================================================
-- Replaces the demo seed (5 ports / 12 routes / ₱70, from 002 + 017)
-- with the final network: 9 ports / 40 routes / ₱100 flat, 30 min.
-- Source of truth: ml/config/ports.json + ml/config/routes.json
-- (pandanon excluded — Bohol is out of scope for this build).
--
-- HARD DELETE: trip data that references the old ports/routes is wiped
-- (approved: demo bookings, manifests, queues, weather, predictions).
-- island_packages.stops are repointed to the new port ids — only
-- first->last of each stops array must be a seeded route (014).
--
-- ⚠️ Do NOT re-run 017 (UPDATE routes SET base_fare = 70) after this —
--    it would reset every fare. 021 supersedes 017.
-- Run manually in the Supabase SQL editor, then: npm run seed
-- =============================================================

BEGIN;

-- -------------------------------------------------------------
-- 1. Wipe demo trip data (children before parents; several FKs
--    carry no ON DELETE rule, so order matters)
-- -------------------------------------------------------------
DELETE FROM ratings;
DELETE FROM wallet_transactions;
DELETE FROM manifest_parcels;
DELETE FROM manifest_passengers;
DELETE FROM parcels;
DELETE FROM trip_manifest;
DELETE FROM downpayments;
DELETE FROM passenger_details;
DELETE FROM payments;
DELETE FROM bookings;
DELETE FROM notifications;

-- port/route-keyed data
DELETE FROM route_stops;
DELETE FROM port_queue;
DELETE FROM weather_data;
DELETE FROM safety_alerts;
DELETE FROM demand_predictions;

-- -------------------------------------------------------------
-- 2. Repoint island packages to the new port ids
--    old -> new: mactan-pier-1 -> marigondon, mactan-pier-2 -> maribago,
--    olango-port -> hilotongan (Olango group; Sta. Rosa has no
--    equivalent in the final 9), caohagan/nalusuan unchanged
-- -------------------------------------------------------------
UPDATE island_packages
SET stops = CASE package_name
    WHEN 'Olango & Caohagan Island Hop'   THEN '["marigondon","hilotongan","caohagan"]'::jsonb
    WHEN 'Caohagan & Nalusuan Day Tour'   THEN '["maribago","caohagan","nalusuan"]'::jsonb
    WHEN 'Nalusuan via Caohagan Express'  THEN '["marigondon","nalusuan","caohagan"]'::jsonb
    ELSE stops
  END,
  description = CASE package_name
    WHEN 'Olango & Caohagan Island Hop'
      THEN 'Marigondon Port to Hilotongan, then on to Caohagan. Swim stops, snorkeling, and a chance to meet the local turtles.'
    WHEN 'Caohagan & Nalusuan Day Tour'
      THEN 'From Maribago Port to Caohagan, finishing at Nalusuan''s sandbar. Full-day island hopping with lunch on the boat.'
    WHEN 'Nalusuan via Caohagan Express'
      THEN 'Marigondon Port straight to the Nalusuan reef via Caohagan — the longer run for divers and photo trips.'
    ELSE description
  END
WHERE package_name IN (
  'Olango & Caohagan Island Hop',
  'Caohagan & Nalusuan Day Tour',
  'Nalusuan via Caohagan Express'
);

-- -------------------------------------------------------------
-- 3. Hard delete the old network (routes first — FK to ports)
-- -------------------------------------------------------------
DELETE FROM routes;
DELETE FROM ports;

-- -------------------------------------------------------------
-- 4. Final ports (9)
-- -------------------------------------------------------------
INSERT INTO ports (id, port_name, location, latitude, longitude, sort_order, is_active, geofence_radius_m) VALUES
  ('marigondon', 'Marigondon Port',    'Lapu-Lapu, Cebu', 10.2715, 124.0005, 1, true, 300),
  ('angasil',    'Angasil Port',       'Lapu-Lapu, Cebu', 10.2565, 123.9920, 2, true, 300),
  ('hilton',     'Hilton Port',        'Lapu-Lapu, Cebu', 10.2478, 123.9890, 3, true, 300),
  ('maribago',   'Maribago Port',      'Lapu-Lapu, Cebu', 10.2950, 124.0050, 4, true, 300),
  ('caohagan',   'Caohagan Island',    'Lapu-Lapu, Cebu', 10.2750, 124.0650, 5, true, 300),
  ('sulpa',      'Sulpa Island',       'Lapu-Lapu, Cebu', 10.2400, 124.0520, 6, true, 300),
  ('st-vicente', 'St. Vicente Island', 'Lapu-Lapu, Cebu', 10.2530, 124.0420, 7, true, 300),
  ('hilotongan', 'Hilotongan Island',  'Lapu-Lapu, Cebu', 10.2600, 124.0380, 8, true, 300),
  ('nalusuan',   'Nalusuan Island',    'Lapu-Lapu, Cebu', 10.2850, 124.0550, 9, true, 300);

-- -------------------------------------------------------------
-- 5. Final routes (40): 4 mainland ports x 5 island ports, both
--    directions, ₱100 flat, 30 min
-- -------------------------------------------------------------
INSERT INTO routes (id, start_port_id, end_port_id, base_fare, estimated_minutes, distance_km, is_active) VALUES
  ('marigondon__caohagan',   'marigondon',   'caohagan',   100, 30, NULL, true),
  ('caohagan__marigondon',   'caohagan',     'marigondon', 100, 30, NULL, true),
  ('marigondon__sulpa',      'marigondon',   'sulpa',      100, 30, NULL, true),
  ('sulpa__marigondon',      'sulpa',        'marigondon', 100, 30, NULL, true),
  ('marigondon__st-vicente', 'marigondon',   'st-vicente', 100, 30, NULL, true),
  ('st-vicente__marigondon', 'st-vicente',   'marigondon', 100, 30, NULL, true),
  ('marigondon__hilotongan', 'marigondon',   'hilotongan', 100, 30, NULL, true),
  ('hilotongan__marigondon', 'hilotongan',   'marigondon', 100, 30, NULL, true),
  ('marigondon__nalusuan',   'marigondon',   'nalusuan',   100, 30, NULL, true),
  ('nalusuan__marigondon',   'nalusuan',     'marigondon', 100, 30, NULL, true),
  ('angasil__caohagan',      'angasil',      'caohagan',   100, 30, NULL, true),
  ('caohagan__angasil',      'caohagan',     'angasil',    100, 30, NULL, true),
  ('angasil__sulpa',         'angasil',      'sulpa',      100, 30, NULL, true),
  ('sulpa__angasil',         'sulpa',        'angasil',    100, 30, NULL, true),
  ('angasil__st-vicente',    'angasil',      'st-vicente', 100, 30, NULL, true),
  ('st-vicente__angasil',    'st-vicente',   'angasil',    100, 30, NULL, true),
  ('angasil__hilotongan',    'angasil',      'hilotongan', 100, 30, NULL, true),
  ('hilotongan__angasil',    'hilotongan',   'angasil',    100, 30, NULL, true),
  ('angasil__nalusuan',      'angasil',      'nalusuan',   100, 30, NULL, true),
  ('nalusuan__angasil',      'nalusuan',     'angasil',    100, 30, NULL, true),
  ('hilton__caohagan',       'hilton',       'caohagan',   100, 30, NULL, true),
  ('caohagan__hilton',       'caohagan',     'hilton',     100, 30, NULL, true),
  ('hilton__sulpa',          'hilton',       'sulpa',      100, 30, NULL, true),
  ('sulpa__hilton',          'sulpa',        'hilton',     100, 30, NULL, true),
  ('hilton__st-vicente',     'hilton',       'st-vicente', 100, 30, NULL, true),
  ('st-vicente__hilton',     'st-vicente',   'hilton',     100, 30, NULL, true),
  ('hilton__hilotongan',     'hilton',       'hilotongan', 100, 30, NULL, true),
  ('hilotongan__hilton',     'hilotongan',   'hilton',     100, 30, NULL, true),
  ('hilton__nalusuan',       'hilton',       'nalusuan',   100, 30, NULL, true),
  ('nalusuan__hilton',       'nalusuan',     'hilton',     100, 30, NULL, true),
  ('maribago__caohagan',     'maribago',     'caohagan',   100, 30, NULL, true),
  ('caohagan__maribago',     'caohagan',     'maribago',   100, 30, NULL, true),
  ('maribago__sulpa',        'maribago',     'sulpa',      100, 30, NULL, true),
  ('sulpa__maribago',        'sulpa',        'maribago',   100, 30, NULL, true),
  ('maribago__st-vicente',   'maribago',     'st-vicente', 100, 30, NULL, true),
  ('st-vicente__maribago',   'st-vicente',   'maribago',   100, 30, NULL, true),
  ('maribago__hilotongan',   'maribago',     'hilotongan', 100, 30, NULL, true),
  ('hilotongan__maribago',   'hilotongan',   'maribago',   100, 30, NULL, true),
  ('maribago__nalusuan',     'maribago',     'nalusuan',   100, 30, NULL, true),
  ('nalusuan__maribago',     'nalusuan',     'maribago',   100, 30, NULL, true);

COMMIT;
