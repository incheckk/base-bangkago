-- =============================================================
-- 100 — DISPATCH HOLD ROTATION
--
-- One column fixes three demo bugs that all came from using
-- `rejected_by` for two different things:
--
--   * an EXPIRED 3-minute hold was appended to `rejected_by` — the same
--     list an explicit DECLINE writes to. `useOpenRequests` hides any
--     booking whose rejected_by contains the caller, so a boat that simply
--     let its offer lapse stopped seeing the request at all ("Pedro and
--     Mang Lito see no bookings while Zandro does").
--   * `accept_booking_hold` (008) refuses a bangkero in rejected_by, so
--     that boat could not take the trip later either.
--   * FCFS then skipped every former holder, so the pick could jump past
--     queue positions 1 and 2 to whoever was never offered it.
--
-- After 100 `rejected_by` means exactly one thing: an explicit decline.
-- Rotation uses `last_held_by` — the previous holder sorts LAST in the
-- next pick (not out of it), so the queue round-robins and a lone boat
-- still gets re-offered its own request instead of orphaning it.
--
-- Run in the SQL editor AFTER 099.
-- =============================================================

BEGIN;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS last_held_by UUID;

COMMENT ON COLUMN public.bookings.last_held_by IS
  'Previous hold holder. Sorts them last on the next dispatch pick; never excludes them.';

-- One-time repair. Every open, dispatchable request on file was written
-- under the old append-on-expiry rule, and an expiry entry cannot be told
-- apart from a real decline afterwards. Clearing the list is the only way
-- to un-stick the demo. A bangkero may therefore be offered a request they
-- declined before this migration ran; they can decline it again.
UPDATE public.bookings
SET rejected_by = '{}'
WHERE trip_stat = 'open'
  AND COALESCE(is_dispatchable, true)
  AND rejected_by IS NOT NULL
  AND rejected_by <> '{}';

-- -------------------------------------------------------------
-- assign_next_hold — 098's body, with the rotation change:
--   * expiry clears the hold and records `last_held_by` instead of
--     appending to `rejected_by`
--   * both holder picks sort the previous holder last
-- Everything else (advance-trip early return, gates, route, capacity,
-- at-sea, explicit declines, bypass branch) is untouched.
-- -------------------------------------------------------------
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
  IF auth.uid() IS NULL THEN
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
--   -- column present, and the old pollution is gone
--   SELECT count(*) FILTER (WHERE last_held_by IS NOT NULL) AS rotated,
--          count(*) FILTER (WHERE rejected_by <> '{}')     AS explicit_declines
--   FROM bookings WHERE trip_stat = 'open';
--
--   -- let one offer lapse, then refresh and read the rotation
--   SELECT id, held_by, last_held_by, hold_expires_at, rejected_by
--   FROM bookings WHERE trip_stat = 'open' ORDER BY created_at DESC LIMIT 5;
--
-- Expected: after an expiry, `last_held_by` = the boat that just held it,
-- `rejected_by` still '{}' unless the bangkero actually tapped Decline,
-- and the next holder is the earliest queue entry that is NOT that boat.
--
-- Smoke: park two boats at the same port, order three same-day requests,
-- and let one offer lapse. The lapsed boat must keep seeing the request
-- (it is no longer filtered out) and the offers must alternate between
-- the two boats instead of stacking on one.
-- =============================================================
