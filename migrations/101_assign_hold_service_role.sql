-- =============================================================
-- 101 — DISPATCH HOLDS FOR THE GATEWAY (service role)
--
-- The checkout path calls confirm_gateway_downpayment() (096), which flips
-- a pending booking to 'open' and then PERFORM assign_next_hold(...). The
-- gateway runs as the service role, so auth.uid() is NULL — and
-- assign_next_hold (100) opens with
--
--   IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
--
-- The grant on 100 says service_role may call it; the guard says it may
-- not. So EVERY authorize (sandbox and the live webhook) rolled the whole
-- confirm back, and the app showed
--   "Online checkout failed: not authenticated."
-- with the downpayment still pending. That is the only bug here: the
-- function never got past line 2.
--
-- Fix: let the service role through the guard. 100's body verbatim, one
-- line different. Nothing else is touched.
--
-- Run in the SQL editor AFTER 100.
-- =============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.assign_next_hold(p_booking_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v public.bookings%ROWTYPE;
  v_route public.routes%ROWTYPE;
  v_port TEXT;
  v_dest TEXT;
  v_holder UUID;
BEGIN
  -- The gateway (096 confirm, live webhook) has no JWT: its claim is
  -- service_role, not a user. Every person-call still needs a user.
  IF auth.uid() IS NULL AND COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'booking not found'; END IF;

  IF v.trip_stat <> 'open' OR NOT COALESCE(v.is_dispatchable, true)
     OR (v.scheduled_date IS NOT NULL
         AND v.scheduled_date > (now() AT TIME ZONE 'Asia/Manila')::DATE) THEN
    UPDATE public.bookings SET held_by = NULL, hold_expires_at = NULL
    WHERE id = p_booking_id AND (held_by IS NOT NULL OR hold_expires_at IS NOT NULL);
    RETURN;
  END IF;

  SELECT * INTO v_route FROM public.routes WHERE id = v.route_id;
  v_port := v_route.start_port_id;
  v_dest := v_route.end_port_id;

  IF v.held_by IS NOT NULL AND v.hold_expires_at > now()
     AND dispatch_eligible(v.held_by, v_port)
     AND gates_ok(v.held_by)
     AND NOT bangkero_at_sea(v.held_by)
     AND NOT (COALESCE(v.rejected_by, '{}') @> ARRAY[v.held_by])
     AND route_ok(v.held_by, v_dest)
     AND fits_booking(v.held_by, v.service_type, v.num_of_passenger) THEN
    RETURN;
  END IF;

  -- The offer lapsed: free it and remember who had it. NOT a decline.
  IF v.held_by IS NOT NULL AND v.hold_expires_at <= now() THEN
    UPDATE public.bookings
    SET last_held_by = v.held_by,
        held_by = NULL, hold_expires_at = NULL
    WHERE id = p_booking_id;
    v.last_held_by := v.held_by;
    v.held_by := NULL;
    v.hold_expires_at := NULL;
  END IF;

  IF dev_dispatch_bypass() THEN
    SELECT b.id INTO v_holder
    FROM public.bangkeros b
    WHERE b.is_available
      AND gates_ok(b.id)
      AND NOT bangkero_at_sea(b.id)
      AND NOT (COALESCE(v.rejected_by, '{}') @> ARRAY[b.id])
    ORDER BY COALESCE(b.id = v.last_held_by, false), b.id LIMIT 1;
  ELSE
    SELECT pq.bangkero_id INTO v_holder
    FROM public.port_queue pq
    WHERE pq.port_id = v_port
      AND pq.left_at IS NULL
      AND pq.entered_at <= now() - INTERVAL '5 minutes'
      AND NOT (COALESCE(v.rejected_by, '{}') @> ARRAY[pq.bangkero_id])
      AND dispatch_eligible(pq.bangkero_id, v_port)
      AND gates_ok(pq.bangkero_id)
      AND NOT bangkero_at_sea(pq.bangkero_id)
      AND route_ok(pq.bangkero_id, v_dest)
      AND fits_booking(pq.bangkero_id, v.service_type, v.num_of_passenger)
    ORDER BY COALESCE(pq.bangkero_id = v.last_held_by, false), pq.entered_at ASC LIMIT 1;
  END IF;

  IF v_holder IS NULL THEN
    UPDATE public.bookings SET held_by = NULL, hold_expires_at = NULL
    WHERE id = p_booking_id AND (held_by IS NOT NULL OR hold_expires_at IS NOT NULL);
  ELSIF v.held_by IS DISTINCT FROM v_holder
     OR v.hold_expires_at IS NULL OR v.hold_expires_at <= now() THEN
    UPDATE public.bookings
    SET held_by = v_holder, hold_expires_at = now() + INTERVAL '3 minutes'
    WHERE id = p_booking_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.assign_next_hold(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_next_hold(UUID) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- =============================================================
-- VERIFY AFTER RUNNING
--
--   -- 1. In the app: Pay downpayment -> Authorize. The downpayment must
--   --    flip to approved, the booking to open, and (with a boat queued
--   --    at the departure port) the request must get a hold.
--   --    This is the real check — the gateway is the caller that needed
--   --    through, so only it can prove it.
--
--   -- 2. Rows behind it:
--   SELECT status, reviewed_at, gateway_checkout_ref
--     FROM public.downpayments ORDER BY created_at DESC LIMIT 3;
--   SELECT ref, trip_stat, held_by, hold_expires_at
--     FROM public.bookings ORDER BY created_at DESC LIMIT 3;
--
-- The SQL editor has no JWT either, so calling assign_next_hold there
-- still answers 'not authenticated' — same rule as before this migration.
-- Only the service role (the gateway) is let through, not "anyone".
-- =============================================================
