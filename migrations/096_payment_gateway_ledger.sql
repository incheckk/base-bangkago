-- 096 — the payment gateway ledger.
--
-- The loop this supports: passenger pays the downpayment on a hosted
-- checkout page -> the provider's webhook confirms it (no admin click) ->
-- the trip completes -> the downpayment minus commission is paid out to the
-- bangkero's GCash account. Collections settle into BangkaGo's own balance,
-- so "escrow" is this ledger until payout — the copy says "held by BangkaGo".
--
-- SHIPS MANUAL: dev_flags.manual_payments defaults to true, so nothing
-- changes until an admin flips the switch in Developer Options. Every
-- failure path leaves the existing manual flow (079 release_downpayment,
-- receipt upload) intact.
--
-- SHIPS SANDBOX: the provider side is our own signed sandbox page until
-- PayMongo sign-ups reopen. The provider contract is the same either way,
-- so the swap is a key + a base URL, not a schema change.

-- =============================================================
-- 1. Provider + payout columns on the money row
-- =============================================================
ALTER TABLE downpayments ADD COLUMN IF NOT EXISTS gateway_checkout_ref TEXT;
ALTER TABLE downpayments ADD COLUMN IF NOT EXISTS gateway_payout_ref TEXT;
ALTER TABLE downpayments ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(5,4);
ALTER TABLE downpayments ADD COLUMN IF NOT EXISTS commission_amount NUMERIC(10,2);
ALTER TABLE downpayments ADD COLUMN IF NOT EXISTS payout_status TEXT;
ALTER TABLE downpayments ADD COLUMN IF NOT EXISTS payout_error TEXT;
-- When the edge function claimed the row. A crash between the provider call
-- and the write-back would otherwise strand the row in 'processing' forever;
-- the claim picks a processing row up again after 10 minutes.
ALTER TABLE downpayments ADD COLUMN IF NOT EXISTS payout_claimed_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'downpayments_payout_status_check'
  ) THEN
    ALTER TABLE downpayments ADD CONSTRAINT downpayments_payout_status_check
      CHECK (payout_status IS NULL OR payout_status IN ('queued', 'processing', 'paid', 'failed'));
  END IF;
END $$;

-- A checkout session confirms exactly one downpayment.
CREATE UNIQUE INDEX IF NOT EXISTS downpayments_gateway_checkout_ref_key
  ON downpayments (gateway_checkout_ref)
  WHERE gateway_checkout_ref IS NOT NULL;

