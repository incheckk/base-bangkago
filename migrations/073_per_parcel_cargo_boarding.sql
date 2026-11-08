-- =============================================================
-- 073. PER-PARCEL CARGO BOARDING, CARGO NO-SHOW, GHOST-BATCH CLEANUP
-- =============================================================
-- Why:
--   * A batched cargo booking could only be boarded as one group. The
--     bangkero needs to check each parcel and leave behind only the cargo
--     that is actually at the port.
--   * A cancelled / completed booking kept its batch_route_key, so the
--     unique batch key stayed occupied and blocked later batches on the
--     same route. Closing a trip now releases the key automatically.
--   * The old cargo no-show path cancels the passenger booking and can ban
--     the sender. Cargo no-show must only return the parcel.
--
-- Run order: AFTER 072. Safe to re-run (columns/triggers/function bodies
-- are replaceable; the backfills are guarded).
-- =============================================================

BEGIN;

-- -------------------------------------------------------------
-- 1. Per-parcel loaded state
-- -------------------------------------------------------------
-- The legacy backfill may run ONLY when this migration first adds the
-- column. Re-running it later would mark parcels that the bangkero
-- intentionally left unchecked as loaded whenever a sibling is aboard.
DO $$
DECLARE
  v_new_column BOOLEAN;
BEGIN
  SELECT NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'parcels'
      AND column_name = 'loaded_at'
  ) INTO v_new_column;

  IF v_new_column THEN
    ALTER TABLE public.parcels
      ADD COLUMN loaded_at TIMESTAMPTZ;

    -- Preserve already-boarded cargo from the old group Cargo Ready tick:
    -- accepted cargo bookings with onboarded_at set keep every attached
    -- pending or already-under-way parcel on board when the per-parcel
    -- model takes over.
    UPDATE public.parcels p
    SET loaded_at = COALESCE(p.loaded_at, b.onboarded_at, now())
    FROM public.bookings b
    WHERE p.loaded_at IS NULL
      AND p.status IN ('pending', 'in_transit')
      AND p.delivery_type IS DISTINCT FROM 'accompanied'
      AND b.service_type = 'cargo'
      AND b.trip_stat = 'accepted'
      AND b.onboarded_at IS NOT NULL
      AND (p.carrier_booking_id = b.id OR p.booking_id = b.id);
  END IF;
END;
$$;

COMMENT ON COLUMN public.parcels.loaded_at IS
  'Set when the bangkero checks this parcel as loaded (073). NULL for unloaded or returned cargo.';

CREATE INDEX IF NOT EXISTS idx_parcels_loaded_at
  ON public.parcels (loaded_at)
  WHERE loaded_at IS NOT NULL;

-- -------------------------------------------------------------
-- 2. Release a batch key whenever its booking closes
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clear_batch_route_key_on_close()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.trip_stat IN ('cancelled', 'completed')
     AND OLD.trip_stat IS DISTINCT FROM NEW.trip_stat THEN
    NEW.batch_route_key := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clear_batch_route_key_on_close ON public.bookings;
CREATE TRIGGER trg_clear_batch_route_key_on_close
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.clear_batch_route_key_on_close();

-- One-time cleanup for the ghost keys already in the database.
UPDATE public.bookings
SET batch_route_key = NULL
WHERE batch_route_key IS NOT NULL
  AND trip_stat IN ('cancelled', 'completed');

-- -------------------------------------------------------------
-- 3. Per-parcel boarding
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_parcel_loaded(
  p_parcel_id UUID,
  p_loaded BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parcel public.parcels%ROWTYPE;
  v_booking public.bookings%ROWTYPE;
  v_booking_id UUID;
  v_any_loaded BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_parcel
  FROM public.parcels
  WHERE id = p_parcel_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'parcel not found';
  END IF;

  IF v_parcel.status IN ('delivered', 'returned') THEN
    RAISE EXCEPTION 'this parcel is already closed';
  END IF;
  IF v_parcel.status <> 'pending' THEN
    RAISE EXCEPTION 'this parcel has already left the pier';
  END IF;
  IF v_parcel.delivery_type = 'piggyback'
     AND v_parcel.approval_status IS DISTINCT FROM 'accepted' THEN
    RAISE EXCEPTION 'this piggyback request is not accepted';
  END IF;

  -- Piggyback parcels point at the passenger ride in carrier_booking_id,
  -- but their accepted cargo stub is booking_id. Batched parcels point at
  -- the shared master in carrier_booking_id.
  IF v_parcel.delivery_type = 'piggyback' THEN
    v_booking_id := v_parcel.booking_id;
  ELSE
    v_booking_id := COALESCE(v_parcel.carrier_booking_id, v_parcel.booking_id);
  END IF;

  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = v_booking_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_booking.trip_stat <> 'accepted'
     OR v_booking.operator_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'this trip changed';
  END IF;

  IF v_booking.depart_time IS NOT NULL THEN
    RAISE EXCEPTION 'this trip has already departed';
  END IF;

  IF p_loaded THEN
    UPDATE public.parcels
    SET loaded_at = COALESCE(loaded_at, now())
    WHERE id = p_parcel_id;
  ELSE
    UPDATE public.parcels
    SET loaded_at = NULL
    WHERE id = p_parcel_id;

    -- If this parcel was already snapped into a manifest, take it back out.
    -- The next populate/finalize pass recalculates the manifest totals.
    DELETE FROM public.manifest_parcels
    WHERE parcel_id = p_parcel_id;
  END IF;

  IF v_booking.service_type = 'cargo' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.parcels p
      WHERE p.status = 'pending'
        AND p.loaded_at IS NOT NULL
        AND (p.carrier_booking_id = v_booking.id OR p.booking_id = v_booking.id)
    ) INTO v_any_loaded;

    UPDATE public.bookings
    SET onboarded_at = CASE
      WHEN v_any_loaded THEN COALESCE(onboarded_at, now())
      ELSE NULL
    END
    WHERE id = v_booking.id;
  END IF;
