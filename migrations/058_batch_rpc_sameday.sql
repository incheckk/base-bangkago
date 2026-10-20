-- =============================================================
-- 058. BATCH RESOLVE — SAME-DAY, NO SCHEDULE LOCK
-- =============================================================
-- Why: 055 derived the promoted stub's scheduled_date from the route
-- key ('...-HHMM-YYYYMMDD'). computeNextCrossing() rolls to tomorrow's
-- first crossing once today's crossings are inside the 60-minute
-- booking window, so a batch resolved after the last crossing got
-- scheduled_date = tomorrow and scheduled_time = NULL. The bangkero's
-- Start Trip gate then read advanceLocked = true ("Scheduled sail:
-- <tomorrow> null — Start Trip opens when the slot arrives") and the
-- departure / arrived same-day filters dropped the trip.
--
-- Batched cargo is now a same-day, on-demand consolidation:
--   * promoted booking: scheduled_date = NULL, scheduled_time = NULL
--     (NULL = today everywhere: departure, arrived, booking-status,
--     day-conflict trigger, accept_booking_hold's advance check)
--   * parcels: scheduled_departure_at / estimated_arrival_at cleared
--     at resolve time (no "tomorrow 08:00" leftover)
--   * parcel linking ignores rows that already left the queue
--     (status <> 'pending', e.g. delivered/returned test data)
--   * superseded stubs are only cancelled for parcels still in the
--     queue, never for a sender whose parcel went solo.
--
-- 055 is already applied; forward-only — this replaces the function
-- body. Do NOT edit 054/055. Apply after 057.
--
-- Accepted side effects:
--   1. scheduled_date NULL = today, so accepting the batch obeys the
--      normal same-day FCFS path (hold, port queue, 5-min dwell, GPS)
--      instead of the advance "free accept".
--   2. The batch now occupies today in has_day_conflict (027/031); a
--      bangkero with another accepted trip today cannot also take it.
-- =============================================================

CREATE OR REPLACE FUNCTION resolve_batch_rpc(
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

  -- Parcels still waiting (threshold) and the whole batch size/total.
  SELECT
    COUNT(*) FILTER (WHERE batching_status = 'pending_batch'),
    COUNT(*),
    COALESCE(SUM(total_price), 150)
    INTO v_pending_count, v_batch_size, v_total_price
  FROM parcels
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
    FROM parcels
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
    UPDATE bookings
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
  UPDATE parcels
  SET carrier_booking_id = v_batch_booking_id,
      batching_status = 'batched',
      batched_count_at_sail = v_batch_size
  WHERE batching_route_key = p_route_key
    AND batching_status = 'pending_batch'
    AND status = 'pending';

  -- The batch sails today, not on the route key's original crossing:
  -- drop the computed tomorrow departure/ETA so nothing renders a
  -- stale "08:00 tomorrow".
  UPDATE parcels
  SET scheduled_departure_at = NULL,
      estimated_arrival_at = NULL
  WHERE batching_route_key = p_route_key
    AND batching_status = 'batched';

  -- Free the other senders: close their now-superseded stubs so
  -- getActiveBooking() stops blocking them. The promoted stub
  -- (v_batch_booking_id) is excluded, and only parcels still in this
  -- queue participate (a solo/left-behind parcel keeps its own stub).
  UPDATE bookings
  SET trip_stat = 'cancelled',
      cancel_reason = 'Consolidated into a batched sailing',
      cancelled_at = now(),
      held_by = NULL,
      hold_expires_at = NULL
  WHERE id IN (
    SELECT DISTINCT booking_id
    FROM parcels
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

REVOKE EXECUTE ON FUNCTION resolve_batch_rpc(TEXT, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION resolve_batch_rpc(TEXT, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION resolve_batch_rpc(TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION resolve_batch_rpc(TEXT, INTEGER) TO service_role;

-- =============================================================
-- VERIFY after apply:
--   SELECT proname FROM pg_proc WHERE proname = 'resolve_batch_rpc';
--   -- no scheduled_date assignment remains in the body:
--   SELECT pg_get_functiondef(oid) LIKE '%scheduled_date = COALESCE%'
--   FROM pg_proc WHERE proname = 'resolve_batch_rpc';   -- expect false
--   -- a resolved batch should read:
--   SELECT ref, scheduled_date, scheduled_time, batch_route_key
--   FROM bookings WHERE cargo_mode = 'batched' ORDER BY created_at DESC LIMIT 1;
--   -- and its parcels:
--   SELECT id, status, batching_status, scheduled_departure_at, estimated_arrival_at
--   FROM parcels WHERE batching_status = 'batched';
-- =============================================================
