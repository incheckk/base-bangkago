-- =============================================================
-- 034. PORTS ISLAND GROUPING (Parcel Padala Phase 0)
-- =============================================================
-- Why: cross-island parcel detection needs a first-class grouping.
-- ports.location is 'Lapu-Lapu, Cebu' for all 9 rows (021) and stays
-- for backward compatibility. ml/config/ports.json `is_mainland` is the
-- source of truth for the backfill below.
--
--   is_mainland true  -> island_group 'mactan', island_name 'Mactan'
--     (marigondon, angasil, hilton, maribago)
--   is_mainland false -> island_group 'olango', island_name per port
--     (caohagan -> 'Caohagan', sulpa -> 'Sulpa',
--      st-vicente -> 'St. Vicente', hilotongan -> 'Hilotongan',
--      nalusuan -> 'Nalusuan')
--
-- Safe to re-run (all ADDs are IF NOT EXISTS; backfill is idempotent).
-- Run manually in the SQL editor after 033. Does NOT touch 002/017/021.
-- =============================================================

ALTER TABLE public.ports
  ADD COLUMN IF NOT EXISTS island_group TEXT;

ALTER TABLE public.ports
  ADD COLUMN IF NOT EXISTS island_name TEXT;

-- Backfill from ml/config/ports.json mapping (idempotent UPDATEs).
UPDATE public.ports SET island_group = 'mactan', island_name = 'Mactan'
  WHERE id IN ('marigondon', 'angasil', 'hilton', 'maribago');
UPDATE public.ports SET island_group = 'olango', island_name = 'Caohagan'
  WHERE id = 'caohagan';
UPDATE public.ports SET island_group = 'olango', island_name = 'Sulpa'
  WHERE id = 'sulpa';
UPDATE public.ports SET island_group = 'olango', island_name = 'St. Vicente'
  WHERE id = 'st-vicente';
UPDATE public.ports SET island_group = 'olango', island_name = 'Hilotongan'
  WHERE id = 'hilotongan';
UPDATE public.ports SET island_group = 'olango', island_name = 'Nalusuan'
  WHERE id = 'nalusuan';

-- Safety: any port inserted without a group (e.g. admin "Add Port"
-- before the client passes the new fields) defaults to mactan/Mactan
-- rather than violating NOT NULL below. Remove once the client always
-- sends island fields.
DO $$
BEGIN
  UPDATE public.ports SET island_group = 'mactan'
    WHERE island_group IS NULL;
  UPDATE public.ports SET island_name = 'Mactan'
    WHERE island_name IS NULL;
END
$$;

ALTER TABLE public.ports
  ALTER COLUMN island_group SET NOT NULL,
  ALTER COLUMN island_name SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ports_island_group_check'
  ) THEN
    ALTER TABLE public.ports
      ADD CONSTRAINT ports_island_group_check
      CHECK (island_group IN ('mactan', 'olango'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS ports_island_group_idx
  ON public.ports (island_group);

COMMENT ON COLUMN public.ports.island_group IS
  'Parcel Padala Phase 0 (034): mactan = mainland ports, olango = island ports. Seeded from ml/config/ports.json is_mainland.';
COMMENT ON COLUMN public.ports.island_name IS
  'Parcel Padala Phase 0 (034): display island name (Mactan / Caohagan / Sulpa / St. Vicente / Hilotongan / Nalusuan).';

-- =============================================================
-- DOWN (commented — do NOT run unless rolling back Phase 0):
-- ALTER TABLE public.ports DROP CONSTRAINT IF EXISTS ports_island_group_check;
-- DROP INDEX IF EXISTS public.ports_island_group_idx;
-- ALTER TABLE public.ports DROP COLUMN IF EXISTS island_name;
-- ALTER TABLE public.ports DROP COLUMN IF EXISTS island_group;
-- =============================================================
