-- =============================================================
-- 056. MANIFEST_PARCELS UNIQUE (manifest_id, parcel_id)
-- =============================================================
-- Why: populateManifestDeparture reads the existing rows and then inserts;
-- the screen guards were useState flags, so a fast double-tap (or two
-- overlapping populates) could record the same parcel twice. The
-- denormalised trip_manifest.total_parcels_on_board is a raw row count, so
-- the departure card and the Arrived screen then read "1 parcel / 2 items"
-- for a single physical cargo.
--
-- This migration removes the duplicate rows, repairs every affected
-- counter, and makes a repeat impossible. populateManifestDeparture now
-- upserts on this key with ON CONFLICT DO NOTHING.
--
-- Run order: AFTER 055. Forward-only — never delete 002-056.
-- =============================================================

-- 1. Keep the earliest row for each (manifest_id, parcel_id); id breaks
--    ties so the result is deterministic.
DELETE FROM public.manifest_parcels mp
WHERE EXISTS (
  SELECT 1
  FROM public.manifest_parcels keep
  WHERE keep.manifest_id = mp.manifest_id
    AND keep.parcel_id = mp.parcel_id
    AND (COALESCE(keep.loaded_at, 'epoch'::timestamptz), keep.id)
      < (COALESCE(mp.loaded_at, 'epoch'::timestamptz), mp.id)
);

-- 2. Recompute the denormalised parcel total on every manifest that has
--    (or had) parcel rows. Manifests already at the correct value and
--    manifests with no parcel rows are untouched.
UPDATE public.trip_manifest tm
SET total_parcels_on_board = counts.cnt
FROM (
  SELECT manifest_id, COUNT(*)::int AS cnt
  FROM public.manifest_parcels
  GROUP BY manifest_id
) counts
WHERE counts.manifest_id = tm.id
  AND tm.total_parcels_on_board IS DISTINCT FROM counts.cnt;

-- 3. One row per parcel per manifest, forever.
CREATE UNIQUE INDEX IF NOT EXISTS manifest_parcels_manifest_parcel_unique
  ON public.manifest_parcels (manifest_id, parcel_id);

COMMENT ON INDEX public.manifest_parcels_manifest_parcel_unique IS
  'One manifest_parcels row per parcel per manifest (056). populateManifestDeparture upserts on this key.';

-- -------------------------------------------------------------
-- VERIFY (run manually after applying)
-- -------------------------------------------------------------
-- Must return 0 rows:
-- SELECT manifest_id, parcel_id, count(*)
-- FROM public.manifest_parcels
-- GROUP BY 1, 2 HAVING count(*) > 1;
--
-- Index present:
-- SELECT indexname FROM pg_indexes
-- WHERE tablename = 'manifest_parcels'
--   AND indexname = 'manifest_parcels_manifest_parcel_unique';
--
-- Counters match rows:
-- SELECT tm.id, tm.total_parcels_on_board, count(mp.id)
-- FROM public.trip_manifest tm
-- LEFT JOIN public.manifest_parcels mp ON mp.manifest_id = tm.id
-- GROUP BY tm.id, tm.total_parcels_on_board
-- HAVING tm.total_parcels_on_board <> count(mp.id);

-- -------------------------------------------------------------
-- DOWN (commented — forward-only, do not run)
-- -------------------------------------------------------------
-- DROP INDEX IF EXISTS public.manifest_parcels_manifest_parcel_unique;
