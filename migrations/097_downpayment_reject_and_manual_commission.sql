-- =============================================================
-- 097 — REJECT A DOWNPAYMENT HONESTLY + ONE COMMISSION RULE
--
-- 1. 'rejected' joins the downpayment states. Until now the only
--    negative action was "Mark as refunded", which (a) claimed a refund
--    of money that never arrived and (b) cancelled the booking through
--    review_advance_escrow. A rejected row keeps the booking pending so
--    the passenger can send a new receipt.
--
-- 2. attach_downpayment_proof() lets the owner finish a gateway row by
--    hand: the switch to GCash is chosen before a row exists, but a
--    checkout that fails after the insert must not strand the row.
--    It clears gateway_checkout_ref so a stale sandbox link can't also
--    confirm the same row.
--
-- 3. release_downpayment now deducts the same commission the gateway
--    rail deducts, so the manual and automatic payouts agree and
--    Earnings' "GROSS / RELEASED" copy stays true.
--
-- Run in the SQL editor AFTER 096.
-- =============================================================

BEGIN;

ALTER TABLE public.downpayments ADD COLUMN IF NOT EXISTS reject_reason TEXT;

ALTER TABLE public.downpayments DROP CONSTRAINT IF EXISTS downpayments_status_check;
ALTER TABLE public.downpayments ADD CONSTRAINT downpayments_status_check
  CHECK (status IN ('pending', 'approved', 'refunded', 'rejected'));

