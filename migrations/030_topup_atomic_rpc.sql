-- =============================================================
-- 030 — ATOMIC TOP-UP RPC (audit #23)
--
-- topUpWallet did insert-then-RPC as two client calls: a crash between
-- them left a transaction row with no balance movement (or vice versa
-- on retry). top_up_wallet does both server-side in one transaction —
-- any error rolls the whole top-up back — and enforces ownership plus
-- a positive amount. Run manually in the SQL editor after 029.
-- =============================================================

CREATE OR REPLACE FUNCTION top_up_wallet(p_wallet_id UUID, p_amount NUMERIC)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Top-up amount must be above ₱0.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM wallets w
    JOIN bangkeros b ON b.id = w.bangkero_id
    WHERE w.id = p_wallet_id
      AND b.id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'you do not have permission to do that';
  END IF;

  INSERT INTO wallet_transactions (wallet_id, type, amount)
  VALUES (p_wallet_id, 'top_up', p_amount);

  UPDATE wallets
  SET balance = balance + p_amount
  WHERE id = p_wallet_id;
END;
$$;

REVOKE ALL ON FUNCTION top_up_wallet(UUID, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION top_up_wallet(UUID, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION top_up_wallet(UUID, NUMERIC) TO service_role;

-- =============================================================
-- DONE.
--
-- Verify (as a bangkero with a wallet):
--   SELECT top_up_wallet('<wallet id>', 500);
--   SELECT balance FROM wallets WHERE id = '<wallet id>';
--   SELECT type, amount FROM wallet_transactions
--    WHERE wallet_id = '<wallet id>' ORDER BY created_at DESC LIMIT 1;
--   SELECT top_up_wallet('<wallet id>', 0);
--     -- must raise 'Top-up amount must be above ₱0.'
-- =============================================================
