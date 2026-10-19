-- =============================================================
-- 053. BATCH PARTNER COUNT RPC
-- =============================================================
-- Why: parcels_select_own (002) is the only policy a passenger can
-- satisfy, so the client-side count of pending_batch partners only ever
-- sees the caller's own rows. This SECURITY DEFINER function counts the
-- whole queue and returns an aggregate only (no other senders' PII).
--
-- Run order: AFTER 052. Forward-only — never delete 002-052.
-- =============================================================

CREATE OR REPLACE FUNCTION get_batch_partner_count(
  p_route_key TEXT,
  p_exclude_parcel_id UUID
) RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM parcels
  WHERE batching_route_key = p_route_key
    AND batching_status = 'pending_batch'
    AND status = 'pending'
    AND id <> p_exclude_parcel_id;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION get_batch_partner_count(TEXT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_batch_partner_count(TEXT, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION get_batch_partner_count(TEXT, UUID) TO authenticated;
