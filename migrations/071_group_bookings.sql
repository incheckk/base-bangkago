-- =============================================================
-- 071. GROUP BOOKINGS + NO SILENT BATCH CANCELLATION
-- =============================================================
-- Why:
--   1. Multiple accepted bookings on the same boat/route/sailing are
--      one boat load. A shared group_booking_id lets the bangkero UI
--      render one card instead of N separate cards.
--   2. resolve_batch_rpc used to CANCEL every other sender's stub when
--      a batch was promoted. Those senders lost their booking silently.
--      They are now demoted (open + is_dispatchable=false) instead.
--
-- Group key: operator_id + route_id + sailing day + slot.
--   - Same-day rows use Manila today and ignore the slot.
--   - Advance rows use scheduled_date + scheduled_time.
--
-- Forward-only. Apply after 070. No demo reset.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Column + index + backfill
-- -------------------------------------------------------------
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS group_booking_id UUID;

CREATE INDEX IF NOT EXISTS bookings_group_idx
  ON public.bookings (operator_id, group_booking_id)
  WHERE group_booking_id IS NOT NULL;

COMMENT ON COLUMN public.bookings.group_booking_id IS
  '071: shared by accepted bookings on one boat + route + sailing day/slot.';

-- Backfill existing accepted groups (only where at least 2 rows exist).
WITH grouped AS (
  SELECT
    operator_id,
    route_id,
    COALESCE(scheduled_date, (now() AT TIME ZONE 'Asia/Manila')::date) AS sail_day,
    CASE
      WHEN COALESCE(scheduled_date, (now() AT TIME ZONE 'Asia/Manila')::date)
           > (now() AT TIME ZONE 'Asia/Manila')::date
      THEN COALESCE(scheduled_time, '')
      ELSE ''
    END AS sail_slot,
    gen_random_uuid() AS gid
  FROM public.bookings
  WHERE trip_stat = 'accepted'
    AND operator_id IS NOT NULL
    AND group_booking_id IS NULL
  GROUP BY 1, 2, 3, 4
  HAVING COUNT(*) > 1
)
UPDATE public.bookings b
SET group_booking_id = g.gid
FROM grouped g
WHERE b.trip_stat = 'accepted'
  AND b.group_booking_id IS NULL
  AND b.operator_id = g.operator_id
  AND b.route_id = g.route_id
  AND COALESCE(b.scheduled_date, (now() AT TIME ZONE 'Asia/Manila')::date) = g.sail_day
  AND (g.sail_slot = '' OR COALESCE(b.scheduled_time, '') = g.sail_slot);

-- -------------------------------------------------------------
-- 2. Recognize a consolidated batch member
-- -------------------------------------------------------------
-- A sender's own stub can be linked to another booking (the promoted
-- batch master). That stub is still open, but it is not a real trip
-- for the sender and must not block their next booking.
CREATE OR REPLACE FUNCTION public.is_consolidated_batch_member(p_booking_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.parcels p
    WHERE p.booking_id = p_booking_id
      AND p.batching_status = 'batched'
      AND p.carrier_booking_id IS NOT NULL
      AND p.carrier_booking_id <> p.booking_id
  );
$$;

