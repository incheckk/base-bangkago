-- =============================================================
-- 059. BATCH LIFECYCLE + REPRICING ON EVERY LINK
-- =============================================================
-- Why: 058's resolve_batch_rpc is correct on filters, but two
-- lifecycle gaps surfaced in the E2E run:
--
--   1. ABANDONED BATCHES WERE REUSED. A batch resolved at 12:13
--      (anchor + one partner). Both later flipped to 'solo', but the
--      booking kept batch_route_key, so later cohorts (12:55, 13:05)
--      linked into the same booking. Nothing released an empty batch.
--      release_abandoned_batch() (new, SECURITY DEFINER) cancels an
--      open/pending batch once no pending parcel remains in its queue.
--      It MUST be server-side: the batch booking belongs to another
--      sender (bookings_update_owner) and RLS hides other senders'
--      parcels from the caller's count.
--
--   2. total_price WAS ONLY SET AT PROMOTION. Late joiners increased
--      the batch size while the booking stayed at the first cohort's
--      sum (e.g. 4 x 150 linked but total_price = 300). The link path
--      now recomputes it on every invocation.
--
-- resolve_batch_rpc is copied from 058 with exactly two changes:
--   * the idempotent reuse lookup only matches live batches
--     (open | pending | accepted) - never cancelled/completed/no_show,
--     so a released batch cannot be resurrected;
--   * total_price is recomputed after the parcel link, guarded by
--     v_batch_size > 0 so a stray call on a finished batch cannot
--     reset its price to the 150 fallback.
--
-- Forward-only. Apply after 058. No schema changes.
-- =============================================================

