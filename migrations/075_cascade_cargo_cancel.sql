-- =============================================================
-- 075. CASCADE CARGO CANCELLATION
-- =============================================================
-- Every cancellation path (passenger RPC, admin RPC, direct admin
-- update) now returns pending, unloaded cargo instead of leaving it
-- linked to a cancelled booking. 077: a cancelled carrier cancels every
-- live member of its batch, including members already accepted.
--
-- Run order: AFTER 074. Safe to re-run.
-- =============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.cascade_cargo_cancel()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_ids UUID[];
BEGIN
  SELECT array_agg(DISTINCT p.booking_id)
    INTO v_member_ids
  FROM public.parcels p
  WHERE p.carrier_booking_id = NEW.id
    AND p.booking_id IS NOT NULL
    AND p.booking_id <> NEW.id;

  WITH returned AS (
    UPDATE public.parcels p
    SET status = 'returned',
        batching_status = 'solo',
        batching_route_key = NULL,
        carrier_booking_id = NULL,
        loaded_at = NULL
    WHERE (
        p.carrier_booking_id = NEW.id
        OR (p.carrier_booking_id IS NULL AND p.booking_id = NEW.id)
      )
      AND p.status = 'pending'
      AND p.loaded_at IS NULL
    RETURNING p.id
  )
  DELETE FROM public.manifest_parcels mp
  USING returned r
  WHERE mp.parcel_id = r.id;

  IF v_member_ids IS NOT NULL
     AND (OLD.cargo_mode = 'batched' OR OLD.batch_route_key IS NOT NULL)
  THEN
    UPDATE public.bookings b
    SET trip_stat = 'cancelled',
        cancelled_at = now(),
        cancel_reason = 'Batch cancelled',
        held_by = NULL,
        hold_expires_at = NULL
    WHERE b.id = ANY(v_member_ids)
      AND b.trip_stat IN ('open', 'pending', 'accepted')
      AND b.batch_route_key IS NULL;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_cascade_cargo_cancel ON public.bookings;
CREATE TRIGGER trg_cascade_cargo_cancel
  AFTER UPDATE OF trip_stat ON public.bookings
  FOR EACH ROW
  WHEN (
    NEW.trip_stat = 'cancelled'
    AND OLD.trip_stat IS DISTINCT FROM 'cancelled'
  )
  EXECUTE FUNCTION public.cascade_cargo_cancel();

UPDATE public.bookings b
SET trip_stat = 'cancelled',
    cancelled_at = now(),
    cancel_reason = 'Batch cancelled',
    held_by = NULL,
    hold_expires_at = NULL
WHERE b.trip_stat IN ('open', 'pending', 'accepted')
  AND b.batch_route_key IS NULL
  AND b.id IN (
    SELECT p.booking_id
    FROM public.parcels p
    JOIN public.bookings master ON master.id = p.carrier_booking_id
    WHERE master.trip_stat = 'cancelled'
      AND (master.cargo_mode = 'batched' OR p.batching_status = 'batched')
      AND p.booking_id <> master.id
  );

WITH orphaned AS (
  UPDATE public.parcels p
  SET status = 'returned',
      batching_status = 'solo',
      batching_route_key = NULL,
      carrier_booking_id = NULL,
      loaded_at = NULL
  FROM public.bookings b
  WHERE b.trip_stat = 'cancelled'
    AND p.status = 'pending'
    AND p.loaded_at IS NULL
    AND (
      p.carrier_booking_id = b.id
      OR (p.carrier_booking_id IS NULL AND p.booking_id = b.id)
    )
  RETURNING p.id
)
DELETE FROM public.manifest_parcels mp
USING orphaned o
WHERE mp.parcel_id = o.id;

CREATE OR REPLACE FUNCTION public.cancel_own_booking(
  p_booking_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v public.bookings%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v
  FROM public.bookings
  WHERE id = p_booking_id
    AND user_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'this booking was already cancelled or has changed';
  END IF;

  IF public.is_consolidated_batch_member(p_booking_id)
     OR (
       v.group_booking_id IS NOT NULL
       AND v.service_type = 'cargo'
       AND NOT EXISTS (
         SELECT 1
         FROM public.parcels p
         WHERE p.carrier_booking_id = v.id
       )
     )
  THEN
    RAISE EXCEPTION 'This parcel is already merged into a batch. You cannot cancel it directly.';
  END IF;

  IF v.depart_time IS NOT NULL THEN
    RAISE EXCEPTION 'the boat has already departed — this trip can no longer be cancelled';
  END IF;

  UPDATE public.bookings
  SET trip_stat = 'cancelled',
      cancelled_at = now(),
      cancel_reason = p_reason
  WHERE id = p_booking_id
    AND trip_stat IN ('open', 'accepted', 'pending');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'this booking was already cancelled or has changed';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_own_booking(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancel_own_booking(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.cancel_own_booking(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_own_booking(UUID, TEXT) TO service_role;

COMMIT;
