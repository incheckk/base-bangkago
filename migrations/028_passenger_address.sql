-- =============================================================
-- 028 — passenger manifest address
--
-- The passenger-information modal (CompanionForm) now collects a home
-- address for every companion — it is a manifest, so every field is
-- required in the client. Stored here so the bangkero can read it on
-- the sailing manifest. Rows written before this migration keep NULL.
-- =============================================================

ALTER TABLE public.passenger_details
  ADD COLUMN IF NOT EXISTS address text;

COMMENT ON COLUMN public.passenger_details.address IS
  'Home address as written on the passenger manifest (CompanionForm, required for new rows).';
