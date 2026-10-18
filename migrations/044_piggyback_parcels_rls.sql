-- =============================================================
-- 044. PIGGYBACK PARCELS RLS (Parcel Padala Phase 1)
-- =============================================================
-- Why: parcels_select_bangkero uses `b.id = parcels.booking_id`, which 
-- matches only regular parcels. Piggyback parcels have a no-operator 
-- `booking_id` stub; their passenger ride is on `piggyback_booking_id`.
-- This adds policies so the bangkero can read/update piggyback parcels 
-- whose passenger ride they operate.
--
-- Safe to re-run (DROP POLICY IF EXISTS + CREATE POLICY).
-- Run manually after 043. Does NOT touch 002/017/021/032-043.
-- =============================================================

DROP POLICY IF EXISTS "parcels_select_bangkero_piggyback" ON public.parcels;
CREATE POLICY "parcels_select_bangkero_piggyback"
  ON public.parcels
  FOR SELECT
  TO authenticated
  USING (
    piggyback_booking_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = parcels.piggyback_booking_id
        AND b.operator_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "parcels_update_bangkero_piggyback" ON public.parcels;
CREATE POLICY "parcels_update_bangkero_piggyback"
  ON public.parcels
  FOR UPDATE
  TO authenticated
  USING (
    piggyback_booking_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = parcels.piggyback_booking_id
        AND b.operator_id = auth.uid()
    )
  )
  WITH CHECK (
    piggyback_booking_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = parcels.piggyback_booking_id
        AND b.operator_id = auth.uid()
    )
  );

-- =============================================================
-- DOWN (commented):
-- DROP POLICY IF EXISTS "parcels_update_bangkero_piggyback" ON public.parcels;
-- DROP POLICY IF EXISTS "parcels_select_bangkero_piggyback" ON public.parcels;
-- =============================================================
