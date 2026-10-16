-- =============================================================
-- 041. CROSSING SCHEDULE (Parcel Padala Phase 1)
-- =============================================================
-- Why: Mode 3a (batched) holds parcels for a scheduled crossing
-- instead of an immediate sail. This adds the timetable that
-- batching assigns parcels to.
--
-- Safe to re-run (table + index are IF NOT EXISTS; seeds are
-- ON CONFLICT DO NOTHING). Run manually after 040.
-- Does NOT touch 002/017/021/032-040.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.crossing_times (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id TEXT NOT NULL REFERENCES public.routes(id),
  departure_time TIME NOT NULL,
  days_of_week INTEGER[] NOT NULL DEFAULT ARRAY[1,2,3,4,5,6,7],
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT crossing_times_route_time_unique UNIQUE (route_id, departure_time)
);

INSERT INTO public.crossing_times (route_id, departure_time)
SELECT id, '08:00'::TIME FROM public.routes
ON CONFLICT (route_id, departure_time) DO NOTHING;

INSERT INTO public.crossing_times (route_id, departure_time)
SELECT id, '12:00'::TIME FROM public.routes
ON CONFLICT (route_id, departure_time) DO NOTHING;

INSERT INTO public.crossing_times (route_id, departure_time)
SELECT id, '16:00'::TIME FROM public.routes
ON CONFLICT (route_id, departure_time) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_crossing_times_active
  ON public.crossing_times (route_id, departure_time) WHERE is_active = true;

COMMENT ON TABLE public.crossing_times IS 'Parcel Padala Phase 1 (041): scheduled crossings for batched delivery.';
COMMENT ON COLUMN public.crossing_times.route_id IS 'FK to routes(id); one row per route per departure time.';
COMMENT ON COLUMN public.crossing_times.departure_time IS 'Daily sailing time for the batched crossing.';
COMMENT ON COLUMN public.crossing_times.days_of_week IS 'ISO days 1=Mon..7=Sun; default runs daily.';
COMMENT ON COLUMN public.crossing_times.is_active IS 'Inactive rows are ignored by batch assignment.';

-- DOWN (commented, run manually if a rollback is ever needed):
-- DROP INDEX IF EXISTS public.idx_crossing_times_active;
-- DROP TABLE IF EXISTS public.crossing_times;
