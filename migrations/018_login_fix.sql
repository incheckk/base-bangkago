-- =============================================================
-- 018 — LOGIN FIX: break the users <-> boat_rentals policy cycle
--
-- Symptom (verified live, 2026-10-01):
--   "infinite recursion detected in policy for relation \"users\""
--   on EVERY read of users / boat_rentals / downpayments — including
--   fetchUserDoc() at sign-in, so no role can log in at all.
--
-- Cause (plan-time, no rows needed — proven by probes):
--   016 added users_select_rental_parties (ON users) whose USING
--   subqueries boat_rentals. Expanding THAT policy's qual requires
--   expanding boat_rentals policies, of which boat_rentals_select_admin
--   (also 016) subqueries users — re-entering the users policy set
--   while it is still being expanded => 42P17 at plan time. The same
--   chain fires from downpayments policies (they subquery boat_rentals
--   and users).
--
--   users_select_admin / users_update_admin (003) additionally
--   self-reference users (EXISTS SELECT 1 FROM users ...). PostgreSQL
--   tolerated that before 016, but it is the same defect class — both
--   shapes are removed here so users policies contain ZERO table
--   subqueries and every cycle through users is impossible.
--
-- Fix: SECURITY DEFINER helper functions.
--   * LANGUAGE plpgsql — never inlined into the caller's query, so the
--     policy qual stays a plain function call; plan-time expansion of
--     the policy stops at the function (no relation RTEs to expand).
--   * SECURITY DEFINER, owner = postgres = table owner — inside the
--     function the reads run as the owner, which bypasses RLS (no
--     FORCE ROW LEVEL SECURITY on these tables), so no nested policy
--     expansion happens at runtime either.
--   * SET search_path = '' + schema-qualified names — the hardened
--     pattern (009/010 still use search_path = public; see LAUNCH).
--
-- Run this in the Supabase SQL Editor AFTER 016 (and after 017).
-- Idempotent: safe to re-run.
-- =============================================================

-- 1. Admin check without the self-referencing subquery.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND user_role = 'admin'
  );
END;
$$;

-- 2. Is there a boat rental linking the caller and the user row being read?
--    (bangkero reading the renter's row, or renter reading the bangkero's.)
CREATE OR REPLACE FUNCTION public.is_rental_party(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.boat_rentals r
    JOIN public.bangkas k ON k.id = r.bangka_id
    WHERE (k.bangkero_id = auth.uid() AND r.user_id = p_user_id)
       OR (r.user_id = auth.uid() AND k.bangkero_id = p_user_id)
  );
END;
$$;

-- Policy evaluation runs as the querying role, so it needs EXECUTE.
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_rental_party(uuid) TO authenticated;

-- 3. Recreate the three users policies as leaf predicates (no subqueries).
DROP POLICY IF EXISTS "users_select_admin" ON public.users;
CREATE POLICY "users_select_admin" ON public.users
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "users_update_admin" ON public.users;
CREATE POLICY "users_update_admin" ON public.users
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "users_select_rental_parties" ON public.users;
CREATE POLICY "users_select_rental_parties" ON public.users
  FOR SELECT TO authenticated
  USING (public.is_rental_party(id));

-- =============================================================
-- VERIFY (must all succeed — each currently throws 42P17):
--   SET request.jwt.claims = '{"sub":"<any-user-uuid>","role":"authenticated"}';
--   SET ROLE authenticated;
--   SELECT id FROM users;                       -- was: recursion on users
--   SELECT id FROM boat_rentals;                -- was: recursion on boat_rentals
--   SELECT id FROM downpayments;                -- was: recursion via boat_rentals
--   RESET ROLE;
-- Or in the app: any sign-in (form + dev quick logins) reaches the role home.
-- =============================================================
