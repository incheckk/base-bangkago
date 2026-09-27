-- =============================================================
-- BangkaGo — Realtime Everywhere
-- Run this in Supabase SQL Editor AFTER 005_service_wiring_rls.sql
-- Safe to re-run: every statement swallows its "already done" error.
--
-- Why: postgres_changes only fires for tables that are members of the
-- supabase_realtime publication. Nothing in this repo ever added them,
-- so membership was whatever the dashboard happened to have — that is why
-- the bangkero online/offline status (and other changes) only appeared
-- after leaving the screen.
--
-- REPLICA IDENTITY FULL makes UPDATE/DELETE events carry the full old row,
-- so the client-side `filter: user_id=eq.…` subscriptions match reliably.
-- Tables here are small (demo scale) so the WAL overhead is negligible.
-- =============================================================

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users',
    'bangkeros',
    'bangkas',
    'ports',
    'routes',
    'bangkero_verification',
    'bookings',
    'passenger_details',
    'payments',
    'vessel_tracking',
    'safety_alerts',
    'boat_rentals',
    'wallets',
    'wallet_transactions',
    'notifications',
    'ratings',
    'parcels',
    'parcel_items',
    'route_stops',
    'weather_data',
    'demand_predictions',
    'island_packages',
    'trip_manifest',
    'manifest_passengers',
    'manifest_parcels'
  ] LOOP
    BEGIN
      EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'replica identity skipped for %: %', t, SQLERRM;
    END;

    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    EXCEPTION
      WHEN duplicate_object THEN
        RAISE NOTICE '% already in supabase_realtime', t;
      WHEN undefined_object THEN
        RAISE NOTICE 'publication supabase_realtime missing — enable Realtime for this project first';
      WHEN OTHERS THEN
        RAISE NOTICE 'publish skipped for %: %', t, SQLERRM;
    END;
  END LOOP;
END $$;

-- -------------------------------------------------------------
-- Verification — every app table should be listed below.
--   SELECT tablename FROM pg_publication_tables
--    WHERE pubname = 'supabase_realtime' ORDER BY tablename;
-- -------------------------------------------------------------
