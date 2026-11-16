-- =============================================================
-- 087 — Booking intent id (idempotent create)
-- Run AFTER 086_demo_ports.sql.
--
-- A lost insert response used to leave the passenger staring at an
-- error while the booking already existed; tapping again hit the
-- "you already have a booking" guard and never reached confirmation.
-- payment.tsx now sends one client_ref per payment screen, and a
-- retry returns the existing row instead of inserting a duplicate.
--
-- TEXT (not UUID) so no crypto dependency is needed client-side.
-- The partial index lets every existing / NULL row coexist.
-- =============================================================

BEGIN;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS client_ref TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS bookings_client_ref_unique
  ON public.bookings (user_id, client_ref)
  WHERE client_ref IS NOT NULL;

COMMIT;
