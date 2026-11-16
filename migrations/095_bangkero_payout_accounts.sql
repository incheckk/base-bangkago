-- 095 — where BangkaGo sends a bangkero's share.
--
-- A payout needs an ACCOUNT NUMBER. bangkeros.gcash_qr_url is a screenshot
-- of a QR code; no disbursement API can pay into it. These columns hold the
-- account itself so the payout function has something to send to, and so a
-- switch to live keys is a key swap rather than a rebuild.
--
-- Nullable on purpose: existing bangkeros keep working and the manual
-- release (079 release_downpayment, cash) stays available for anyone who
-- never sets one. The app asks for it after the tutorial and shows a banner.
-- No demo reset.

ALTER TABLE bangkeros ADD COLUMN IF NOT EXISTS payout_account_name TEXT;
ALTER TABLE bangkeros ADD COLUMN IF NOT EXISTS payout_account_number TEXT;
ALTER TABLE bangkeros ADD COLUMN IF NOT EXISTS payout_channel TEXT NOT NULL DEFAULT 'gcash';

DO $$
BEGIN
  -- PH mobile number, stored one way: 09XXXXXXXXX.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bangkeros_payout_number_check'
  ) THEN
    ALTER TABLE bangkeros ADD CONSTRAINT bangkeros_payout_number_check
      CHECK (payout_account_number IS NULL OR payout_account_number ~ '^09[0-9]{9}$');
  END IF;

  -- One channel for now; widening this is the whole multi-provider decision.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bangkeros_payout_channel_check'
  ) THEN
    ALTER TABLE bangkeros ADD CONSTRAINT bangkeros_payout_channel_check
      CHECK (payout_channel IN ('gcash'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bangkeros_payout_name_check'
  ) THEN
    ALTER TABLE bangkeros ADD CONSTRAINT bangkeros_payout_name_check
      CHECK (payout_account_name IS NULL OR length(trim(payout_account_name)) >= 4);
  END IF;
END $$;

-- Reading/writing the account uses the existing self-update policy on
-- bangkeros (011) and is audited by 082's trigger — no new RLS.
