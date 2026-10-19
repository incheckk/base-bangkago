-- =============================================================
-- 050. PARCEL OPTION B — dispatchable flag + carrier link + RLS
--
-- Why (from the 4.13 master recon):
--   Modes 2/3a/3b (piggyback / batched / solo) create a STUB cargo
--   booking at book time. That stub:
--     * pollutes bangkero Active Trips ("1 pax" cards),
--     * enters FCFS / holds / accept gates as a real trip,
--     * has operator_id = NULL so 005's bangkero parcel policy
--       returns 0 rows until someone accepts the stub,
--     * renders passenger-only UI (PASSENGER INFO, QR, no-show).
--   Mode 1 (accompanied) is unaffected — its booking IS the crossing.
--
-- Option B decisions (PM-locked 2026-10-17):
--   1. bookings.is_dispatchable — stubs start false; FCFS / holds /
--      accept skip them. Accompanied bookings stay true.
--   2. parcels.carrier_booking_id — the ONE sailing a parcel rides
--      on: piggyback → the passenger ride; batched → the batch
--      booking created at resolveBatchOutcome; solo → the booking
--      created by create_solo_sailing(). piggyback_booking_id (035)
--      stays for compatibility but is superseded by this column.
--   3. Batched parcels are visible to a bangkero ONLY after
--      batching_status = 'batched' (no pre-batch preview).
--   4. Solo mode: create_solo_sailing() flips the stub to
--      is_dispatchable = true — the bangkero then accepts it
--      through the NORMAL FCFS path (no auto-assign).
--
-- Run order: AFTER 049. Forward-only — never delete 002-049.
-- Safe to re-run (all ADDs are IF NOT EXISTS; backfills guarded).
--
-- Known follow-ups (NOT in this migration):
--   * resolveBatchOutcome (service stage) creates the batch booking
--     and writes carrier_booking_id on each batched parcel.
--   * approvePiggyback (service stage) writes carrier_booking_id
--     from the ride and stops setting batching_status='batched'.
--   * getParcelsForBangkero (service stage) unions booking_id,
--     carrier_booking_id and piggyback_booking_id lookups.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Schema: the flag + the carrier link
-- -------------------------------------------------------------
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS is_dispatchable BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.parcels
  ADD COLUMN IF NOT EXISTS carrier_booking_id UUID REFERENCES public.bookings(id);

COMMENT ON COLUMN public.bookings.is_dispatchable IS
  'Option B (050): false = parcel-mode stub (piggyback/batched/solo pre-sail) — invisible to FCFS holds and accept gates. Accompanied bookings stay true.';
COMMENT ON COLUMN public.parcels.carrier_booking_id IS
  'Option B (050): the booking whose sailing this parcel rides on. Piggyback = passenger ride; batched = batch booking (set at resolveBatchOutcome); solo = create_solo_sailing() booking. Supersedes piggyback_booking_id (035).';

-- -------------------------------------------------------------
-- 2. Partial index: open dispatchable bookings only (FCFS scan)
-- -------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_bookings_dispatchable_open
  ON public.bookings (route_id)
  WHERE is_dispatchable AND trip_stat = 'open';

-- -------------------------------------------------------------
-- 3. Backfill (idempotent)
-- -------------------------------------------------------------
-- 3a. Piggyback parcels: copy the existing FK into the carrier slot.
UPDATE public.parcels
   SET carrier_booking_id = piggyback_booking_id
 WHERE piggyback_booking_id IS NOT NULL
   AND carrier_booking_id IS NULL;

-- 3b. Mark NON-accompanied stubs non-dispatchable. Accompanied
--     bookings are the real crossing — they stay dispatchable.
UPDATE public.bookings b
   SET is_dispatchable = false
  FROM public.parcels p
 WHERE b.id = p.booking_id
   AND p.delivery_type IN ('piggyback', 'batched', 'solo')
   AND b.is_dispatchable = true;

