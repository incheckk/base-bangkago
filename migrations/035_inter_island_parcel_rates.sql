-- =============================================================
-- 035. INTER-ISLAND PARCEL RATES (Parcel Padala Phase 0)
-- =============================================================
-- Why: Parcel Padala needs a DB-driven rate table so pricing is
-- configurable (admin UI + seed) without code redeploys. Rates
-- are per-zone and driven by PM-confirmed values (2026-10-15).
--
-- Modes:
--   Mode 1 — Accompanied (sender rides):       ₱120 base
--   Mode 2 — Piggyback (rides with passenger): ₱120 base
--   Mode 3a — Batched (waits 1 hour):          ₱150 base
--   Mode 3b — Solo (immediate, no batching):   ₱150 + ₱150 solo fee
--
-- Shared rules for all modes:
--   Included weight: 10kg
--   Excess rate:     ₱10/kg
--   Min billable:    1kg
--   Max per parcel:  50kg
--   Rounding:        ceil(kg)  (1.8kg → 2kg)
--
-- Payment timing: on loading only. No booking-time payment.
--
-- Safe to re-run. Run manually after 034. Does NOT touch 002/017/021.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.parcel_rates (
  zone                      TEXT PRIMARY KEY,
  base_fee_accompanied      DECIMAL(10,2) NOT NULL,
  base_fee_piggyback        DECIMAL(10,2) NOT NULL,
  base_fee_batched          DECIMAL(10,2) NOT NULL,
  solo_surcharge            DECIMAL(10,2) NOT NULL,
  included_kg               DECIMAL(4,2)  NOT NULL,
  excess_rate_per_kg        DECIMAL(10,2) NOT NULL,
  min_kg                    DECIMAL(4,2)  NOT NULL DEFAULT 1,
  max_kg                    DECIMAL(6,2)  NOT NULL DEFAULT 50,
  bangkero_approval_minutes INTEGER       NOT NULL DEFAULT 15,
  is_active                 BOOLEAN       NOT NULL DEFAULT true,
  updated_at                TIMESTAMPTZ   NOT NULL DEFAULT now()
);

INSERT INTO public.parcel_rates (
  zone, base_fee_accompanied, base_fee_piggyback, base_fee_batched,
  solo_surcharge, included_kg, excess_rate_per_kg, min_kg, max_kg,
  bangkero_approval_minutes, is_active
) VALUES (
  'mactan-olango', 120.00, 120.00, 150.00, 150.00, 10.00, 10.00, 1.00, 50.00, 15, true
)
ON CONFLICT (zone) DO UPDATE SET
  base_fee_accompanied = EXCLUDED.base_fee_accompanied,
  base_fee_piggyback = EXCLUDED.base_fee_piggyback,
  base_fee_batched = EXCLUDED.base_fee_batched,
  solo_surcharge = EXCLUDED.solo_surcharge,
  included_kg = EXCLUDED.included_kg,
  excess_rate_per_kg = EXCLUDED.excess_rate_per_kg,
  min_kg = EXCLUDED.min_kg,
  max_kg = EXCLUDED.max_kg,
  bangkero_approval_minutes = EXCLUDED.bangkero_approval_minutes,
  updated_at = now();

ALTER TABLE public.parcels
  ADD COLUMN IF NOT EXISTS delivery_type          TEXT,
  ADD COLUMN IF NOT EXISTS piggyback_booking_id   UUID REFERENCES public.bookings(id),
  ADD COLUMN IF NOT EXISTS approval_status        TEXT,
  ADD COLUMN IF NOT EXISTS approval_deadline_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS total_weight_kg        DECIMAL(8,2),
  ADD COLUMN IF NOT EXISTS origin_island          TEXT,
  ADD COLUMN IF NOT EXISTS destination_island     TEXT,
  ADD COLUMN IF NOT EXISTS quoted_fare            DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS final_fare             DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS base_fee               DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS excess_kg_fee          DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS solo_surcharge         DECIMAL(10,2);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'parcels_delivery_type_check') THEN
    ALTER TABLE public.parcels ADD CONSTRAINT parcels_delivery_type_check
      CHECK (delivery_type IS NULL OR delivery_type IN ('accompanied','piggyback','batched','solo'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'parcels_approval_status_check') THEN
    ALTER TABLE public.parcels ADD CONSTRAINT parcels_approval_status_check
      CHECK (approval_status IS NULL OR approval_status IN ('pending','accepted','rejected','timeout'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS parcels_piggyback_booking_idx
  ON public.parcels (piggyback_booking_id) WHERE piggyback_booking_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS parcels_approval_deadline_idx
  ON public.parcels (approval_deadline_at) WHERE approval_status = 'pending';

-- DOWN (commented): see full DOWN block in project docs.
