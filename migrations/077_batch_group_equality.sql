-- =============================================================
-- 077. BATCH GROUP EQUALITY
-- =============================================================
-- 071 promoted one stub into a master and left every other sender's
-- booking non-dispatchable with no group id. This migration makes all
-- live batch members share one group, gives each booking its own parcel
-- price, and fans acceptance out to the whole group once the FCFS lead
-- is accepted.
--
-- There is still one transient dispatch representative (the unique
-- batch_route_key holder); after acceptance every member is accepted,
-- owned by the same operator, and is_dispatchable = true.
--
-- Run order: AFTER 076. Safe to re-run.
-- =============================================================

BEGIN;

-- -------------------------------------------------------------
-- 1. resolve_batch_rpc: group everyone, price each booking from its
--    own parcel, keep only the lead in FCFS until acceptance.
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
  v_group_id UUID;
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
  SELECT id, group_booking_id
  INTO v_batch_booking_id, v_group_id
  FROM public.bookings
  WHERE batch_route_key = p_route_key
    AND trip_stat IN ('open', 'pending', 'accepted')
  LIMIT 1;

  -- One stable group id for the whole batch, including a legacy 071
  -- batch whose lead never received one.
  v_group_id := COALESCE(v_group_id, gen_random_uuid());

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

  -- Parcels still waiting (threshold) and the whole batch size.
  SELECT
    COUNT(*) FILTER (WHERE batching_status = 'pending_batch'),
    COUNT(*)
    INTO v_pending_count, v_batch_size
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
    -- stale date/time if the stub carried one. The lead is only the
    -- dispatch representative until a bangkero accepts the group.
    UPDATE public.bookings b
    SET batch_route_key = p_route_key,
        is_dispatchable = true,
        cargo_mode = 'batched',
        scheduled_date = NULL,
        scheduled_time = NULL,
        total_price = p.total_price,
        passenger_name = NULL,
        group_booking_id = v_group_id,
        held_by = NULL,
        hold_expires_at = NULL
    FROM public.parcels p
    WHERE b.id = v_stub_id
      AND p.booking_id = b.id
      AND b.batch_route_key IS NULL
    RETURNING b.id INTO v_batch_booking_id;

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

  -- Every booking owns exactly one parcel. Give every live batch booking
  -- the same group id and its own parcel price; never the batch sum.
  UPDATE public.bookings b
  SET total_price = p.total_price,
      passenger_name = NULL,
      cargo_mode = 'batched',
      group_booking_id = v_group_id
  FROM public.parcels p
  WHERE p.booking_id = b.id
    AND p.batching_route_key = p_route_key
    AND p.batching_status = 'batched'
    AND p.status = 'pending'
    AND b.trip_stat IN ('open', 'pending', 'accepted');

  -- The batch sails today, not on the route key's original crossing:
  -- drop the computed tomorrow departure/ETA so nothing renders a
  -- stale "08:00 tomorrow".
  UPDATE public.parcels
  SET scheduled_departure_at = NULL,
      estimated_arrival_at = NULL
  WHERE batching_route_key = p_route_key
    AND batching_status = 'batched';

  -- While the batch is unresolved, only the lead is a separate FCFS
  -- offer. Members keep the group id and stay out of the request list
  -- until accept fans acceptance out to all of them.
  UPDATE public.bookings b
  SET is_dispatchable = false,
      cargo_mode = 'batched',
      scheduled_date = NULL,
      scheduled_time = NULL,
      passenger_name = NULL,
      group_booking_id = v_group_id,
      held_by = NULL,
      hold_expires_at = NULL
  WHERE b.id IN (
    SELECT DISTINCT booking_id
    FROM public.parcels
    WHERE batching_route_key = p_route_key
      AND booking_id IS NOT NULL
      AND booking_id <> v_batch_booking_id
      AND status = 'pending'
      AND batching_status IN ('pending_batch', 'batched')
  )
    AND b.trip_stat IN ('open', 'pending')
    AND b.batch_route_key IS NULL;

  -- A late link after the lead was accepted must join the accepted
  -- group too; the lead's accept trigger already ran for earlier rows.
  UPDATE public.bookings b
  SET trip_stat = 'accepted',
      operator_id = lead.operator_id,
      operator_name = lead.operator_name,
      accepted_at = COALESCE(lead.accepted_at, now()),
      is_dispatchable = true,
      held_by = NULL,
      hold_expires_at = NULL,
      group_booking_id = v_group_id
  FROM public.bookings lead
  WHERE lead.id = v_batch_booking_id
    AND lead.trip_stat = 'accepted'
    AND lead.operator_id IS NOT NULL
    AND b.id <> lead.id
    AND b.batch_route_key IS NULL
    AND b.group_booking_id = v_group_id
    AND b.trip_stat IN ('open', 'pending')
    AND EXISTS (
      SELECT 1
      FROM public.parcels p
      WHERE p.booking_id = b.id
        AND p.batching_route_key = p_route_key
        AND p.batching_status = 'batched'
        AND p.status = 'pending'
    );

  RETURN v_batch_booking_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.resolve_batch_rpc(TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_batch_rpc(TEXT, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.resolve_batch_rpc(TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_batch_rpc(TEXT, INTEGER) TO service_role;

-- -------------------------------------------------------------
-- 2. Acceptance fan-out
-- -------------------------------------------------------------
-- accept_booking_hold's final update sets group_booking_id from its own
-- v_group_id, which is NULL when the operator has no other accepted
-- group. Preserve the resolve group before that update lands.
CREATE OR REPLACE FUNCTION public.preserve_batch_group_on_accept()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.trip_stat = 'accepted'
     AND NEW.batch_route_key IS NOT NULL
     AND NEW.group_booking_id IS NULL
     AND OLD.group_booking_id IS NOT NULL
  THEN
    NEW.group_booking_id := OLD.group_booking_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_batch_group_preserve ON public.bookings;
CREATE TRIGGER trg_batch_group_preserve
  BEFORE UPDATE OF trip_stat ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.preserve_batch_group_on_accept();

-- Once the lead is accepted, every live member of the same batch becomes
-- an equal accepted booking. OLD.group_booking_id is the resolve group;
-- NEW.group_booking_id is the final group (possibly merged with the
-- operator's existing same-day group).
CREATE OR REPLACE FUNCTION public.accept_batch_group_members()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.trip_stat <> 'accepted'
     OR NEW.batch_route_key IS NULL
     OR NEW.group_booking_id IS NULL
     OR OLD.group_booking_id IS NULL
     OR NEW.operator_id IS NULL
  THEN
    RETURN NEW;
  END IF;

  UPDATE public.bookings b
  SET trip_stat = 'accepted',
      operator_id = NEW.operator_id,
      operator_name = NEW.operator_name,
      accepted_at = COALESCE(NEW.accepted_at, now()),
      held_by = NULL,
      hold_expires_at = NULL,
      is_dispatchable = true,
      group_booking_id = NEW.group_booking_id
  WHERE b.group_booking_id = OLD.group_booking_id
    AND b.id <> NEW.id
    AND b.batch_route_key IS NULL
    AND b.trip_stat IN ('open', 'pending')
    AND EXISTS (
      SELECT 1
      FROM public.parcels p
      WHERE p.booking_id = b.id
        AND p.batching_route_key = NEW.batch_route_key
        AND p.batching_status = 'batched'
        AND p.status = 'pending'
    );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_batch_group_accept ON public.bookings;
CREATE TRIGGER trg_batch_group_accept
  AFTER UPDATE OF trip_stat ON public.bookings
  FOR EACH ROW
  WHEN (
    NEW.trip_stat = 'accepted'
    AND OLD.trip_stat IS DISTINCT FROM 'accepted'
    AND NEW.batch_route_key IS NOT NULL
  )
  EXECUTE FUNCTION public.accept_batch_group_members();

-- -------------------------------------------------------------
-- 3. mark_batch_parcel_paid: only verify the carrier, then settle the
--    parcel owner's payment row.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_batch_parcel_paid(p_parcel_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parcel public.parcels%ROWTYPE;
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

  IF NOT EXISTS (
    SELECT 1
    FROM public.bookings carrier
    WHERE carrier.id = v_parcel.carrier_booking_id
      AND carrier.trip_stat = 'accepted'
      AND carrier.operator_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'this trip changed';
  END IF;

  UPDATE public.payments
  SET payment_status = 'completed'
  WHERE booking_id = v_parcel.booking_id;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_batch_parcel_paid(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_batch_parcel_paid(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_batch_parcel_paid(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_batch_parcel_paid(UUID) TO service_role;

DROP POLICY IF EXISTS "payments_select_operator_batch_member" ON public.payments;
CREATE POLICY "payments_select_operator_batch_member" ON public.payments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.parcels p
      JOIN public.bookings carrier ON carrier.id = p.carrier_booking_id
      WHERE p.booking_id = payments.booking_id
        AND p.delivery_type = 'batched'
        AND carrier.trip_stat = 'accepted'
        AND carrier.operator_id = auth.uid()
    )
  );

-- -------------------------------------------------------------
-- 4. Repair existing batches
-- -------------------------------------------------------------
-- 071 batches have a lead but their members often have no group id.
-- Give each live lead a stable group id first.
UPDATE public.bookings lead
SET group_booking_id = gen_random_uuid()
WHERE lead.batch_route_key IS NOT NULL
  AND lead.trip_stat IN ('open', 'pending', 'accepted')
  AND lead.group_booking_id IS NULL;

-- Join every live batched booking to its lead's group and reprice it from
-- its own parcel. This also removes any batch-sum price left by 071.
UPDATE public.bookings b
SET group_booking_id = lead.group_booking_id,
    cargo_mode = 'batched',
    total_price = p.total_price,
    passenger_name = NULL
FROM public.bookings lead
JOIN (
  SELECT DISTINCT ON (p.booking_id)
    p.booking_id,
    p.batching_route_key,
    p.total_price
  FROM public.parcels p
  WHERE p.booking_id IS NOT NULL
    AND p.status = 'pending'
    AND p.batching_status = 'batched'
  ORDER BY p.booking_id, p.created_at DESC
) p ON p.batching_route_key = lead.batch_route_key
WHERE lead.batch_route_key IS NOT NULL
  AND lead.trip_stat IN ('open', 'pending', 'accepted')
  AND lead.group_booking_id IS NOT NULL
  AND p.booking_id = b.id
  AND b.trip_stat IN ('open', 'pending', 'accepted');

-- If the lead is already accepted, every live member must be accepted too.
UPDATE public.bookings b
SET trip_stat = 'accepted',
    operator_id = lead.operator_id,
    operator_name = lead.operator_name,
    accepted_at = COALESCE(lead.accepted_at, now()),
    held_by = NULL,
    hold_expires_at = NULL,
    is_dispatchable = true,
    group_booking_id = lead.group_booking_id
FROM public.bookings lead
JOIN (
  SELECT DISTINCT p.booking_id, p.batching_route_key
  FROM public.parcels p
  WHERE p.booking_id IS NOT NULL
    AND p.status = 'pending'
    AND p.batching_status = 'batched'
) p ON p.batching_route_key = lead.batch_route_key
WHERE lead.batch_route_key IS NOT NULL
  AND lead.trip_stat = 'accepted'
  AND lead.operator_id IS NOT NULL
  AND lead.group_booking_id IS NOT NULL
  AND p.booking_id = b.id
  AND b.id <> lead.id
  AND b.trip_stat IN ('open', 'pending');

-- Unresolved batches keep exactly one FCFS offer.
UPDATE public.bookings b
SET is_dispatchable = false,
    held_by = NULL,
    hold_expires_at = NULL
FROM public.bookings lead
JOIN (
  SELECT DISTINCT p.booking_id, p.batching_route_key
  FROM public.parcels p
  WHERE p.booking_id IS NOT NULL
    AND p.status = 'pending'
    AND p.batching_status = 'batched'
) p ON p.batching_route_key = lead.batch_route_key
WHERE lead.batch_route_key IS NOT NULL
  AND lead.trip_stat IN ('open', 'pending')
  AND lead.group_booking_id IS NOT NULL
  AND p.booking_id = b.id
  AND b.id <> lead.id
  AND b.batch_route_key IS NULL
  AND b.trip_stat IN ('open', 'pending');

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =============================================================
-- VERIFY after apply:
--   -- one group per live batch, all rows equal
--   SELECT b.batch_route_key, b.group_booking_id, b.trip_stat,
--          b.operator_id, b.is_dispatchable, count(*)
--   FROM public.bookings b
--   WHERE b.group_booking_id IN (
--     SELECT group_booking_id FROM public.bookings
--     WHERE batch_route_key IS NOT NULL AND group_booking_id IS NOT NULL
--   )
--   GROUP BY 1,2,3,4,5 ORDER BY 1;
--   -- after a bangkero accepts the lead, all members must match
--   -- every batched payment can now be settled, including the lead's
--   SELECT public.mark_batch_parcel_paid('<parcel id>');
-- =============================================================
