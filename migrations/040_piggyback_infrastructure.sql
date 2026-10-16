-- =============================================================
-- 040. PIGGYBACK INFRASTRUCTURE (Parcel Padala Phase 1)
-- =============================================================
-- Why: Mode 2 (piggyback) lets a parcel ride with a passenger's
-- booking at the Mode 2 base fee (migration 035 parcel_rates).
-- This adds the opt-in flags: bangkero-level availability and
-- per-booking consent + discount tracking.
--
-- Safe to re-run (all ADDs are IF NOT EXISTS; index is IF NOT EXISTS).
-- Run manually in the SQL editor after 039. Does NOT touch 002/017/021/032-039.
-- =============================================================

ALTER TABLE public.bangkeros
  ADD COLUMN IF NOT EXISTS piggyback_opt_in BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS piggyback_opted_in BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS piggyback_discount DECIMAL(10,2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_bangkeros_piggyback_opt_in
  ON public.bangkeros (piggyback_opt_in) WHERE piggyback_opt_in = true;

COMMENT ON COLUMN public.bangkeros.piggyback_opt_in IS 'Parcel Padala Phase 1 (040): bangkero accepts piggyback parcels.';
COMMENT ON COLUMN public.bookings.piggyback_opted_in IS 'Parcel Padala Phase 1 (040): booking consented to carry a piggyback parcel.';
COMMENT ON COLUMN public.bookings.piggyback_discount IS 'Parcel Padala Phase 1 (040): discount granted for carrying a piggyback parcel.';

-- DOWN (commented, run manually if a rollback is ever needed):
-- DROP INDEX IF EXISTS public.idx_bangkeros_piggyback_opt_in;
-- ALTER TABLE public.bookings DROP COLUMN IF EXISTS piggyback_discount;
-- ALTER TABLE public.bookings DROP COLUMN IF EXISTS piggyback_opted_in;
-- ALTER TABLE public.bangkeros DROP COLUMN IF EXISTS piggyback_opt_in;
