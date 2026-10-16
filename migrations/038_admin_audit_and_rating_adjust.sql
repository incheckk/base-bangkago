-- =============================================================
-- 038 — ADMIN AUDIT TRAIL + RATING ADJUST RPC + ADMIN READ POLICIES
-- Run manually in the Supabase SQL editor AFTER 036 and 037.
--
-- 1. AUDIT LOG — who changed what, when (accountability).
--    Captured by DB triggers, so EVERY path is covered (mobile
--    direct writes, web RPCs, dev switches) with no client code
--    that could forget to log. auth.uid() survives inside
--    SECURITY DEFINER functions, so RPC-driven changes are
--    attributed correctly too.
--
--    Log rule (keeps noise out): a row is recorded when the
--    actor's role is 'admin' or 'coastguard' on an audited table,
--    OR — regardless of actor — when the bangkeros rating /
--    verification columns change (catches passenger-triggered
--    apply_bangkero_penalty, actor_role = 'passenger').
--
--    Known limits (accepted): SQL-editor writes run with no JWT
--    (auth.uid() NULL) and are NOT logged; coastguard has no
--    write paths today so no coastguard rows appear until they
--    get some. audit_log is admin-READ-ONLY — coastguard cannot
--    see it (RLS below).
--
-- 2. admin_set_bangkero_rating — admin-only RPC to adjust a
--    bangkero's penalty / recovery stars from the web Ratings
--    page. The trigger logs it automatically.
--
-- 3. Admin SELECT on passenger_details + parcels so the web
--    manifest (Manage Bookings) can show companions and parcels.
--    Today both tables are owner/bangkero-only and an admin
--    session silently reads 0 rows.
-- =============================================================

-- -------------------------------------------------------------
-- 1. AUDIT LOG
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID,
  actor_role TEXT,                          -- snapshot: admin | coastguard | passenger | bangkero
  action TEXT NOT NULL,                     -- INSERT | UPDATE | DELETE
  target_table TEXT NOT NULL,
  target_id TEXT,                           -- row id as text (UUID or int)
  old_data JSONB,                           -- UPDATE: changed cols only; DELETE: full row
  new_data JSONB,                           -- UPDATE: changed cols only; INSERT: full row
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_target_idx ON audit_log (target_table, target_id);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Admin read only. Coastguard deliberately excluded: they must
-- never see the audit trail. No INSERT/UPDATE/DELETE policies —
-- only the SECURITY DEFINER trigger below writes.
DROP POLICY IF EXISTS "audit_log_select_admin" ON audit_log;
CREATE POLICY "audit_log_select_admin" ON audit_log
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin')
  );

-- Trigger function. SECURITY DEFINER so the audit insert bypasses
-- RLS; writes its own role lookup from users.
CREATE OR REPLACE FUNCTION audit_log_row()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_role   TEXT;
  v_old    JSONB;
  v_new    JSONB;
  v_old_ch JSONB;
  v_new_ch JSONB;
  v_watch  TEXT[] := ARRAY['verification_stat','rating_penalty','rating_recovery_stars'];
  k        TEXT;
  v_logged BOOLEAN;
BEGIN
  -- No JWT (SQL editor / migrations) — not attributable, skip.
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT user_role INTO v_role FROM users WHERE id = v_uid;
  IF v_role IS NULL THEN
    RETURN NULL; -- deleted/unknown actor
  END IF;

  IF TG_OP <> 'INSERT' THEN v_old := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN v_new := to_jsonb(NEW); END IF;

  -- Changed columns only (full rows for INSERT/DELETE).
  IF TG_OP = 'UPDATE' THEN
    IF v_old = v_new THEN
      RETURN NULL; -- no-op update: nothing to blame anyone for
    END IF;
    FOR k IN SELECT key FROM jsonb_each(v_new) LOOP
      IF v_old -> k IS DISTINCT FROM v_new -> k THEN
        v_old_ch := COALESCE(v_old_ch, '{}'::jsonb) || jsonb_build_object(k, v_old -> k);
        v_new_ch := COALESCE(v_new_ch, '{}'::jsonb) || jsonb_build_object(k, v_new -> k);
      END IF;
    END LOOP;
  END IF;

  -- Log rule.
  v_logged := v_role IN ('admin', 'coastguard');
  IF NOT v_logged AND TG_TABLE_NAME = 'bangkeros' AND TG_OP = 'UPDATE' THEN
    -- Rating/verification columns changed by a non-admin (e.g.
    -- a passenger penalty or the automatic recovery tick).
    v_logged := EXISTS (
      SELECT 1 FROM unnest(v_watch) w
      WHERE v_old -> w IS DISTINCT FROM v_new -> w
    );
  END IF;
  IF NOT v_logged THEN
    RETURN NULL;
  END IF;

  INSERT INTO audit_log (actor_id, actor_role, action, target_table, target_id, old_data, new_data)
  VALUES (
    v_uid,
    v_role,
    TG_OP,
    TG_TABLE_NAME,
    COALESCE(v_new ->> 'id', v_old ->> 'id'),
    CASE WHEN TG_OP = 'UPDATE' THEN v_old_ch ELSE v_old END,
    CASE WHEN TG_OP = 'UPDATE' THEN v_new_ch ELSE v_new END
  );

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION audit_log_row() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS audit_users ON users;
CREATE TRIGGER audit_users
  AFTER INSERT OR UPDATE OR DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION audit_log_row();

