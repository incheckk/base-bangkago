-- =============================================================
-- 052. BOOKINGS.CARGO_MODE — delivery mode on the booking row
-- =============================================================
-- Why: RLS hides a pending_batch parcel from a bangkero (005 wants
-- bookings.operator_id = auth.uid(); 050 only exposes batching_status
-- = 'batched'). The Home screen therefore cannot read the parcel to
-- decide whether a cargo stub should be hidden. Mirroring the parcel's
-- delivery_type onto its booking lets the client read it directly.
--
-- Run order: AFTER 051. Forward-only — never delete 002-051.
-- Safe to re-run (column/constraint guarded, backfill idempotent,
-- trigger replaced).
-- =============================================================

-- -------------------------------------------------------------
-- 1. Column + constraint
-- -------------------------------------------------------------
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS cargo_mode TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bookings_cargo_mode_check'
  ) THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_cargo_mode_check
      CHECK (
        cargo_mode IS NULL
        OR cargo_mode IN ('accompanied', 'piggyback', 'batched', 'solo')
      );
  END IF;
END
$$;

COMMENT ON COLUMN public.bookings.cargo_mode IS
  'Delivery mode mirrored from the linked parcel (052). Read by the bangkero Home screen to hide batched stubs without hitting parcels RLS.';

-- -------------------------------------------------------------
-- 2. Backfill existing cargo bookings from their parcel
-- -------------------------------------------------------------
UPDATE public.bookings b
SET cargo_mode = p.delivery_type
FROM (
  SELECT DISTINCT ON (booking_id) booking_id, delivery_type
  FROM public.parcels
  WHERE booking_id IS NOT NULL
  ORDER BY booking_id, created_at
) p
WHERE p.booking_id = b.id
  AND b.service_type = 'cargo'
  AND b.cargo_mode IS DISTINCT FROM p.delivery_type;

-- -------------------------------------------------------------
-- 3. Keep it in sync for new/edited parcels
--    SECURITY DEFINER so the passenger's parcel write can stamp a
--    booking row its RLS would otherwise not let it update.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_booking_cargo_mode()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.booking_id IS NOT NULL THEN
    UPDATE public.bookings
    SET cargo_mode = NEW.delivery_type
    WHERE id = NEW.booking_id
      AND cargo_mode IS DISTINCT FROM NEW.delivery_type;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS parcels_sync_booking_cargo_mode ON public.parcels;
CREATE TRIGGER parcels_sync_booking_cargo_mode
  AFTER INSERT OR UPDATE OF delivery_type ON public.parcels
  FOR EACH ROW EXECUTE FUNCTION public.sync_booking_cargo_mode();