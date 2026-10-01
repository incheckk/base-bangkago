-- =============================================================
-- 020 — ADVANCE BOOKINGS, ESCROW GATE, PER-PASSENGER QR BOARDING
--
-- Rules this migration encodes:
--   * Every booking/rental may carry a schedule. Future-dated work
--     ("advance") requires a 50% GCash escrow approved by the admin
--     BEFORE any bangkero can see it: bookings sit in trip_stat
--     'pending', rentals in status 'awaiting_payment'. Same-day work
--     keeps today's flow (open immediately, pay onboard).
--   * Free accept for advance bookings: port queue, 5-min dwell,
--     FCFS holds and the fresh-GPS fix are lifted while the sailing
--     date is still in the future (ponytail: if the prof wants the
--     full dispatch gates back on day-of, they already apply again
--     once scheduled_date arrives — drop v_advance below).
--   * Each passenger gets a qr_token; the bangkero scans one QR per
--     person (or ticks manually) and Start Trip stays locked until
--     every row is resolved.
--
-- Run in Supabase SQL Editor AFTER 019. Idempotent: safe to re-run.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Schedule columns + extended states.
-- -------------------------------------------------------------
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS scheduled_date DATE;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS scheduled_time TEXT;
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_scheduled_time_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_scheduled_time_check
  CHECK (scheduled_time IS NULL
         OR scheduled_time IN ('07:00', '10:00', '13:00', '17:00'));

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_trip_stat_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_trip_stat_check
  CHECK (trip_stat IN ('open', 'accepted', 'completed', 'cancelled', 'pending'));

ALTER TABLE boat_rentals DROP CONSTRAINT IF EXISTS boat_rentals_status_check;
ALTER TABLE boat_rentals ADD CONSTRAINT boat_rentals_status_check
  CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled',
                    'awaiting_payment'));

-- Awaiting-payment charters still hold the boat's day.
DROP INDEX IF EXISTS boat_rentals_one_live_per_day;
CREATE UNIQUE INDEX boat_rentals_one_live_per_day
  ON boat_rentals (bangka_id, rental_date)
  WHERE status IN ('pending', 'confirmed', 'awaiting_payment');

-- -------------------------------------------------------------
-- 2. Per-passenger QR tokens + checklist columns.
-- -------------------------------------------------------------
ALTER TABLE passenger_details ADD COLUMN IF NOT EXISTS qr_token TEXT;
ALTER TABLE passenger_details ALTER COLUMN qr_token
  SET DEFAULT md5(gen_random_uuid()::text);
UPDATE passenger_details SET qr_token = md5(gen_random_uuid()::text)
WHERE qr_token IS NULL;
ALTER TABLE passenger_details ALTER COLUMN qr_token SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS passenger_details_qr_token_key
  ON passenger_details (qr_token);
ALTER TABLE passenger_details ADD COLUMN IF NOT EXISTS boarded_at TIMESTAMPTZ;
ALTER TABLE passenger_details ADD COLUMN IF NOT EXISTS no_show_at TIMESTAMPTZ;

