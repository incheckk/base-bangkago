-- =============================================================
-- 099 — RESUBMIT A REJECTED DOWNPAYMENT
--
-- 019 makes downpayments one row per booking and one per rental. 097
-- left a rejected row in place (correctly: the booking/rental stays
-- payable), but the passenger's "send a new receipt" then tried to
-- INSERT a second row and the unique index refused it — so no new
-- receipt ever reached the admin.
--
-- This widens attach_downpayment_proof() to reopen the rejected row:
-- same row, back to pending, new proof, reason cleared so the admin
-- reviews it again. The existing 097 path (a pending gateway row with
-- no receipt yet) is unchanged.
--
-- Run in the SQL editor AFTER 097.
-- =============================================================

BEGIN;

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
  IF COALESCE(btrim(p_proof), '') = '' THEN
    RAISE EXCEPTION 'attach the GCash receipt first';
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

  -- 097: a gateway checkout that died before any receipt existed.
  IF v.status = 'pending' AND COALESCE(v.proof_url, '') = '' THEN
    UPDATE public.downpayments
       SET reference_num = btrim(COALESCE(p_ref, '')),
           proof_url = p_proof,
           gateway_checkout_ref = NULL
     WHERE id = v.id;
    RETURN;
  END IF;

  -- 099: the admin rejected the old receipt. Reopen the same row so the
  -- passenger keeps ONE escrow row and the admin sees it again.
  IF v.status = 'rejected' THEN
    UPDATE public.downpayments
       SET status = 'pending',
           reference_num = btrim(COALESCE(p_ref, '')),
           proof_url = p_proof,
           reject_reason = NULL,
           reviewed_at = NULL,
           gateway_checkout_ref = NULL
     WHERE id = v.id;
    RETURN;
  END IF;

  RAISE EXCEPTION 'this downpayment already has a payment method on file';
END;
$$;

REVOKE ALL ON FUNCTION public.attach_downpayment_proof(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attach_downpayment_proof(UUID, TEXT, TEXT) TO authenticated;

COMMIT;