REVOKE ALL ON FUNCTION public.is_consolidated_batch_member(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_consolidated_batch_member(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_consolidated_batch_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_consolidated_batch_member(UUID) TO service_role;

-- -------------------------------------------------------------
-- 3. Passenger slot rule (062 body + consolidated-member exemption)
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_passenger_booking_slot()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'Asia/Manila')::date;
  v_day DATE := COALESCE(NEW.scheduled_date, v_today);
  v_same_day BOOLEAN := v_day <= v_today;
  v_clash INTEGER;
BEGIN
  SELECT count(*) INTO v_clash
  FROM public.bookings b
  WHERE b.user_id = NEW.user_id
    AND b.id <> NEW.id
    AND b.trip_stat IN ('pending', 'open', 'accepted')
    AND COALESCE(b.scheduled_date, v_today) = v_day
    AND (v_same_day OR b.scheduled_time IS NOT DISTINCT FROM NEW.scheduled_time)
    AND NOT public.is_consolidated_batch_member(b.id);

  IF v_clash > 0 THEN
    IF v_same_day THEN
      RAISE EXCEPTION 'You already have a same-day booking. Finish or cancel it first.';
    ELSE
      RAISE EXCEPTION 'You already have an advance booking for that date and sailing time.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_passenger_booking_slot() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enforce_passenger_booking_slot() TO authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_passenger_booking_slot() TO service_role;

-- -------------------------------------------------------------
-- 4. accept_booking_hold (050 body + group assignment)
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION accept_booking_hold(
  p_booking_id UUID, p_operator_name TEXT
) RETURNS VOID AS $$
DECLARE
  v bookings%ROWTYPE;
  v_route routes%ROWTYPE;
  v_port TEXT;
  v_dest TEXT;
  v_advance BOOLEAN;
  v_group_id UUID;
  v_group_day DATE;
  v_group_slot TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v FROM bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking not found';
  END IF;
  IF v.trip_stat <> 'open' THEN
    RAISE EXCEPTION 'taken by another bangkero';
  END IF;

  -- Option B (050): parcel-mode stubs cannot be accepted directly.
  -- Solo stubs become accept-eligible only after create_solo_sailing()
  -- flips is_dispatchable to true.
  IF NOT COALESCE(v.is_dispatchable, true) THEN
    RAISE EXCEPTION 'this booking cannot be accepted directly';
  END IF;

  v_advance := v.scheduled_date IS NOT NULL
           AND v.scheduled_date > (now() AT TIME ZONE 'Asia/Manila')::date;

  -- Re-read the hold if it is not (or no longer) ours, so a just-
  -- expired offer cascades before the eligibility checks below.
  -- Advance bookings have no hold — skip straight to the gates.
  IF NOT v_advance
     AND (v.held_by IS DISTINCT FROM auth.uid()
          OR v.hold_expires_at IS NULL
          OR v.hold_expires_at <= now()) THEN
    PERFORM assign_next_hold(p_booking_id);
    SELECT * INTO v FROM bookings WHERE id = p_booking_id;
    IF v.trip_stat <> 'open' THEN
      RAISE EXCEPTION 'taken by another bangkero';
    END IF;
  END IF;

  IF v.rejected_by IS NOT NULL AND v.rejected_by @> ARRAY[auth.uid()] THEN
    RAISE EXCEPTION 'you already passed on this request';
  END IF;

  SELECT * INTO v_route FROM routes WHERE id = v.route_id;
  v_port := v_route.start_port_id;
  v_dest := v_route.end_port_id;

  IF NOT v_advance AND NOT dev_dispatch_bypass() THEN
    -- Queued at the departure port (strict queue-only)…
    IF NOT EXISTS (
      SELECT 1 FROM port_queue pq
      WHERE pq.bangkero_id = auth.uid()
        AND pq.port_id = v_port
        AND pq.left_at IS NULL
    ) THEN
      RAISE EXCEPTION 'your boat is not queued at this port';
    END IF;
    -- …with the 5-minute dwell already served.
    IF EXISTS (
      SELECT 1 FROM port_queue pq
      WHERE pq.bangkero_id = auth.uid()
        AND pq.port_id = v_port
        AND pq.left_at IS NULL
        AND pq.entered_at > now() - INTERVAL '5 minutes'
    ) THEN
      RAISE EXCEPTION 'your boat is still entering the port queue';
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM bangkeros b WHERE b.id = auth.uid()) THEN
    RAISE EXCEPTION 'not a registered bangkero';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM bangkeros b WHERE b.id = auth.uid() AND b.is_available
  ) THEN
    RAISE EXCEPTION 'you are offline — turn on availability to accept';
  END IF;

  -- Bangkero gates (010): documents approved + rating above floor.
  IF NOT dev_gates_bypass() THEN
    IF NOT EXISTS (
      SELECT 1 FROM bangkeros b
      WHERE b.id = auth.uid() AND b.verification_stat = 'verified'
    ) THEN
      RAISE EXCEPTION 'your documents are not approved yet';
    END IF;
    IF NOT bangkero_rating_ok(auth.uid()) THEN
      RAISE EXCEPTION 'your rating is too low to accept bookings';
    END IF;
  END IF;

  IF NOT v_advance AND NOT dev_dispatch_bypass() THEN
    -- Fresh fix = the presence sync proved the boat is still parked.
    IF NOT EXISTS (
      SELECT 1 FROM vessel_tracking vt
      JOIN bangkas bk ON bk.id = vt.bangka_id
      WHERE bk.bangkero_id = auth.uid()
        AND vt.recorded_at > now() - INTERVAL '3 minutes'
    ) THEN
      RAISE EXCEPTION 'your boat has no recent GPS position';
    END IF;
  END IF;

  IF NOT v_advance AND NOT route_ok(auth.uid(), v_dest) THEN
    RAISE EXCEPTION 'you have accepted trips to another destination';
  END IF;

  IF NOT fits_booking(auth.uid(), v.service_type, v.num_of_passenger) THEN
    RAISE EXCEPTION 'not enough space on your boat for this trip';
  END IF;

  -- The whole point: only the boat the offer is held for may take it.
  -- Free accept for advance — anyone eligible may take it.
  IF NOT v_advance AND v.held_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'this request is being offered to another boat right now';
  END IF;

  -- 071: one group per boat + route + sailing day/slot. The advisory
  -- lock makes two simultaneous accepts agree on the same group id.
  v_group_day := COALESCE(
    v.scheduled_date,
    (now() AT TIME ZONE 'Asia/Manila')::date
  );
  v_group_slot := CASE
    WHEN v_advance THEN COALESCE(v.scheduled_time, '')
    ELSE ''
  END;

  PERFORM pg_advisory_xact_lock(
    hashtext('booking_group'),
    hashtext(auth.uid()::text || '|' || v.route_id || '|' ||
             v_group_day::text || '|' || v_group_slot)
  );

  SELECT group_booking_id INTO v_group_id
  FROM bookings
  WHERE operator_id = auth.uid()
    AND route_id = v.route_id
    AND trip_stat = 'accepted'
    AND group_booking_id IS NOT NULL
    AND COALESCE(scheduled_date, (now() AT TIME ZONE 'Asia/Manila')::date) = v_group_day
    AND (NOT v_advance OR COALESCE(scheduled_time, '') = v_group_slot)
  ORDER BY accepted_at ASC NULLS LAST
  LIMIT 1;

  IF v_group_id IS NULL AND EXISTS (
    SELECT 1
    FROM bookings
    WHERE operator_id = auth.uid()
      AND route_id = v.route_id
      AND trip_stat = 'accepted'
      AND group_booking_id IS NULL
      AND COALESCE(scheduled_date, (now() AT TIME ZONE 'Asia/Manila')::date) = v_group_day
      AND (NOT v_advance OR COALESCE(scheduled_time, '') = v_group_slot)
  ) THEN
    v_group_id := gen_random_uuid();
    UPDATE bookings
    SET group_booking_id = v_group_id
    WHERE operator_id = auth.uid()
      AND route_id = v.route_id
      AND trip_stat = 'accepted'
      AND group_booking_id IS NULL
      AND COALESCE(scheduled_date, (now() AT TIME ZONE 'Asia/Manila')::date) = v_group_day
      AND (NOT v_advance OR COALESCE(scheduled_time, '') = v_group_slot);
  END IF;

  UPDATE bookings
  SET trip_stat = 'accepted',
      operator_id = auth.uid(),
      operator_name = p_operator_name,
      accepted_at = now(),
      held_by = NULL,
      hold_expires_at = NULL,
      group_booking_id = v_group_id
  WHERE id = p_booking_id
    AND trip_stat = 'open';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'taken by another bangkero';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION accept_booking_hold(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION accept_booking_hold(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION accept_booking_hold(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION accept_booking_hold(UUID, TEXT) TO service_role;

-- -------------------------------------------------------------
-- 5. resolve_batch_rpc (059 body + demotion instead of cancellation)
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

  -- 071: never cancel another sender's booking. The promoted master
  -- (v_batch_booking_id) is the accepted sailing; every other stub stays
  -- in the database but is demoted so no bangkero can accept it directly.
  -- getActiveBooking() + 062's passenger-slot trigger know how to ignore
  -- these consolidated members, so the sender can still book again.
  UPDATE public.bookings
  SET is_dispatchable = false,
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

NOTIFY pgrst, 'reload schema';

-- =============================================================
-- VERIFY after apply:
--   -- column + index
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'bookings' AND column_name = 'group_booking_id';
--   -- helper + trigger replacement
--   SELECT proname FROM pg_proc
--   WHERE proname IN ('is_consolidated_batch_member',
--                     'enforce_passenger_booking_slot',
--                     'accept_booking_hold',
--                     'resolve_batch_rpc');
--   -- grouped accepts share one id
--   SELECT group_booking_id, count(*), array_agg(ref)
--   FROM bookings
--   WHERE trip_stat = 'accepted' AND group_booking_id IS NOT NULL
--   GROUP BY 1 ORDER BY 2 DESC LIMIT 5;
-- =============================================================
