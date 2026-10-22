-- =============================================================
-- 065 - REAL USER SUSPENSION
--
-- Why: Admin -> Manage Users offered "Suspend" but wrote users.is_verified,
-- which the app sets to false on EVERY sign-up and reads nowhere. So the
-- column showed every self-registered account as Suspended, and suspending
-- changed nothing. is_verified stays untouched (dead data); this adds an
-- explicit, enforced flag.
--
-- New column defaults to false, so no existing account is blocked. Enforcement
-- ships in the same batch:
--   * app  - fetchUserDoc() throws on is_suspended (all four layouts already
--            render AuthErrorScreen with a Sign out button)
--   * web  - bangkago.role() returns 'suspended' (guard bounces to the portal)
--
-- The BEFORE UPDATE guard exists because users_update_own (002) lets an
-- authenticated user update their OWN row with the public anon key: without
-- it, a suspended user could clear their flag themselves. auth.uid() IS NULL
-- is allowed so the SQL editor / service role can still manage rows (anon
-- requests have a null uid but are already blocked by RLS on users).
--
-- Run manually in the SQL editor, after 064. No demo reset.
-- =============================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.guard_user_suspension()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.is_suspended IS NOT DISTINCT FROM OLD.is_suspended THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL OR EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND user_role = 'admin'
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Only admins may suspend or reactivate an account.'
    USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public.guard_user_suspension() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS users_guard_suspension ON public.users;
CREATE TRIGGER users_guard_suspension
  BEFORE UPDATE OF is_suspended ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.guard_user_suspension();

-- Pick up the new column + function for PostgREST immediately.
NOTIFY pgrst, 'reload schema';

-- Verify: SELECT id, user_role, is_suspended FROM users ORDER BY created_at DESC;
