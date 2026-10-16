-- =============================================================
-- 043. PARCEL MODES — RLS FOR PHASE 1 TABLES
-- =============================================================
-- Why: Migration 041 added crossing_times and 035 added parcel_rates
-- without enabling RLS, exposing both to anon-key holders. This
-- enables RLS + policies on both tables:
--   • SELECT for authenticated users (needed by booking/batched UI)
--   • ALL for admins (rate + schedule editing via admin UI)
--
-- Note: Migrations 040 and 042 only ALTER existing tables 
-- (bangkeros, bookings, parcels) that already have RLS enabled — 
-- no action needed there.
--
-- Safe to re-run (DROP POLICY IF EXISTS + CREATE POLICY; 
-- ENABLE ROW LEVEL SECURITY is idempotent).
-- Run manually after 042. Does NOT touch 002/017/021/032-042.
-- =============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. parcel_rates (from migration 035)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.parcel_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "parcel_rates_select_authenticated" ON public.parcel_rates;
CREATE POLICY "parcel_rates_select_authenticated"
  ON public.parcel_rates
  FOR SELECT
  TO authenticated
  USING (is_active = true);

DROP POLICY IF EXISTS "parcel_rates_admin_all" ON public.parcel_rates;
CREATE POLICY "parcel_rates_admin_all"
  ON public.parcel_rates
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
        AND users.user_role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
        AND users.user_role = 'admin'
    )
  );

-- ─────────────────────────────────────────────────────────────
-- 2. crossing_times (from migration 041)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.crossing_times ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "crossing_times_select_authenticated" ON public.crossing_times;
CREATE POLICY "crossing_times_select_authenticated"
  ON public.crossing_times
  FOR SELECT
  TO authenticated
  USING (is_active = true);

DROP POLICY IF EXISTS "crossing_times_admin_all" ON public.crossing_times;
CREATE POLICY "crossing_times_admin_all"
  ON public.crossing_times
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
        AND users.user_role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
        AND users.user_role = 'admin'
    )
  );

-- =============================================================
-- DOWN (commented, run manually if rollback is needed):
-- DROP POLICY IF EXISTS "crossing_times_admin_all" ON public.crossing_times;
-- DROP POLICY IF EXISTS "crossing_times_select_authenticated" ON public.crossing_times;
-- ALTER TABLE public.crossing_times DISABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS "parcel_rates_admin_all" ON public.parcel_rates;
-- DROP POLICY IF EXISTS "parcel_rates_select_authenticated" ON public.parcel_rates;
-- ALTER TABLE public.parcel_rates DISABLE ROW LEVEL SECURITY;
-- =============================================================
