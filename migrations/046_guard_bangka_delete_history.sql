-- 046 — Prevent vessel deletion from removing or orphaning operational history.

CREATE OR REPLACE FUNCTION public.prevent_bangka_delete_with_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.bookings WHERE bangka_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.boat_rentals WHERE bangka_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.safety_alerts WHERE bangka_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.trip_manifest WHERE bangka_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.vessel_tracking WHERE bangka_id = OLD.id)
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'This vessel has linked bookings, rentals, alerts, manifests, or tracking history. Deactivate it to preserve those records.';
  END IF;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_bangka_delete_with_history() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bangkas_preserve_history_before_delete ON public.bangkas;
CREATE TRIGGER bangkas_preserve_history_before_delete
  BEFORE DELETE ON public.bangkas
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_bangka_delete_with_history();