-- =============================================================
-- 2. Commission rate + webhook idempotency + the kill switch
-- =============================================================
INSERT INTO app_settings (key, value)
VALUES ('commission_rate', '0.0700')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION set_commission_rate(p_rate NUMERIC)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'admins only';
  END IF;
  -- The product range is 5%–9% of the whole fare.
  IF p_rate IS NULL OR p_rate < 0.05 OR p_rate > 0.09 THEN
    RAISE EXCEPTION 'commission must be between 5%% and 9%%';
  END IF;
  INSERT INTO app_settings (key, value)
  VALUES ('commission_rate', to_char(p_rate, 'FM0.0000'))
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION set_commission_rate(NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_commission_rate(NUMERIC) TO authenticated;

-- Provider events are only ever written by the service role; RLS with no
-- policy keeps them out of every client, including admins.
CREATE TABLE IF NOT EXISTS gateway_events (
  event_id TEXT PRIMARY KEY,
  kind TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE gateway_events ENABLE ROW LEVEL SECURITY;

-- ON = the manual receipt flow (today's behaviour). The app shows the
-- gateway button only while this is OFF.
ALTER TABLE dev_flags ADD COLUMN IF NOT EXISTS manual_payments BOOLEAN NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION set_manual_payments(p_on BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'admins only';
  END IF;
  UPDATE dev_flags SET manual_payments = p_on WHERE id = 1;
END;
$$;

REVOKE ALL ON FUNCTION set_manual_payments(BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_manual_payments(BOOLEAN) TO authenticated;

-- =============================================================
-- 3. Confirm a checkout — replaces the admin approval in the happy path
-- =============================================================
CREATE OR REPLACE FUNCTION confirm_gateway_downpayment(
  p_checkout_ref TEXT,
  p_provider_ref TEXT,
  p_paid_amount NUMERIC DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v downpayments%ROWTYPE;
  v_label TEXT;
  v_user UUID;
BEGIN
  SELECT * INTO v FROM downpayments
   WHERE gateway_checkout_ref = p_checkout_ref
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown checkout reference';
  END IF;

  IF p_paid_amount IS NOT NULL AND abs(p_paid_amount - v.amount) > 0.01 THEN
    RAISE EXCEPTION 'paid amount % does not match the recorded downpayment %',
      p_paid_amount, v.amount;
  END IF;

  -- Webhook replays are a no-op, not an error.
  IF v.status = 'approved' THEN
    RETURN v.id;
  END IF;
  IF v.status <> 'pending' THEN
    RAISE EXCEPTION 'this downpayment is %', v.status;
  END IF;

  UPDATE downpayments
     SET status = 'approved',
         reviewed_at = now(),
         reference_num = COALESCE(NULLIF(trim(COALESCE(p_provider_ref, '')), ''), reference_num)
   WHERE id = v.id;

  IF v.booking_id IS NOT NULL THEN
    SELECT b.user_id, b.ref INTO v_user, v_label FROM bookings b WHERE b.id = v.booking_id;
    UPDATE bookings SET trip_stat = 'open' WHERE id = v.booking_id AND trip_stat = 'pending';
    IF FOUND THEN
      PERFORM assign_next_hold(v.booking_id);
    END IF;
  ELSE
    SELECT r.user_id, COALESCE(r.event_name, 'Boat rental')
      INTO v_user, v_label
      FROM boat_rentals r WHERE r.id = v.boat_rental_id;
    UPDATE boat_rentals SET status = 'pending'
     WHERE id = v.boat_rental_id AND status = 'awaiting_payment';
  END IF;

  IF v_user IS NOT NULL THEN
    INSERT INTO notifications (user_id, title, message, category)
    VALUES (
      v_user,
      'Downpayment confirmed',
      'Your downpayment of ' || trim(to_char(v.amount, 'FM999,999,990.00')) || ' for ' ||
        COALESCE(v_label, 'your booking') ||
        ' was received. It is held by BangkaGo until your trip.',
      'payment'
    );
  END IF;

  RETURN v.id;
END;
$$;

REVOKE ALL ON FUNCTION confirm_gateway_downpayment(TEXT, TEXT, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION confirm_gateway_downpayment(TEXT, TEXT, NUMERIC) TO service_role;

-- =============================================================
-- 4. Queue a payout when the trip closes
-- =============================================================
CREATE OR REPLACE FUNCTION queue_gateway_payout_for_booking()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.trip_stat = 'completed' AND OLD.trip_stat IS DISTINCT FROM 'completed' THEN
    UPDATE downpayments
       SET payout_status = 'queued'
     WHERE booking_id = NEW.id
       AND status = 'approved'
       AND released_at IS NULL
       AND payout_status IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_queue_gateway_payout_booking ON bookings;
CREATE TRIGGER trg_queue_gateway_payout_booking
  AFTER UPDATE OF trip_stat ON bookings
  FOR EACH ROW EXECUTE FUNCTION queue_gateway_payout_for_booking();

CREATE OR REPLACE FUNCTION queue_gateway_payout_for_rental()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    UPDATE downpayments
       SET payout_status = 'queued'
     WHERE boat_rental_id = NEW.id
       AND status = 'approved'
       AND released_at IS NULL
       AND payout_status IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_queue_gateway_payout_rental ON boat_rentals;
CREATE TRIGGER trg_queue_gateway_payout_rental
  AFTER UPDATE OF status ON boat_rentals
  FOR EACH ROW EXECUTE FUNCTION queue_gateway_payout_for_rental();

-- =============================================================
-- 5. Claim a bangkero's queued downpayments (freezes the money maths)
--    Service role only: the edge function calls it, the client never does.
-- =============================================================
CREATE OR REPLACE FUNCTION claim_gateway_payouts(p_bangkero UUID)
RETURNS TABLE (
  downpayment_id UUID,
  gross NUMERIC,
  commission NUMERIC,
  net NUMERIC,
  label TEXT,
  account_name TEXT,
  account_number TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rate NUMERIC;
  v_row RECORD;
  v_fare NUMERIC;
  v_label TEXT;
  v_operator UUID;
  v_name TEXT;
  v_number TEXT;
BEGIN
  IF p_bangkero IS NULL THEN
    RAISE EXCEPTION 'which bangkero?';
  END IF;

  SELECT COALESCE(NULLIF(value, '')::NUMERIC, 0.07) INTO v_rate
    FROM app_settings WHERE key = 'commission_rate';
  v_rate := COALESCE(v_rate, 0.07);

  SELECT payout_account_name, payout_account_number
    INTO v_name, v_number
    FROM bangkeros WHERE id = p_bangkero;

  FOR v_row IN
    SELECT d.* FROM downpayments d
     WHERE d.status = 'approved'
       AND d.released_at IS NULL
       AND (
         COALESCE(d.payout_status, 'queued') IN ('queued', 'failed')
         OR (d.payout_status = 'processing'
             AND d.payout_claimed_at < now() - interval '10 minutes')
       )
       AND (
         (d.booking_id IS NOT NULL AND EXISTS (
           SELECT 1 FROM bookings b
            WHERE b.id = d.booking_id
              AND b.trip_stat = 'completed'
              AND b.operator_id = p_bangkero))
         OR (d.boat_rental_id IS NOT NULL AND EXISTS (
           SELECT 1 FROM boat_rentals r
             JOIN bangkas bk ON bk.id = r.bangka_id
            WHERE r.id = d.boat_rental_id
              AND r.status = 'completed'
              AND bk.bangkero_id = p_bangkero))
       )
     ORDER BY d.created_at
     FOR UPDATE
  LOOP
    IF v_number IS NULL THEN
      RAISE EXCEPTION 'this bangkero has no payout account';
    END IF;

    IF v_row.booking_id IS NOT NULL THEN
      SELECT b.total_price, b.ref INTO v_fare, v_label
        FROM bookings b WHERE b.id = v_row.booking_id;
    ELSE
      SELECT r.total_price, COALESCE(r.event_name, 'Boat rental')
        INTO v_fare, v_label
        FROM boat_rentals r WHERE r.id = v_row.boat_rental_id;
    END IF;

    -- Commission is on the whole fare; it comes out of the downpayment.
    downpayment_id := v_row.id;
    gross := v_row.amount;
    commission := round(COALESCE(v_fare, v_row.amount * 2) * v_rate, 2);
    net := v_row.amount - commission;
    label := v_label;
    account_name := v_name;
    account_number := v_number;

    IF net <= 0 THEN
      RAISE EXCEPTION 'commission (%) leaves nothing to pay out on %', commission, v_row.id;
    END IF;

    UPDATE downpayments
       SET payout_status = 'processing',
           payout_claimed_at = now(),
           commission_rate = v_rate,
           commission_amount = commission,
           payout_error = NULL
     WHERE id = v_row.id;

    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION claim_gateway_payouts(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_gateway_payouts(UUID) TO service_role;

-- =============================================================
-- 6. Write the provider's answer back (paid or failed)
-- =============================================================
CREATE OR REPLACE FUNCTION record_gateway_payout(
  p_ids UUID[],
  p_ref TEXT,
  p_status TEXT,
  p_error TEXT DEFAULT NULL
) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id UUID;
  v_operator UUID;
  v_label TEXT;
BEGIN
  IF p_status NOT IN ('paid', 'failed') THEN
    RAISE EXCEPTION 'payout status must be paid or failed';
  END IF;

  FOREACH v_id IN ARRAY p_ids LOOP
    v_operator := NULL;
    v_label := NULL;

    SELECT COALESCE(b.operator_id, bk.bangkero_id), COALESCE(b.ref, r.event_name, 'your trip')
      INTO v_operator, v_label
      FROM downpayments d
      LEFT JOIN bookings b ON b.id = d.booking_id
      LEFT JOIN boat_rentals r ON r.id = d.boat_rental_id
      LEFT JOIN bangkas bk ON bk.id = r.bangka_id
     WHERE d.id = v_id;

    IF p_status = 'failed' THEN
      UPDATE downpayments
         SET payout_status = 'failed', payout_error = p_error
       WHERE id = v_id;
      CONTINUE;
    END IF;

    UPDATE downpayments
       SET payout_status = 'paid',
           payout_error = NULL,
           gateway_payout_ref = p_ref,
           payout_method = 'gcash',
           payout_ref = p_ref,
           released_at = now(),
           released_to = v_operator
     WHERE id = v_id
       AND released_at IS NULL;

    IF FOUND AND v_operator IS NOT NULL THEN
      INSERT INTO notifications (user_id, title, message, category)
      VALUES (
        v_operator,
        'Share released',
        'BangkaGo sent your share for ' || COALESCE(v_label, 'your trip') ||
          ' to your GCash account.',
        'payment'
      );
    END IF;
  END LOOP;

  RETURN COALESCE(array_length(p_ids, 1), 0);
END;
$$;

REVOKE ALL ON FUNCTION record_gateway_payout(UUID[], TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_gateway_payout(UUID[], TEXT, TEXT, TEXT) TO service_role;

-- =============================================================
-- 7. Admin payout log + commission read (admin/coastguard mobile + web)
-- =============================================================
-- downpayments SELECT already exposes the row to the passenger, the
-- operator and admins (015). The operator UI simply never renders the
-- commission columns.