DROP TRIGGER IF EXISTS audit_bangkeros ON bangkeros;
CREATE TRIGGER audit_bangkeros
  AFTER INSERT OR UPDATE OR DELETE ON bangkeros
  FOR EACH ROW EXECUTE FUNCTION audit_log_row();

DROP TRIGGER IF EXISTS audit_bangkero_verification ON bangkero_verification;
CREATE TRIGGER audit_bangkero_verification
  AFTER INSERT OR UPDATE OR DELETE ON bangkero_verification
  FOR EACH ROW EXECUTE FUNCTION audit_log_row();

DROP TRIGGER IF EXISTS audit_dev_flags ON dev_flags;
CREATE TRIGGER audit_dev_flags
  AFTER INSERT OR UPDATE OR DELETE ON dev_flags
  FOR EACH ROW EXECUTE FUNCTION audit_log_row();

DROP TRIGGER IF EXISTS audit_downpayments ON downpayments;
CREATE TRIGGER audit_downpayments
  AFTER INSERT OR UPDATE OR DELETE ON downpayments
  FOR EACH ROW EXECUTE FUNCTION audit_log_row();

DROP TRIGGER IF EXISTS audit_bookings ON bookings;
CREATE TRIGGER audit_bookings
  AFTER INSERT OR UPDATE OR DELETE ON bookings
  FOR EACH ROW EXECUTE FUNCTION audit_log_row();

DROP TRIGGER IF EXISTS audit_boat_rentals ON boat_rentals;
CREATE TRIGGER audit_boat_rentals
  AFTER INSERT OR UPDATE OR DELETE ON boat_rentals
  FOR EACH ROW EXECUTE FUNCTION audit_log_row();

DROP TRIGGER IF EXISTS audit_ports ON ports;
CREATE TRIGGER audit_ports
  AFTER INSERT OR UPDATE OR DELETE ON ports
  FOR EACH ROW EXECUTE FUNCTION audit_log_row();

DROP TRIGGER IF EXISTS audit_routes ON routes;
CREATE TRIGGER audit_routes
  AFTER INSERT OR UPDATE OR DELETE ON routes
  FOR EACH ROW EXECUTE FUNCTION audit_log_row();

DROP TRIGGER IF EXISTS audit_safety_alerts ON safety_alerts;
CREATE TRIGGER audit_safety_alerts
  AFTER INSERT OR UPDATE OR DELETE ON safety_alerts
  FOR EACH ROW EXECUTE FUNCTION audit_log_row();

DROP TRIGGER IF EXISTS audit_bangkas ON bangkas;
CREATE TRIGGER audit_bangkas
  AFTER INSERT OR UPDATE OR DELETE ON bangkas
  FOR EACH ROW EXECUTE FUNCTION audit_log_row();

-- Realtime so the web Audit Log page live-refreshes (009 pattern).
DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.audit_log';
  EXCEPTION
    WHEN duplicate_object THEN RAISE NOTICE 'audit_log already in supabase_realtime';
    WHEN undefined_object THEN RAISE NOTICE 'publication supabase_realtime missing — enable Realtime first';
  END;
END $$;

-- -------------------------------------------------------------
-- 2. RATING ADJUST RPC — mirrors update_bangkero_verification (033):
--    admin-only, SECURITY DEFINER, returns the new effective
--    rating straight from the 036 function (single source of
--    truth, tick included). The bangkeros trigger above records
--    the before/after with the admin as actor.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_set_bangkero_rating(
  p_bangkero UUID,
  p_penalty NUMERIC,
  p_recovery INT
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only admins may adjust ratings.'
      USING ERRCODE = '42501';
  END IF;

  -- Same bounds as the DB: 007's CHECK is rating_penalty 0..5.
  IF p_penalty IS NULL OR p_penalty < 0 OR p_penalty > 5 THEN
    RAISE EXCEPTION 'Penalty must be between 0 and 5.'
      USING ERRCODE = '22023';
  END IF;
  IF p_recovery IS NULL OR p_recovery < 0 OR p_recovery > 5 THEN
    RAISE EXCEPTION 'Recovery stars must be between 0 and 5.'
      USING ERRCODE = '22023';
  END IF;

  UPDATE bangkeros
     SET rating_penalty = round(p_penalty, 1),
         rating_recovery_stars = p_recovery,
         updated_at = now()
   WHERE id = p_bangkero;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bangkero not found.'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN bangkero_effective_rating(p_bangkero);
END;
$$;

REVOKE ALL ON FUNCTION admin_set_bangkero_rating(uuid, numeric, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_set_bangkero_rating(uuid, numeric, int) TO authenticated;

-- -------------------------------------------------------------
-- 3. ADMIN READ — web manifest shows companions + parcels; both
--    tables are owner/bangkero-only today, so an admin session
--    silently reads zero rows.
-- -------------------------------------------------------------
DROP POLICY IF EXISTS "passenger_details_select_admin" ON passenger_details;
CREATE POLICY "passenger_details_select_admin" ON passenger_details
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin')
  );

DROP POLICY IF EXISTS "parcels_select_admin" ON parcels;
CREATE POLICY "parcels_select_admin" ON parcels
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin')
  );

-- Pick up the new function for PostgREST.
NOTIFY pgrst, 'reload schema';
