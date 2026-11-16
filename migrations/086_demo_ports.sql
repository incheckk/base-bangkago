-- =============================================================
-- 086 — Demo ports: school (ST Building) and home
-- Run AFTER 085_departure_lock.sql.
--
-- Data only: two ports + one directed route each way. No island
-- package (084 now requires an assigned live boat), no route_stops
-- and no crossing_times — a plain ride/hop needs none of them.
--
-- Both ports are inserted INACTIVE. The Developer Options switch
-- writes ports.is_active / routes.is_active for id LIKE 'demo-%',
-- so nothing changes in the demo network until it is flipped on.
--
-- demo-home is labelled island_group 'olango' on purpose: book-ride
-- hides same-island destinations, and the demo needs the pair to be
-- bookable. Geographically both are on Mactan — this is demo-only.
--
-- Idempotent: re-running never flips the admin's switch back.
-- =============================================================

BEGIN;

INSERT INTO public.ports (
  id, port_name, location, latitude, longitude,
  sort_order, is_active, geofence_radius_m, island_group, island_name
) VALUES
  ('demo-stb',  'ST Building (Demo)', 'Lapu-Lapu, Cebu',
   10.296244, 123.906986, -2, false, 900, 'mactan', 'Mactan'),
  ('demo-home', 'Home (Demo)',        'Lapu-Lapu, Cebu',
   10.344891, 123.941362, -1, false, 900, 'olango', 'Home')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.routes (
  id, start_port_id, end_port_id,
  base_fare, estimated_minutes, distance_km, is_active
) VALUES
  ('demo-stb__demo-home', 'demo-stb',  'demo-home', 100, 30, NULL, false),
  ('demo-home__demo-stb', 'demo-home', 'demo-stb',  100, 30, NULL, false)
ON CONFLICT (id) DO NOTHING;

COMMIT;