-- -------------------------------------------------------------
-- 1. Reject: no money arrived, booking stays payable.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_downpayment(
  p_downpayment_id UUID,
  p_reason TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v public.downpayments%ROWTYPE;
  v_user UUID;
  v_label TEXT;
  v_reason TEXT := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'admins only';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'give the passenger a reason';
  END IF;

  SELECT * INTO v FROM public.downpayments WHERE id = p_downpayment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'downpayment not found';
  END IF;
  IF v.status <> 'pending' THEN
    RAISE EXCEPTION 'only a pending downpayment can be rejected';
  END IF;

  UPDATE public.downpayments
     SET status = 'rejected',
         reviewed_at = now(),
         reject_reason = v_reason
   WHERE id = v.id;

  IF v.booking_id IS NOT NULL THEN
    SELECT b.user_id, b.ref INTO v_user, v_label
      FROM public.bookings b WHERE b.id = v.booking_id;
  ELSIF v.boat_rental_id IS NOT NULL THEN
    SELECT r.user_id, COALESCE(r.event_name, 'Boat rental') INTO v_user, v_label
      FROM public.boat_rentals r WHERE r.id = v.boat_rental_id;
  END IF;

  IF v_user IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, message, category)
    VALUES (
      v_user,
      'Downpayment rejected',
      'Your ₱' || trim(to_char(v.amount, 'FM999,999,990.00')) || ' downpayment for ' ||
        COALESCE(v_label, 'your booking') || ' was not accepted: ' || v_reason ||
        '. Send a new GCash receipt from the booking — Pay downpayment.',
      'payment'
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.reject_downpayment(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_downpayment(UUID, TEXT) TO authenticated;

-- -------------------------------------------------------------
-- 2. Owner finishes a gateway row with a manual receipt.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.attach_downpayment_proof(
  p_downpayment_id UUID,
  p_ref TEXT,
  p_proof TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v public.downpayments%ROWTYPE;
  v_mine BOOLEAN := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v FROM public.downpayments WHERE id = p_downpayment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'downpayment not found';
  END IF;

  IF v.booking_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = v.booking_id AND b.user_id = auth.uid()
    ) INTO v_mine;
  ELSIF v.boat_rental_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.boat_rentals r
      WHERE r.id = v.boat_rental_id AND r.user_id = auth.uid()
    ) INTO v_mine;
  END IF;

  IF NOT v_mine THEN
    RAISE EXCEPTION 'not your downpayment';
  END IF;
  IF v.status <> 'pending' OR COALESCE(v.proof_url, '') <> '' THEN
    RAISE EXCEPTION 'this downpayment already has a payment method on file';
  END IF;

  UPDATE public.downpayments
     SET reference_num = btrim(COALESCE(p_ref, '')),
         proof_url = p_proof,
         gateway_checkout_ref = NULL
   WHERE id = v.id;
END;
$$;

REVOKE ALL ON FUNCTION public.attach_downpayment_proof(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attach_downpayment_proof(UUID, TEXT, TEXT) TO authenticated;

-- -------------------------------------------------------------
-- 3. Manual release pays the same net as the gateway rail.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_downpayment(
  p_downpayment_id UUID,
  p_method TEXT,
  p_ref TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v public.downpayments%ROWTYPE;
  v_operator UUID;
  v_done BOOLEAN := false;
  v_qr TEXT;
  v_label TEXT;
  v_fare NUMERIC;
  v_rate NUMERIC;
  v_commission NUMERIC;
  v_net NUMERIC;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'admins only';
  END IF;
  IF p_method NOT IN ('gcash', 'cash') THEN
    RAISE EXCEPTION 'choose GCash or cash';
  END IF;

  SELECT * INTO v FROM public.downpayments WHERE id = p_downpayment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'downpayment not found';
  END IF;
  IF v.status <> 'approved' THEN
    RAISE EXCEPTION 'only an approved downpayment can be released';
  END IF;
  IF v.released_at IS NOT NULL THEN
    RAISE EXCEPTION 'this downpayment was already released';
  END IF;

  IF v.booking_id IS NOT NULL THEN
    SELECT b.operator_id, (b.trip_stat = 'completed'), b.ref, b.total_price
      INTO v_operator, v_done, v_label, v_fare
      FROM public.bookings b WHERE b.id = v.booking_id;
  ELSIF v.boat_rental_id IS NOT NULL THEN
    SELECT bk.bangkero_id, (r.status = 'completed'), COALESCE(r.event_name, 'Boat rental'), r.total_price
      INTO v_operator, v_done, v_label, v_fare
      FROM public.boat_rentals r
      JOIN public.bangkas bk ON bk.id = r.bangka_id
      WHERE r.id = v.boat_rental_id;
  END IF;

  IF v_operator IS NULL THEN
    RAISE EXCEPTION 'no operator on this booking';
  END IF;
  IF NOT v_done THEN
    RAISE EXCEPTION 'the trip must be completed before this downpayment is released';
  END IF;

  IF p_method = 'gcash' THEN
    SELECT gcash_qr_url INTO v_qr FROM public.bangkeros WHERE id = v_operator;
    IF v_qr IS NULL THEN
      RAISE EXCEPTION 'this bangkero has no GCash QR on file — release as cash instead';
    END IF;
  END IF;

  -- Same rule as claim_gateway_payouts (096): the fee is a share of the
  -- WHOLE fare and comes out of the downpayment.
  v_rate := COALESCE(
    (SELECT NULLIF(value, '')::numeric FROM public.app_settings WHERE key = 'commission_rate'),
    0.0700
  );
  v_commission := round(COALESCE(v_fare, v.amount * 2) * v_rate, 2);
  IF v_commission >= v.amount THEN
    RAISE EXCEPTION 'commission (%) leaves nothing to release on this row', v_commission;
  END IF;
  v_net := v.amount - v_commission;

  UPDATE public.downpayments
     SET released_at = now(),
         released_to = v_operator,
         payout_method = p_method,
         payout_ref = NULLIF(btrim(COALESCE(p_ref, '')), ''),
         commission_rate = v_rate,
         commission_amount = v_commission
   WHERE id = v.id;

  INSERT INTO public.notifications (user_id, title, message, category)
  VALUES (
    v_operator,
    'Downpayment released',
    '₱' || trim(to_char(v_net, 'FM999,999,990.00')) || ' for ' || v_label ||
      ' was released to you via ' ||
      CASE p_method WHEN 'gcash' THEN 'GCash' ELSE 'cash' END || '.',
    'payment'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.release_downpayment(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_downpayment(UUID, TEXT, TEXT) TO authenticated, service_role;

COMMIT;
