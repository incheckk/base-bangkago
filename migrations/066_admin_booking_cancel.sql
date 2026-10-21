-- =============================================================
-- 066 — Admin cancellation for bookings
--
-- The web admin console lets an admin cancel a trip. Until now
-- bookings had no admin UPDATE policy, so the page's status/cancel
-- buttons updated 0 rows while reporting success. A direct RLS
-- grant is not enough: cancellation must stamp the lifecycle,
-- refuse departed/boarded trips, and keep escrow records honest.
--
-- Rules:
--   * admin only;
--   * pending / open / accepted only;
--   * not after departure or boarding;
--   * no pending/approved downpayment (refund it first);
--   * notify the passenger (best effort).
--
-- Run in the SQL editor after 065.
-- =============================================================

CREATE OR REPLACE FUNCTION public.admin_cancel_booking(
  p_booking_id uuid,
  p_reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v public.bookings%ROWTYPE;
  v_reason text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT * INTO v
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking not found';
  END IF;

  IF v.trip_stat NOT IN ('pending', 'open', 'accepted') THEN
    RAISE EXCEPTION 'this booking is already %', v.trip_stat;
  END IF;

  IF v.depart_time IS NOT NULL THEN
    RAISE EXCEPTION 'the boat has already departed — this trip can no longer be cancelled';
  END IF;

  IF v.onboarded_at IS NOT NULL THEN
    RAISE EXCEPTION 'boarding has already started — this trip can no longer be cancelled';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.downpayments d
    WHERE d.booking_id = v.id
      AND d.status IN ('pending', 'approved')
  ) THEN
    RAISE EXCEPTION 'this booking holds a GCash downpayment — refund it on Downpayments first';
  END IF;

  v_reason := COALESCE(NULLIF(btrim(p_reason), ''), 'Cancelled by admin');

  UPDATE public.bookings
  SET trip_stat = 'cancelled',
      cancelled_at = now(),
      cancel_reason = v_reason,
      held_by = NULL,
      hold_expires_at = NULL
  WHERE id = v.id;

  -- The bell is a courtesy; a notification failure must never undo the
  -- cancellation or block the admin.
  BEGIN
    INSERT INTO public.notifications (user_id, title, message)
    VALUES (
      v.user_id,
      'Booking cancelled',
      'Booking ' || v.ref || ' was cancelled by the admin. Reason: ' || v_reason || '.'
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_cancel_booking(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_cancel_booking(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_cancel_booking(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cancel_booking(uuid, text) TO service_role;

-- Verification (run manually after applying):
--   SELECT proname, prosecdef
--   FROM pg_proc WHERE proname = 'admin_cancel_booking';
--   -- As an admin (NOT the SQL editor / service role):
--   SELECT public.admin_cancel_booking('<open booking id>', 'Venue test');