-- -------------------------------------------------------------
-- 4. assign_next_hold — 020 body + is_dispatchable early-return.
--    A non-dispatchable booking never enters the hold cascade.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION assign_next_hold(p_booking_id UUID)
RETURNS VOID AS $$
DECLARE
  v bookings%ROWTYPE;
  v_route routes%ROWTYPE;
  v_port TEXT;
  v_dest TEXT;
  v_holder UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v FROM bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking not found';
  END IF;

  IF v.trip_stat <> 'open' THEN
    IF v.held_by IS NOT NULL OR v.hold_expires_at IS NOT NULL THEN
      UPDATE bookings SET held_by = NULL, hold_expires_at = NULL WHERE id = p_booking_id;
    END IF;
    RETURN;
  END IF;

  -- Option B (050): parcel-mode stubs are not dispatchable.
  IF NOT COALESCE(v.is_dispatchable, true) THEN
    IF v.held_by IS NOT NULL OR v.hold_expires_at IS NOT NULL THEN
      UPDATE bookings SET held_by = NULL, hold_expires_at = NULL WHERE id = p_booking_id;
    END IF;
    RETURN;
  END IF;

  -- Advance booking: free accept, no hold cascade.
  IF v.scheduled_date IS NOT NULL
     AND v.scheduled_date > (now() AT TIME ZONE 'Asia/Manila')::date THEN
    IF v.held_by IS NOT NULL OR v.hold_expires_at IS NOT NULL THEN
      UPDATE bookings SET held_by = NULL, hold_expires_at = NULL WHERE id = p_booking_id;
    END IF;
    RETURN;
  END IF;

  SELECT * INTO v_route FROM routes WHERE id = v.route_id;
  v_port := v_route.start_port_id;
  v_dest := v_route.end_port_id;

  -- A live holder that is still eligible — dispatch AND bangkero
  -- gates — keeps the offer. Losing the gate mid-hold (rating drop,
  -- verification revoked) releases it to the next boat.
  IF v.held_by IS NOT NULL
     AND v.hold_expires_at IS NOT NULL
     AND v.hold_expires_at > now()
     AND dispatch_eligible(v.held_by, v_port)
     AND gates_ok(v.held_by)
     AND NOT (COALESCE(v.rejected_by, '{}') @> ARRAY[v.held_by])
     AND route_ok(v.held_by, v_dest)
     AND fits_booking(v.held_by, v.service_type, v.num_of_passenger) THEN
    RETURN;
  END IF;

  -- Timed out: their turn is over. Mark it so the queue moves on
  -- permanently for this request (never bounces back to them).
  IF v.held_by IS NOT NULL AND v.hold_expires_at IS NOT NULL AND v.hold_expires_at <= now() THEN
    UPDATE bookings
    SET rejected_by = array_append(COALESCE(rejected_by, '{}'), v.held_by),
        held_by = NULL,
        hold_expires_at = NULL
    WHERE id = p_booking_id;
    v.rejected_by := COALESCE(v.rejected_by, '{}') || ARRAY[v.held_by];
    v.held_by := NULL;
    v.hold_expires_at := NULL;
  END IF;

  IF dev_dispatch_bypass() THEN
    -- Demo path: any online, gate-passing bangkero that has not
    -- passed on this request (queue/route/fit lifted by 009).
    SELECT b.id INTO v_holder
    FROM bangkeros b
    WHERE b.is_available
      AND gates_ok(b.id)
      AND NOT (COALESCE(v.rejected_by, '{}') @> ARRAY[b.id])
    ORDER BY b.id
    LIMIT 1;
  ELSE
    -- Next eligible boat, FCFS by the moment they entered the perimeter.
    SELECT pq.bangkero_id INTO v_holder
    FROM port_queue pq
    WHERE pq.port_id = v_port
      AND pq.left_at IS NULL
      AND pq.entered_at <= now() - INTERVAL '5 minutes'
      AND NOT (COALESCE(v.rejected_by, '{}') @> ARRAY[pq.bangkero_id])
      AND dispatch_eligible(pq.bangkero_id, v_port)
      AND gates_ok(pq.bangkero_id)
      AND route_ok(pq.bangkero_id, v_dest)
      AND fits_booking(pq.bangkero_id, v.service_type, v.num_of_passenger)
    ORDER BY pq.entered_at ASC
    LIMIT 1;
  END IF;

  IF v_holder IS NULL THEN
    IF v.held_by IS NOT NULL OR v.hold_expires_at IS NOT NULL THEN
      UPDATE bookings SET held_by = NULL, hold_expires_at = NULL WHERE id = p_booking_id;
    END IF;
  ELSIF v.held_by IS DISTINCT FROM v_holder
     OR v.hold_expires_at IS NULL
     OR v.hold_expires_at <= now() THEN
    UPDATE bookings
    SET held_by = v_holder, hold_expires_at = now() + INTERVAL '3 minutes'
    WHERE id = p_booking_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION assign_next_hold(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION assign_next_hold(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION assign_next_hold(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION assign_next_hold(UUID) TO service_role;

-- -------------------------------------------------------------
-- 5. accept_booking_hold — 020 body + is_dispatchable guard.
--    Defense-in-depth behind the app-level filter.
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

  UPDATE bookings
  SET trip_stat = 'accepted',
      operator_id = auth.uid(),
      operator_name = p_operator_name,
      accepted_at = now(),
      held_by = NULL,
      hold_expires_at = NULL
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
-- 6. create_solo_sailing — Option B Decision 4.
--    Sender (or the batch service on autoSolo) promotes a solo /
--    batched-fallback stub into a real, dispatchable cargo booking.
--    The bangkero then accepts it through the NORMAL FCFS path —
--    no auto-assign.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_solo_sailing(p_booking_id UUID)
RETURNS VOID AS $$
DECLARE
  v bookings%ROWTYPE;
  v_parcel parcels%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v FROM bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking not found';
  END IF;
  IF v.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'not your booking';
  END IF;
  IF v.trip_stat <> 'open' THEN
    RAISE EXCEPTION 'booking is no longer open';
  END IF;
  IF v.service_type <> 'cargo' THEN
    RAISE EXCEPTION 'solo sailing is cargo-only';
  END IF;
  IF COALESCE(v.is_dispatchable, true) THEN
    RAISE EXCEPTION 'booking is already dispatchable';
  END IF;

  SELECT * INTO v_parcel
  FROM parcels
  WHERE booking_id = p_booking_id
  ORDER BY created_at
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no parcel on this booking';
  END IF;
  IF v_parcel.delivery_type NOT IN ('solo', 'batched') THEN
    RAISE EXCEPTION 'solo sailing is for solo or batched-fallback parcels only';
  END IF;

  -- The stub becomes a real, dispatchable cargo sailing. The
  -- bangkero accepts it via the normal FCFS path; carrier link
  -- stays on parcels.booking_id (self) until the service layer
  -- rewrites it if needed.
  UPDATE bookings
  SET is_dispatchable = true,
      trip_stat = 'open',
      held_by = NULL,
      hold_expires_at = NULL
  WHERE id = p_booking_id
    AND trip_stat = 'open'
    AND NOT COALESCE(is_dispatchable, true);

  UPDATE parcels
  SET batching_status = 'solo',
      carrier_booking_id = p_booking_id
  WHERE id = v_parcel.id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION create_solo_sailing(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION create_solo_sailing(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION create_solo_sailing(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION create_solo_sailing(UUID) TO service_role;

-- -------------------------------------------------------------
-- 7. RLS — three additive policies on parcels.
--    005 (booking_id+operator) and 044 (piggyback_booking_id) stay;
--    carrier covers solo + future batched, batched adds the
--    Decision-1 visibility gate. Overlaps are harmless (USING OR).
-- -------------------------------------------------------------
DROP POLICY IF EXISTS "parcels_select_bangkero_carrier" ON public.parcels;
CREATE POLICY "parcels_select_bangkero_carrier" ON public.parcels
  FOR SELECT TO authenticated
  USING (
    carrier_booking_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = parcels.carrier_booking_id
        AND b.operator_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "parcels_select_bangkero_batched" ON public.parcels;
CREATE POLICY "parcels_select_bangkero_batched" ON public.parcels
  FOR SELECT TO authenticated
  USING (
    delivery_type = 'batched'
    AND batching_status = 'batched'
    AND carrier_booking_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = parcels.carrier_booking_id
        AND b.operator_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "parcels_update_bangkero_carrier" ON public.parcels;
CREATE POLICY "parcels_update_bangkero_carrier" ON public.parcels
  FOR UPDATE TO authenticated
  USING (
    carrier_booking_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = parcels.carrier_booking_id
        AND b.operator_id = auth.uid()
    )
  )
  WITH CHECK (
    carrier_booking_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = parcels.carrier_booking_id
        AND b.operator_id = auth.uid()
    )
  );

-- =============================================================
-- DOWN (commented — run manually if a rollback is ever needed).
-- Migrations are forward-only by project rule; this exists as a
-- reference, not as an automated path.
-- =============================================================
-- DROP POLICY IF EXISTS "parcels_update_bangkero_carrier" ON public.parcels;
-- DROP POLICY IF EXISTS "parcels_select_bangkero_batched" ON public.parcels;
-- DROP POLICY IF EXISTS "parcels_select_bangkero_carrier" ON public.parcels;
-- DROP INDEX IF EXISTS public.idx_bookings_dispatchable_open;
-- ALTER TABLE public.parcels DROP COLUMN IF EXISTS carrier_booking_id;
-- ALTER TABLE public.bookings DROP COLUMN IF EXISTS is_dispatchable;
-- -- RPC bodies revert to 020 by re-running migrations/020
-- -- (assign_next_hold + accept_booking_hold). create_solo_sailing
-- -- can be dropped: DROP FUNCTION IF EXISTS create_solo_sailing(uuid);
--
-- VERIFY after apply:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='bookings' AND column_name='is_dispatchable';
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='parcels' AND column_name='carrier_booking_id';
--   SELECT policyname FROM pg_policies
--    WHERE tablename='parcels' AND policyname LIKE '%carrier%';
--   SELECT proname FROM pg_proc WHERE proname='create_solo_sailing';
-- =============================================================