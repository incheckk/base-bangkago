-- =============================================================
-- 055. BATCH RESOLVE — reuse a stub (fix ownership collision)
-- =============================================================
-- Why: 054 created ONE new booking for the batch with
-- user_id = auth.uid() and trip_stat = 'open'. That collides with
-- bookings_one_active_per_passenger (023) — a partial unique index on
-- (user_id) WHERE trip_stat IN ('open','accepted') — because the
-- triggering sender already holds their parcel's 'open' stub.
--   ERROR: duplicate key value violates unique constraint
--          "bookings_one_active_per_passenger"
--
-- Fix: do not INSERT. Promote ONE existing parcel stub into the shared
-- batch booking — the exact pattern create_solo_sailing() already uses
-- (050). An UPDATE cannot collide with the one-active index, and the
-- unique batch_route_key (054) keeps it idempotent.
--
-- Decisions (locked):
--   * Promoted stub  = earliest pending parcel's booking_id.
--   * total_price    = SUM of the route's sailing parcels.
--   * Other senders' superseded stubs are cancelled here so they no
--     longer block that sender's own getActiveBooking guard.
--
-- Run order: AFTER 054. Forward-only — never delete 002-054. Safe to
-- re-run (function replaced; resolution idempotent).
--
-- Caveats (accepted):
--   1. The other senders' stubs are cancelled at RESOLVE time (about an
--      hour before sailing), so those senders see a cancelled cargo
--      booking until the crossing is delivered. That is the cost of
--      freeing their one-active slot immediately.
--   2. The promoted stub's owner can still UPDATE the batch booking via
--      bookings_update_owner (002, auth.uid() = user_id) — the same
--      exposure solo stubs already have. Acceptable for the demo.
--   3. Same-day only: the promote path assumes the stub is
--      trip_stat='open'. An advance stub ('pending') is not made
--      accept-eligible here (accept_booking_hold wants 'open').
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
  v_scheduled_date DATE;
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

  v_scheduled_date := to_date(right(p_route_key, 8), 'YYYYMMDD');

  -- First resolve: promote one existing stub instead of inserting a new
  -- booking (see header). Reuses the earliest pending parcel's stub.
  IF v_batch_booking_id IS NULL THEN
    IF v_pending_count < v_min THEN
      RETURN NULL; -- below threshold: leave pending (solo path)
    END IF;

    SELECT booking_id INTO v_stub_id
    FROM parcels
    WHERE batching_route_key = p_route_key
      AND batching_status = 'pending_batch'
    ORDER BY created_at
    LIMIT 1;

    IF v_stub_id IS NULL THEN
      RAISE EXCEPTION 'no parcel to anchor the batch';
    END IF;

    UPDATE bookings
    SET batch_route_key = p_route_key,
        is_dispatchable = true,
        cargo_mode = 'batched',
        scheduled_date = COALESCE(scheduled_date, v_scheduled_date),
        total_price = v_total_price,
        held_by = NULL,
        hold_expires_at = NULL
    WHERE id = v_stub_id
      AND batch_route_key IS NULL
    RETURNING id INTO v_batch_booking_id;

    -- Never fall through to an INSERT (that is what caused 054's
    -- one-active-per-passenger collision).
    IF v_batch_booking_id IS NULL THEN
      RAISE EXCEPTION 'batch booking could not be promoted';
    END IF;
  END IF;

  -- Link EVERY pending parcel on the route to the shared booking.
  UPDATE parcels
  SET carrier_booking_id = v_batch_booking_id,
      batching_status = 'batched',
      batched_count_at_sail = v_batch_size
  WHERE batching_route_key = p_route_key
    AND batching_status = 'pending_batch';

  -- Free the other senders: close their now-superseded stubs so
  -- getActiveBooking() (statuses pending|open|accepted) stops blocking
  -- them. The promoted stub (v_batch_booking_id) is excluded.
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
-- DOWN (commented — run manually if a rollback is ever needed).
-- Migrations are forward-only by project rule; re-running 054
-- restores the previous INSERT-based body.
-- =============================================================
-- (no DOWN for this replace — 054 owns the column/index; re-run 054 to
--  revert the function body)
--
-- VERIFY after apply:
--   SELECT proname FROM pg_proc WHERE proname='resolve_batch_rpc';
--   -- then, at a real deadline, confirm no duplicate-key error and that
--   -- the route now has exactly one booking with batch_route_key set.
-- =============================================================
