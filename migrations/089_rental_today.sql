-- =============================================================
-- 089 — Same-day rentals (demo switch)
-- Run AFTER 088_per_passenger_no_show.sql.
--
-- Charters are advance-only in production: the rental form's day
-- strip starts tomorrow. The presentation needs a charter for TODAY,
-- so Admin -> Developer Options can lift that UI rule with one flag.
-- This migration only stores the switch — no rental, escrow or day-
-- conflict rule changes. A same-day charter still pays the 50%
-- downpayment and waits for the admin to clear it (020).
--
-- The passenger rental form has an authenticated session but no
-- admin role, so it reads the flag through one SECURITY DEFINER
-- reader instead of dev_flags' admin select (069 pattern).
-- =============================================================

BEGIN;

ALTER TABLE public.dev_flags
ADD COLUMN IF NOT EXISTS rental_today BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.demo_rental_today_enabled()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
SELECT COALESCE((SELECT rental_today FROM dev_flags WHERE id = 1), false);
$$;

REVOKE EXECUTE ON FUNCTION public.demo_rental_today_enabled() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.demo_rental_today_enabled()
TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_rental_today(p_on BOOLEAN)
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
UPDATE dev_flags SET rental_today = p_on WHERE id = 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_rental_today(BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_rental_today(BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_rental_today(BOOLEAN)
TO authenticated, service_role;

COMMIT;
