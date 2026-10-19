-- =============================================================
-- 054. BATCH RESOLVE — one shared booking per batched crossing
-- =============================================================
-- Why: 050 defined carrier_booking_id as "the ONE sailing a parcel
-- rides on", with batched -> "the batch booking created at
-- resolveBatchOutcome". That booking was never created: the service
-- linked every batched parcel to its OWN cargo stub
-- (carrier_booking_id = own.booking_id), so the sailing manifest and
-- completeBooking().or(...) could only ever match the one parcel whose
-- stub happened to be accepted. resolveBatchOutcome was also dead code
-- (no callers). This migration supplies the missing server side:
-- resolve_batch_rpc() creates ONE shared, dispatchable batch booking
-- for a route key and relinks every pending parcel to it.
--
-- Run order: AFTER 053. Forward-only — never delete 002-053. Safe to
-- re-run (column/index/function replaced; resolution idempotent).
-- =============================================================

-- -------------------------------------------------------------
-- 1. Idempotency key on the shared batch booking.
-- -------------------------------------------------------------
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS batch_route_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_batch_route_unique
  ON public.bookings (batch_route_key)
  WHERE batch_route_key IS NOT NULL;

COMMENT ON COLUMN public.bookings.batch_route_key IS
  'Batch route key (054) on the ONE shared booking created by resolve_batch_rpc for a batched crossing. NULL for every other booking.';

-- -------------------------------------------------------------
-- 2. resolve_batch_rpc — create/relink the shared batch booking.
--    SECURITY DEFINER: a sender can only UPDATE its own parcels
--    (parcels_select_own, 002) and INSERT bookings owned by itself
--    (bookings_insert_own, 002), so linking other senders' parcels to
--    a shared booking must run as the definer. Returns the batch
--    booking id, or NULL when the route is below the threshold (solo).
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION resolve_batch_rpc(
  p_route_key TEXT,
  p_min_count INTEGER
) RETURNS UUID AS $$
DECLARE
  v_batch_booking_id UUID;
  v_batched_count INTEGER;
  v_route_id TEXT;
  v_scheduled_date DATE;
  v_total_price DECIMAL(10, 2);
  v_min INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_route_key IS NULL OR p_route_key = '' THEN
    RAISE EXCEPTION 'route key required';
  END IF;

  v_min := GREATEST(COALESCE(p_min_count, 2), 1);

  -- Serialize resolution per route so two senders at the deadline
  -- cannot create two batch bookings.
  PERFORM pg_advisory_xact_lock(hashtext('batch_resolve'), hashtext(p_route_key));

  -- Idempotent: reuse the shared booking if this route already resolved.
  SELECT id INTO v_batch_booking_id
  FROM bookings
  WHERE batch_route_key = p_route_key
  LIMIT 1;

  -- Ownership guard: the caller must be party to this batch. Applied
  -- only when there is no booking yet, so a later/duplicate call can
  -- still return the existing id.
  IF v_batch_booking_id IS NULL AND NOT EXISTS (
    SELECT 1 FROM parcels
    WHERE batching_route_key = p_route_key
      AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'no parcel on this route for you';
  END IF;

  -- Parcels still waiting in this batch.
  SELECT COUNT(*) INTO v_batched_count
  FROM parcels
  WHERE batching_route_key = p_route_key
    AND batching_status = 'pending_batch';

  -- Already resolved: relink any late joiners, then return the id.
  IF v_batch_booking_id IS NOT NULL THEN
    UPDATE parcels
    SET carrier_booking_id = v_batch_booking_id,
        batching_status = 'batched',
        batched_count_at_sail = (
          SELECT COUNT(*) FROM parcels
          WHERE batching_route_key = p_route_key
            AND batching_status IN ('pending_batch', 'batched')
        )
    WHERE batching_route_key = p_route_key
      AND batching_status = 'pending_batch';
    RETURN v_batch_booking_id;
  END IF;

  -- Below threshold: leave the parcels pending (solo path).
  IF v_batched_count < v_min THEN
    RETURN NULL;
  END IF;

  -- Route key format: {from}__{to}-HHMM-YYYYMMDD (041/042). Port ids
  -- may contain hyphens (e.g. st-vicente), so anchor on the double
  -- underscore and the trailing -HHMM-YYYYMMDD instead of splitting
  -- on dashes.
  v_route_id := regexp_replace(p_route_key, '^(.+?)__([^_]+)-(\d{4})-(\d{8})$', '\1__\2');
  v_scheduled_date := to_date(right(p_route_key, 8), 'YYYYMMDD');

  SELECT SUM(total_price) INTO v_total_price
  FROM parcels
  WHERE batching_route_key = p_route_key
    AND batching_status = 'pending_batch';

  -- One shared cargo booking. ref/id are filled by the
  -- set_booking_ref BEFORE INSERT trigger (002). scheduled_time is
  -- left NULL on purpose: crossings are 08:00/12:00/16:00, which the
  -- bookings_scheduled_time_check would reject.
  INSERT INTO bookings (
    user_id, service_type, route_id, num_of_passenger,
    total_price, trip_stat, is_dispatchable, cargo_mode,
    batch_route_key, scheduled_date
  ) VALUES (
    auth.uid(), 'cargo', v_route_id, 1,
    COALESCE(v_total_price, 150), 'open', true, 'batched',
    p_route_key, v_scheduled_date
  ) RETURNING id INTO v_batch_booking_id;

  -- Relink EVERY pending parcel on the route to the shared booking.
  UPDATE parcels
  SET carrier_booking_id = v_batch_booking_id,
      batching_status = 'batched',
      batched_count_at_sail = v_batched_count
  WHERE batching_route_key = p_route_key
    AND batching_status = 'pending_batch';

  RETURN v_batch_booking_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION resolve_batch_rpc(TEXT, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION resolve_batch_rpc(TEXT, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION resolve_batch_rpc(TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION resolve_batch_rpc(TEXT, INTEGER) TO service_role;

-- =============================================================
-- DOWN (commented — run manually if a rollback is ever needed).
-- Migrations are forward-only by project rule; this is a reference.
-- =============================================================
-- DROP FUNCTION IF EXISTS resolve_batch_rpc(TEXT, INTEGER);
-- DROP INDEX IF EXISTS public.idx_bookings_batch_route_unique;
-- ALTER TABLE public.bookings DROP COLUMN IF EXISTS batch_route_key;
--
-- VERIFY after apply:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='bookings' AND column_name='batch_route_key';
--   SELECT proname FROM pg_proc WHERE proname='resolve_batch_rpc';
-- =============================================================
