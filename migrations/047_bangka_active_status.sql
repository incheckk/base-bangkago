-- 047 — Add an admin-controlled vessel availability state.

ALTER TABLE public.bangkas
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

UPDATE public.bangkas
SET is_active = false, rental_listed = false
WHERE bangkero_id IS NULL;

CREATE OR REPLACE FUNCTION public.dispatch_eligible(p_bangkero UUID, p_port TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
      SELECT 1 FROM port_queue pq
      WHERE pq.bangkero_id = p_bangkero
        AND pq.port_id = p_port
        AND pq.left_at IS NULL
        AND pq.entered_at <= now() - INTERVAL '5 minutes'
    )
    AND EXISTS (
      SELECT 1 FROM bangkeros b
      WHERE b.id = p_bangkero AND b.is_available
    )
    AND EXISTS (
      SELECT 1 FROM vessel_tracking vt
      JOIN bangkas bk ON bk.id = vt.bangka_id
      WHERE bk.bangkero_id = p_bangkero
        AND bk.is_active
        AND vt.recorded_at > now() - INTERVAL '3 minutes'
    );
$$;

CREATE OR REPLACE FUNCTION public.fits_booking(p_bangkero UUID, p_service TEXT, p_pax INT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_service = 'rental'
    OR COALESCE((
      SELECT k.capacity FROM bangkas k
      WHERE k.bangkero_id = p_bangkero
        AND k.is_active
      ORDER BY k.id LIMIT 1
    ), 0) >= p_pax + COALESCE((
      SELECT SUM(b.num_of_passenger) FROM bookings b
      WHERE b.operator_id = p_bangkero AND b.trip_stat = 'accepted'
    ), 0);
$$;

CREATE OR REPLACE FUNCTION public.require_active_bangka()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.bangka_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.bangkas
    WHERE id = NEW.bangka_id AND is_active
  ) THEN
    RAISE EXCEPTION 'This vessel is unavailable.';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.require_active_bangka() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bookings_require_active_bangka ON public.bookings;
CREATE TRIGGER bookings_require_active_bangka
  BEFORE INSERT OR UPDATE OF bangka_id ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.require_active_bangka();

DROP TRIGGER IF EXISTS boat_rentals_require_active_bangka ON public.boat_rentals;
CREATE TRIGGER boat_rentals_require_active_bangka
  BEFORE INSERT OR UPDATE OF bangka_id ON public.boat_rentals
  FOR EACH ROW EXECUTE FUNCTION public.require_active_bangka();