-- -------------------------------------------------------------
-- 3. assign_next_hold — 019 body verbatim + advance early-return.
--    Future-dated bookings never take a hold, so the queue can't
--    start rejecting boats days before the trip.
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
-- 4. accept_booking_hold — 010 body + v_advance branches. Gates
--    (registered/online/docs/rating), capacity and rejected_by stay
--    ON for advance; queue, dwell, hold ownership, GPS fix and
--    route_ok lift until the sailing date arrives.
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
-- 4b. cancel_own_booking — 007 body + 'pending': a passenger may
--     back out of an advance booking that is still waiting on the
--     escrow review (admin refunds the downpayment separately).
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION cancel_own_booking(p_booking_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS VOID AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  UPDATE bookings
  SET trip_stat = 'cancelled',
      cancelled_at = now(),
      cancel_reason = p_reason
  WHERE id = p_booking_id
    AND user_id = auth.uid()
    AND trip_stat IN ('open', 'accepted', 'pending');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'this booking was already cancelled or has changed';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION cancel_own_booking(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION cancel_own_booking(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION cancel_own_booking(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION cancel_own_booking(UUID, TEXT) TO service_role;

-- -------------------------------------------------------------
-- 5. Admin flips the escrow gate. approve: pending → open (booking
--    re-enters dispatch), awaiting_payment → pending (rental hits
--    the bangkero's desk). reject: the still-unopened row cancels.
--    Returns TRUE when a row actually changed (notification gate).
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.review_advance_escrow(
  p_booking_id uuid, p_rental_id uuid, p_approve boolean
) RETURNS boolean AS $$
DECLARE
  v_changed boolean := false;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF p_booking_id IS NULL AND p_rental_id IS NULL THEN
    RAISE EXCEPTION 'nothing to review';
  END IF;

  IF p_booking_id IS NOT NULL THEN
    IF p_approve THEN
      UPDATE public.bookings SET trip_stat = 'open'
      WHERE id = p_booking_id AND trip_stat = 'pending';
      v_changed := FOUND;
      IF v_changed THEN
        PERFORM public.assign_next_hold(p_booking_id);
      END IF;
    ELSE
      UPDATE public.bookings
      SET trip_stat = 'cancelled',
          cancelled_at = now(),
          cancel_reason = 'Escrow downpayment refunded by admin.'
      WHERE id = p_booking_id AND trip_stat = 'pending';
      v_changed := FOUND;
    END IF;
  ELSE
    IF p_approve THEN
      UPDATE public.boat_rentals SET status = 'pending'
      WHERE id = p_rental_id AND status = 'awaiting_payment';
    ELSE
      UPDATE public.boat_rentals SET status = 'cancelled'
      WHERE id = p_rental_id AND status = 'awaiting_payment';
    END IF;
    v_changed := FOUND;
  END IF;

  RETURN v_changed;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE EXECUTE ON FUNCTION public.review_advance_escrow(uuid, uuid, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.review_advance_escrow(uuid, uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.review_advance_escrow(uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_advance_escrow(uuid, uuid, boolean) TO service_role;

-- -------------------------------------------------------------
-- 6. Scan one passenger's QR. Companion payload: 'PAX' + qr_token.
--    Booker payload: the booking ref (BGO-XXXXXX). Both must be on
--    a trip this caller operates right now. Returns the name to
--    toast; raises when the code belongs to someone else's trip.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_boarding_qr(p_token text)
RETURNS text AS $$
DECLARE
  v_detail_id uuid;
  v_name text;
  v_lookup text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  v_lookup := CASE WHEN p_token LIKE 'PAX%' THEN substr(p_token, 4) ELSE p_token END;

  SELECT pd.id, pd.first_name || ' ' || pd.last_name
    INTO v_detail_id, v_name
  FROM public.passenger_details pd
  JOIN public.bookings b ON b.id = pd.booking_id
  WHERE pd.qr_token = v_lookup
    AND b.trip_stat = 'accepted'
    AND b.operator_id = auth.uid();
  IF v_detail_id IS NOT NULL THEN
    UPDATE public.passenger_details
    SET boarded_at = now(), no_show_at = NULL
    WHERE id = v_detail_id;
    RETURN v_name;
  END IF;

  SELECT b.id, b.passenger_name
    INTO v_detail_id, v_name
  FROM public.bookings b
  WHERE b.ref = upper(v_lookup)
    AND b.trip_stat = 'accepted'
    AND b.operator_id = auth.uid();
  IF v_detail_id IS NOT NULL THEN
    UPDATE public.bookings SET onboarded_at = now() WHERE id = v_detail_id;
    RETURN COALESCE(v_name, 'Booker');
  END IF;

  RAISE EXCEPTION 'that QR code does not belong to this trip';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE EXECUTE ON FUNCTION public.verify_boarding_qr(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.verify_boarding_qr(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.verify_boarding_qr(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_boarding_qr(text) TO service_role;

-- -------------------------------------------------------------
-- 7. Manual checklist tick for one companion row. 'pending' clears
--    both markers (undo).
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_passenger_boarded(
  p_detail_id uuid, p_state text
) RETURNS void AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_state NOT IN ('boarded', 'not_boarded', 'pending') THEN
    RAISE EXCEPTION 'bad state';
  END IF;
  UPDATE public.passenger_details pd
  SET boarded_at = CASE WHEN p_state = 'boarded' THEN now() END,
      no_show_at = CASE WHEN p_state = 'not_boarded' THEN now() END
  FROM public.bookings b
  WHERE b.id = pd.booking_id
    AND pd.id = p_detail_id
    AND b.trip_stat = 'accepted'
    AND b.operator_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'this trip changed';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE EXECUTE ON FUNCTION public.set_passenger_boarded(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_passenger_boarded(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_passenger_boarded(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_passenger_boarded(uuid, text) TO service_role;

-- =============================================================
-- VERIFY:
--   SELECT conname FROM pg_constraint
--    WHERE conrelid = 'bookings'::regclass AND contype = 'c';
--     -- bookings_trip_stat_check (…'pending'), bookings_scheduled_time_check
--   SELECT conname FROM pg_constraint
--    WHERE conrelid = 'boat_rentals'::regclass AND contype = 'c';
--     -- boat_rentals_status_check (…'awaiting_payment')
--   SELECT indexname FROM pg_indexes WHERE tablename = 'passenger_details';
--     -- passenger_details_qr_token_key
--   SELECT p.proname, p.prosecdef, p.proacl FROM pg_proc p
--    WHERE p.proname IN ('review_advance_escrow','verify_boarding_qr',
--                        'set_passenger_boarded','accept_booking_hold',
--                        'assign_next_hold');
--     -- all prosecdef = t, proacl without =X/anonymous
--   -- Then: admin approves an escrow row → booking goes open,
--   --   bangkero card appears; scan a companion QR → tick + name.
-- =============================================================
