-- =============================================================
-- 069 — Mobile operations batch
--
--  1. dev_flags.show_quick_login — the admin can hide the sign-in
--     "dev quick login" chips (demo only, still __DEV__-gated).
--  2. sailing_status — one row the coastguard suspends/resumes.
--  3. active_alerts_public() — scrubbed alert feed for bangkeros.
--
-- Run after 066 (cancel columns) and 068 (standard price). No demo
-- reset. Every part degrades safely in the app before it is run.
-- =============================================================

-- =============================================================
-- 1. DEV QUICK LOGIN TOGGLE
--
-- The sign-in screen has no session, so it cannot read dev_flags
-- under the authenticated-only select policy. One SECURITY DEFINER
-- reader exposes only the boolean, never the other flags.
-- =============================================================

ALTER TABLE dev_flags ADD COLUMN IF NOT EXISTS show_quick_login BOOLEAN NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION demo_quick_login_enabled()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT show_quick_login FROM dev_flags WHERE id = 1), true);
$$;

REVOKE EXECUTE ON FUNCTION demo_quick_login_enabled() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION demo_quick_login_enabled() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION set_show_quick_login(p_on BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin'
  ) THEN
    RAISE EXCEPTION 'admins only';
  END IF;
  UPDATE dev_flags SET show_quick_login = p_on WHERE id = 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION set_show_quick_login(BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION set_show_quick_login(BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION set_show_quick_login(BOOLEAN) TO authenticated, service_role;

-- =============================================================
-- Verify
--   SELECT * FROM dev_flags;
--   SELECT demo_quick_login_enabled();
-- =============================================================