-- -------------------------------------------------------------
-- A. Release an abandoned batch (all queue members left).
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_abandoned_batch(p_route_key TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_remaining INTEGER;
  v_cancelled INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_route_key IS NULL OR p_route_key = '' THEN
    RAISE EXCEPTION 'route key required';
  END IF;

  -- Any party to the queue may release it (a sender who just went
  -- solo/returned still owns a parcel carrying this route key).
  IF NOT EXISTS (
    SELECT 1
    FROM public.parcels
    WHERE batching_route_key = p_route_key
      AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'no parcel on this route for you';
  END IF;

  -- Same lock as resolve_batch_rpc: a release and a resolve on the
  -- same route key cannot interleave.
  PERFORM pg_advisory_xact_lock(hashtext('batch_resolve'), hashtext(p_route_key));

  -- Both waiting and already-linked parcels count as "still in the
  -- batch". Only when the whole queue is empty is the batch dead.
  SELECT COUNT(*) INTO v_remaining
  FROM public.parcels
  WHERE batching_route_key = p_route_key
    AND status = 'pending'
    AND batching_status IN ('pending_batch', 'batched');

  IF v_remaining > 0 THEN
    RETURN 0;
  END IF;

  -- Never yank an accepted trip out from under a bangkero.
  UPDATE public.bookings
  SET trip_stat = 'cancelled',
      cancel_reason = 'Batch abandoned',
      cancelled_at = now(),
      held_by = NULL,
      hold_expires_at = NULL
  WHERE batch_route_key = p_route_key
    AND trip_stat IN ('open', 'pending');

  GET DIAGNOSTICS v_cancelled = ROW_COUNT;
  RETURN v_cancelled;
END;
$$;

REVOKE ALL ON FUNCTION public.release_abandoned_batch(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_abandoned_batch(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.release_abandoned_batch(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_abandoned_batch(TEXT) TO service_role;

-- -------------------------------------------------------------
-- B. resolve_batch_rpc (058 body + live-batch reuse + repricing)
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_batch_rpc(
  p_route_key TEXT,
  p_min_count INTEGER
) RETURNS UUID AS $$
DECLARE
  v_batch_booking_id UUID;
  v_stub_id UUID;
  v_pending_count INTEGER;
  v_batch_size INTEGER;
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
  -- cannot promote two different stubs.
  PERFORM pg_advisory_xact_lock(hashtext('batch_resolve'), hashtext(p_route_key));

  -- Idempotent: reuse the shared booking if this route already has a
  -- LIVE batch. 059: a released/completed batch must never be reused.
  SELECT id INTO v_batch_booking_id
  FROM public.bookings
  WHERE batch_route_key = p_route_key
    AND trip_stat IN ('open', 'pending', 'accepted')
  LIMIT 1;

  -- Ownership guard: the caller must be party to this batch. Applied
  -- only when there is no booking yet, so a later/duplicate call can
  -- still return the existing id.
  IF v_batch_booking_id IS NULL AND NOT EXISTS (
    SELECT 1 FROM public.parcels
    WHERE batching_route_key = p_route_key
      AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'no parcel on this route for you';
  END IF;

  -- Parcels still waiting (threshold) and the whole batch size/total.
  SELECT
    COUNT(*) FILTER (WHERE batching_status = 'pending_batch'),
    COUNT(*),
    COALESCE(SUM(total_price), 150)
    INTO v_pending_count, v_batch_size, v_total_price
  FROM public.parcels
  WHERE batching_route_key = p_route_key
    AND status = 'pending'
    AND batching_status IN ('pending_batch', 'batched');

  -- First resolve: promote one existing stub instead of inserting a new
  -- booking (see 055). Reuses the earliest pending parcel's stub.
  IF v_batch_booking_id IS NULL THEN
    IF v_pending_count < v_min THEN
      RETURN NULL; -- below threshold: leave pending (solo path)
    END IF;

    SELECT booking_id INTO v_stub_id
    FROM public.parcels
    WHERE batching_route_key = p_route_key
      AND batching_status = 'pending_batch'
      AND status = 'pending'
    ORDER BY created_at
    LIMIT 1;

    IF v_stub_id IS NULL THEN
      RAISE EXCEPTION 'no parcel to anchor the batch';
    END IF;

    -- Same-day batch: NULL schedule = today (058). Explicitly clears a
    -- stale date/time if the stub carried one.
    UPDATE public.bookings
    SET batch_route_key = p_route_key,
        is_dispatchable = true,
        cargo_mode = 'batched',
        scheduled_date = NULL,
        scheduled_time = NULL,
        total_price = v_total_price,
        held_by = NULL,
        hold_expires_at = NULL
    WHERE id = v_stub_id
      AND batch_route_key IS NULL
    RETURNING id INTO v_batch_booking_id;

    -- Never fall through to an INSERT (the 054 one-active collision).
    IF v_batch_booking_id IS NULL THEN
      RAISE EXCEPTION 'batch booking could not be promoted';
    END IF;
  END IF;

  -- Link pending parcels on the route to the shared booking. Rows that
  -- already left the queue (delivered/returned test data) must not be
  -- relinked.
  UPDATE public.parcels
  SET carrier_booking_id = v_batch_booking_id,
      batching_status = 'batched',
      batched_count_at_sail = v_batch_size
  WHERE batching_route_key = p_route_key
    AND batching_status = 'pending_batch'
    AND status = 'pending';

  -- 059: price the batch from what is actually linked, including late
  -- joiners. The guard keeps a duplicate call on a finished batch from
  -- falling back to the 150 default.
  IF v_batch_size > 0 THEN
    UPDATE public.bookings
    SET total_price = (
      SELECT COALESCE(SUM(total_price), 150)
      FROM public.parcels
      WHERE batching_route_key = p_route_key
        AND batching_status = 'batched'
        AND status = 'pending'
    )
    WHERE id = v_batch_booking_id;
  END IF;

  -- The batch sails today, not on the route key's original crossing:
  -- drop the computed tomorrow departure/ETA so nothing renders a
  -- stale "08:00 tomorrow".
  UPDATE public.parcels
  SET scheduled_departure_at = NULL,
      estimated_arrival_at = NULL
  WHERE batching_route_key = p_route_key
    AND batching_status = 'batched';

  -- Free the other senders: close their now-superseded stubs so
  -- getActiveBooking() stops blocking them. The promoted stub
  -- (v_batch_booking_id) is excluded, and only parcels still in this
  -- queue participate (a solo/left-behind parcel keeps its own stub).
  UPDATE public.bookings
  SET trip_stat = 'cancelled',
      cancel_reason = 'Consolidated into a batched sailing',
      cancelled_at = now(),
      held_by = NULL,
      hold_expires_at = NULL
  WHERE id IN (
    SELECT DISTINCT booking_id
    FROM public.parcels
    WHERE batching_route_key = p_route_key
      AND booking_id IS NOT NULL
      AND booking_id <> v_batch_booking_id
      AND status = 'pending'
      AND batching_status IN ('pending_batch', 'batched')
  )
    AND trip_stat IN ('open', 'pending')
    AND batch_route_key IS NULL;

  RETURN v_batch_booking_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.resolve_batch_rpc(TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_batch_rpc(TEXT, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.resolve_batch_rpc(TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_batch_rpc(TEXT, INTEGER) TO service_role;

-- =============================================================
-- VERIFY after apply:
--   SELECT proname FROM pg_proc
--   WHERE proname IN ('resolve_batch_rpc', 'release_abandoned_batch');
--   -- reuse is restricted to live batches:
--   SELECT pg_get_functiondef(oid) LIKE '%trip_stat IN (''open'', ''pending'', ''accepted'')%'
--   FROM pg_proc WHERE proname = 'resolve_batch_rpc';   -- expect true
--   -- repricing block present:
--   SELECT pg_get_functiondef(oid) LIKE '%v_batch_size > 0%'
--   FROM pg_proc WHERE proname = 'resolve_batch_rpc';   -- expect true
--   -- latest batch price = 150 * linked pending parcels:
--   SELECT ref, total_price, batch_route_key
--   FROM bookings WHERE cargo_mode = 'batched' ORDER BY created_at DESC LIMIT 1;
--   SELECT COUNT(*), SUM(total_price) FROM parcels
--   WHERE batching_status = 'batched' AND status = 'pending';
-- =============================================================
