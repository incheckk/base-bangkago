-- =============================================================
-- 042. PARCEL BATCHING STATE (Parcel Padala Phase 1)
-- =============================================================
-- Why: Modes 3a (batched) and 3b (solo) need lifecycle state on
-- each parcel: which batch window it waits in, when the window
-- closes, and when it actually sailed/arrived.
--
-- Safe to re-run (all ADDs are IF NOT EXISTS; constraint guarded
-- by pg_constraint check; indexes are IF NOT EXISTS).
-- Run manually after 041. Does NOT touch 002/017/021/032-041.
-- =============================================================

ALTER TABLE public.parcels
  ADD COLUMN IF NOT EXISTS batching_status TEXT,
  ADD COLUMN IF NOT EXISTS batching_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS batching_deadline_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS batching_cycle_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batching_route_key TEXT,
  ADD COLUMN IF NOT EXISTS batched_count_at_sail INTEGER,
  ADD COLUMN IF NOT EXISTS scheduled_departure_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS estimated_arrival_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS actual_arrival_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'parcels_batching_status_check') THEN
    ALTER TABLE public.parcels ADD CONSTRAINT parcels_batching_status_check
      CHECK (batching_status IS NULL OR batching_status IN
        ('pending_batch','batched','solo','in_transit','arrived','delivered'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_parcels_pending_batch
  ON public.parcels (batching_route_key) WHERE batching_status = 'pending_batch';

CREATE INDEX IF NOT EXISTS idx_parcels_batch_deadline
  ON public.parcels (batching_deadline_at) WHERE batching_status = 'pending_batch';

COMMENT ON COLUMN public.parcels.batching_status IS 'Parcel Padala Phase 1 (042): batch lifecycle state.';
COMMENT ON COLUMN public.parcels.batching_started_at IS 'Parcel Padala Phase 1 (042): when the parcel entered the batch window.';
COMMENT ON COLUMN public.parcels.batching_deadline_at IS 'Parcel Padala Phase 1 (042): when the batch window closes.';
COMMENT ON COLUMN public.parcels.batching_cycle_count IS 'Parcel Padala Phase 1 (042): how many batch cycles this parcel has waited.';
COMMENT ON COLUMN public.parcels.batching_route_key IS 'Parcel Padala Phase 1 (042): route grouping key for the batch.';
COMMENT ON COLUMN public.parcels.batched_count_at_sail IS 'Parcel Padala Phase 1 (042): batch size snapshot at sail.';
COMMENT ON COLUMN public.parcels.scheduled_departure_at IS 'Parcel Padala Phase 1 (042): assigned crossing time.';
COMMENT ON COLUMN public.parcels.estimated_arrival_at IS 'Parcel Padala Phase 1 (042): ETA from the assigned crossing.';
COMMENT ON COLUMN public.parcels.actual_arrival_at IS 'Parcel Padala Phase 1 (042): actual arrival timestamp.';

-- DOWN (commented, run manually if a rollback is ever needed):
-- DROP INDEX IF EXISTS public.idx_parcels_batch_deadline;
-- DROP INDEX IF EXISTS public.idx_parcels_pending_batch;
-- ALTER TABLE public.parcels DROP CONSTRAINT IF EXISTS parcels_batching_status_check;
-- ALTER TABLE public.parcels
--   DROP COLUMN IF EXISTS actual_arrival_at,
--   DROP COLUMN IF EXISTS estimated_arrival_at,
--   DROP COLUMN IF EXISTS scheduled_departure_at,
--   DROP COLUMN IF EXISTS batched_count_at_sail,
--   DROP COLUMN IF EXISTS batching_route_key,
--   DROP COLUMN IF EXISTS batching_cycle_count,
--   DROP COLUMN IF EXISTS batching_deadline_at,
--   DROP COLUMN IF EXISTS batching_started_at,
--   DROP COLUMN IF EXISTS batching_status;