END;
$$;

-- -------------------------------------------------------------
-- 4. Parcel-only cargo no-show
-- -------------------------------------------------------------
-- Returns TRUE when returning this last parcel cancelled the cargo booking.
-- It never writes no_show_at and never calls the passenger ban logic.
CREATE OR REPLACE FUNCTION public.mark_parcel_no_show(p_parcel_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parcel public.parcels%ROWTYPE;
  v_booking public.bookings%ROWTYPE;
  v_booking_id UUID;
  v_remaining INTEGER;
  v_cancelled BOOLEAN := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_parcel
  FROM public.parcels
  WHERE id = p_parcel_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'parcel not found';
  END IF;

  IF v_parcel.status = 'returned' THEN
    RETURN false;
  END IF;

  IF v_parcel.status <> 'pending' OR v_parcel.loaded_at IS NOT NULL THEN
    RAISE EXCEPTION 'only unloaded cargo still at the pier can be returned';
  END IF;

  IF v_parcel.delivery_type = 'accompanied' THEN
    RAISE EXCEPTION 'accompanied cargo follows the passenger booking';
  END IF;
  IF v_parcel.delivery_type = 'piggyback'
     AND v_parcel.approval_status IS DISTINCT FROM 'accepted' THEN
    RAISE EXCEPTION 'this piggyback request is not accepted';
  END IF;

  IF v_parcel.delivery_type = 'piggyback' THEN
    v_booking_id := v_parcel.booking_id;
  ELSE
    v_booking_id := COALESCE(v_parcel.carrier_booking_id, v_parcel.booking_id);
  END IF;

  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = v_booking_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_booking.trip_stat <> 'accepted'
     OR v_booking.operator_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'this trip changed';
  END IF;

  IF v_booking.depart_time IS NOT NULL THEN
    RAISE EXCEPTION 'this trip has already departed';
  END IF;

  UPDATE public.parcels
  SET status = 'returned'
  WHERE id = p_parcel_id;

  DELETE FROM public.manifest_parcels
  WHERE parcel_id = p_parcel_id;

  -- "Last parcel" means every parcel attached to this accepted cargo
  -- booking is now returned. Loaded or delivered siblings keep the trip
  -- alive, so only a truly empty cargo batch is cancelled.
  SELECT COUNT(*)
  INTO v_remaining
  FROM public.parcels p
  WHERE p.status <> 'returned'
    AND (p.carrier_booking_id = v_booking.id OR p.booking_id = v_booking.id);

  IF v_remaining = 0
     AND v_booking.service_type = 'cargo'
     AND COALESCE(v_booking.cargo_mode, v_parcel.delivery_type) <> 'accompanied' THEN
    UPDATE public.bookings
    SET trip_stat = 'cancelled',
        cancelled_at = COALESCE(cancelled_at, now()),
        cancel_reason = 'All cargo parcels were marked not at port',
        batch_route_key = NULL,
        is_dispatchable = false,
        held_by = NULL,
        hold_expires_at = NULL
    WHERE id = v_booking.id
      AND trip_stat = 'accepted';

    v_cancelled := FOUND;
  END IF;

  RETURN v_cancelled;
END;
$$;

REVOKE ALL ON FUNCTION public.set_parcel_loaded(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_parcel_loaded(UUID, BOOLEAN) TO authenticated;

REVOKE ALL ON FUNCTION public.mark_parcel_no_show(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_parcel_no_show(UUID) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =============================================================
-- VERIFY after apply:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'parcels' AND column_name = 'loaded_at';
--   SELECT proname FROM pg_proc
--    WHERE proname IN ('set_parcel_loaded', 'mark_parcel_no_show',
--                      'clear_batch_route_key_on_close');
--   SELECT tgname FROM pg_trigger
--    WHERE tgname = 'trg_clear_batch_route_key_on_close';
--   SELECT COUNT(*) FROM bookings
--    WHERE batch_route_key IS NOT NULL
--      AND trip_stat IN ('cancelled', 'completed');  -- expect 0
-- =============================================================
