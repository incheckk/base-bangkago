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
-- 2. SAILING ADVISORY (coastguard suspend / resume)
--
-- One row. While it is active and unexpired:
--   - no booking can move to 'accepted'   (trigger)
--   - no booking or manifest can stamp a departure (triggers)
--   - trips already at sea keep sailing; future-dated trips and
--     anything that already left the port are left alone.
--
-- Reversible four ways: coastguard taps Resume, weather auto-clear
-- (only for weather-sourced rows, when the strait reads 'good'),
-- admin override in Developer Options, and an expires_at fallback.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.sailing_advisory (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  is_suspended BOOLEAN NOT NULL DEFAULT false,
  reason TEXT,
  -- 'coastguard' | 'weather' | 'admin_override' — free text on purpose.
  source TEXT NOT NULL DEFAULT 'coastguard',
  suspended_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  suspended_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  resumed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  resumed_at TIMESTAMPTZ
);

INSERT INTO public.sailing_advisory (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.sailing_advisory ENABLE ROW LEVEL SECURITY;

-- Everyone signed in may read the notice; only the RPCs below write.
DROP POLICY IF EXISTS sailing_advisory_select ON public.sailing_advisory;
CREATE POLICY sailing_advisory_select ON public.sailing_advisory
  FOR SELECT TO authenticated USING (true);

-- The banner has to reach every signed-in phone without a reload.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'sailing_advisory'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sailing_advisory;
  END IF;
END;
$$;

-- Single source of truth for "is the gate closed right now", including
-- the expiry clock.
CREATE OR REPLACE FUNCTION public.sailing_suspended()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT is_suspended AND (expires_at IS NULL OR expires_at > now())
    FROM public.sailing_advisory WHERE id = 1
  ), false);
$$;

REVOKE EXECUTE ON FUNCTION public.sailing_suspended() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sailing_suspended() FROM anon;
GRANT EXECUTE ON FUNCTION public.sailing_suspended() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_sailing_advisory(
  p_suspended BOOLEAN,
  p_reason TEXT DEFAULT NULL,
  p_source TEXT DEFAULT 'coastguard',
  p_hours INT DEFAULT 6
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role TEXT;
  v_reason TEXT;
  v_source TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT user_role INTO v_role FROM public.users WHERE id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('coastguard', 'admin') THEN
    RAISE EXCEPTION 'only the coastguard or an admin can change the sailing advisory';
  END IF;

  v_reason := NULLIF(btrim(coalesce(p_reason, '')), '');
  v_source := COALESCE(NULLIF(btrim(coalesce(p_source, '')), ''), 'coastguard');

  IF NOT p_suspended THEN
    UPDATE public.sailing_advisory
    SET is_suspended = false,
        expires_at = NULL,
        resumed_by = auth.uid(),
        resumed_at = now()
    WHERE id = 1;

    INSERT INTO public.notifications (user_id, title, message)
    SELECT u.id, 'Sailing resumed',
      'The coastguard has lifted the sailing suspension. You can accept trips and sail again.'
    FROM public.users u WHERE u.user_role IN ('bangkero', 'admin');
    RETURN;
  END IF;

  UPDATE public.sailing_advisory
  SET is_suspended = true,
      reason = COALESCE(v_reason, 'Rough sea — all trips on hold'),
      source = v_source,
      suspended_by = auth.uid(),
      suspended_at = now(),
      -- p_hours <= 0 means "no automatic expiry".
      expires_at = CASE WHEN p_hours > 0 THEN now() + make_interval(hours => p_hours) ELSE NULL END,
      resumed_by = NULL,
      resumed_at = NULL
  WHERE id = 1;

  -- Only what has not sailed. Today's pending/open/accepted trips lose
  -- their slot so nobody is left waiting for a boat that cannot leave.
  WITH cancelled AS (
    UPDATE public.bookings
    SET trip_stat = 'cancelled',
        cancelled_at = now(),
        cancel_reason = 'Sailing suspended: ' || COALESCE(v_reason, 'coastguard advisory'),
        held_by = NULL,
        hold_expires_at = NULL
    WHERE trip_stat IN ('pending', 'open', 'accepted')
      AND depart_time IS NULL
      AND (scheduled_date IS NULL OR scheduled_date <= (now() AT TIME ZONE 'Asia/Manila')::date)
    RETURNING id, user_id, ref
  )
  INSERT INTO public.notifications (user_id, title, message)
  SELECT c.user_id, 'Trip cancelled — sailing suspended',
    'Booking ' || c.ref || ' was cancelled because sailing is suspended: '
      || COALESCE(v_reason, 'coastguard advisory') || '. You were not charged.'
  FROM cancelled c;

  INSERT INTO public.notifications (user_id, title, message)
  SELECT u.id, 'Sailing suspended',
    COALESCE(v_reason, 'Rough sea') || '. No trip can be accepted or sail until the coastguard resumes sailing.'
  FROM public.users u WHERE u.user_role IN ('bangkero', 'admin');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_sailing_advisory(BOOLEAN, TEXT, TEXT, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_sailing_advisory(BOOLEAN, TEXT, TEXT, INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_sailing_advisory(BOOLEAN, TEXT, TEXT, INT) TO authenticated, service_role;

-- Called by the coastguard Overview once the live reading is 'good'.
-- Only a weather-sourced advisory clears itself; a manual coastguard
-- suspension stays until somebody resumes it.
CREATE OR REPLACE FUNCTION public.maybe_auto_clear_advisory(p_safe BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cleared BOOLEAN := false;
BEGIN
  IF auth.uid() IS NULL OR p_safe IS NOT TRUE THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND user_role IN ('coastguard', 'admin')
  ) THEN
    RETURN false;
  END IF;

  UPDATE public.sailing_advisory
  SET is_suspended = false,
      expires_at = NULL,
      resumed_by = auth.uid(),
      resumed_at = now()
  WHERE id = 1 AND is_suspended AND source = 'weather';

  IF FOUND THEN
    v_cleared := true;
    INSERT INTO public.notifications (user_id, title, message)
    SELECT u.id, 'Sailing resumed',
      'The sea has calmed — the weather advisory cleared itself. You can sail again.'
    FROM public.users u WHERE u.user_role IN ('bangkero', 'admin');
  END IF;

  RETURN v_cleared;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.maybe_auto_clear_advisory(BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.maybe_auto_clear_advisory(BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION public.maybe_auto_clear_advisory(BOOLEAN) TO authenticated, service_role;

-- -------------------------------------------------------------
-- Gates. Triggers, not app checks: the accept RPC, the depart RPC
-- and the manifest's direct update all pass through here.
-- -------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.block_accept_while_suspended()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.trip_stat = 'accepted'
     AND COALESCE(OLD.trip_stat, '') <> 'accepted'
     AND public.sailing_suspended() THEN
    RAISE EXCEPTION 'Sailing is suspended by the coastguard — no new trips can be accepted right now.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.block_depart_while_suspended()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.depart_time IS NOT NULL
     AND OLD.depart_time IS NULL
     AND public.sailing_suspended() THEN
    RAISE EXCEPTION 'Sailing is suspended by the coastguard — trips cannot depart right now.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.block_manifest_depart_while_suspended()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.actual_departure_time IS NOT NULL
     AND OLD.actual_departure_time IS NULL
     AND public.sailing_suspended() THEN
    RAISE EXCEPTION 'Sailing is suspended by the coastguard — trips cannot depart right now.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bookings_accept_sailing_gate ON public.bookings;
CREATE TRIGGER trg_bookings_accept_sailing_gate
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.block_accept_while_suspended();

DROP TRIGGER IF EXISTS trg_bookings_depart_sailing_gate ON public.bookings;
CREATE TRIGGER trg_bookings_depart_sailing_gate
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.block_depart_while_suspended();

DROP TRIGGER IF EXISTS trg_trip_manifest_depart_sailing_gate ON public.trip_manifest;
CREATE TRIGGER trg_trip_manifest_depart_sailing_gate
  BEFORE UPDATE ON public.trip_manifest
  FOR EACH ROW EXECUTE FUNCTION public.block_manifest_depart_while_suspended();

-- =============================================================
-- 3. SCRUBBED ALERT FEED FOR BANGKEROS
--
-- A bangkero's own SOS and every admin/coastguard view keep the full
-- message (name, GPS). Other bangkeros get severity + port + time
-- only — no vessel name, no fix. The table's USING (true) policy is
-- untouched (tracker E3); this RPC is the app's only bangkero read.
-- =============================================================

CREATE OR REPLACE FUNCTION public.alert_feed()
RETURNS TABLE (
  id UUID,
  message TEXT,
  severity TEXT,
  is_resolved BOOLEAN,
  created_at TIMESTAMPTZ,
  bangka_id UUID,
  port_id TEXT,
  is_mine BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    a.id,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = auth.uid() AND u.user_role IN ('admin', 'coastguard')
      ) OR EXISTS (
        SELECT 1 FROM public.bangkas b
        WHERE b.id = a.bangka_id AND b.bangkero_id = auth.uid()
      )
      THEN a.message
      ELSE 'Another vessel reported an emergency.'
    END AS message,
    a.severity,
    a.is_resolved,
    a.created_at,
    a.bangka_id,
    a.port_id,
    EXISTS (
      SELECT 1 FROM public.bangkas b
      WHERE b.id = a.bangka_id AND b.bangkero_id = auth.uid()
    ) AS is_mine
  FROM public.safety_alerts a
  WHERE auth.uid() IS NOT NULL
  ORDER BY a.created_at DESC
  LIMIT 100;
$$;

REVOKE EXECUTE ON FUNCTION public.alert_feed() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.alert_feed() FROM anon;
GRANT EXECUTE ON FUNCTION public.alert_feed() TO authenticated, service_role;

-- =============================================================
-- Verify
--   SELECT * FROM dev_flags;
--   SELECT demo_quick_login_enabled();
--   SELECT * FROM sailing_advisory;
--   SELECT public.sailing_suspended();
--   SELECT * FROM public.alert_feed() LIMIT 5;
-- =============================================================
