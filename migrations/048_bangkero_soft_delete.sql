-- 048 — Reversible bangkero deletion and active-state enforcement.

ALTER TABLE public.bangkeros
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_was_available BOOLEAN;

ALTER TABLE public.bangkas
  ADD COLUMN IF NOT EXISTS deleted_was_active BOOLEAN;

CREATE INDEX IF NOT EXISTS bangkeros_deleted_updated_idx
  ON public.bangkeros (deleted_at DESC)
  WHERE is_deleted = true;

CREATE OR REPLACE FUNCTION public.admin_delete_bangkero(p_bangkero_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_deleted BOOLEAN;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND user_role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only admins may delete bangkeros.' USING ERRCODE = '42501';
  END IF;

  SELECT is_deleted INTO v_deleted
  FROM public.bangkeros
  WHERE id = p_bangkero_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bangkero not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_deleted THEN
    RAISE EXCEPTION 'Bangkero is already in Deleted Bangkeros.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bookings booking
    WHERE booking.trip_stat IN ('open', 'pending', 'accepted')
      AND (
        booking.operator_id = p_bangkero_id
        OR booking.bangka_id IN (
          SELECT vessel.id FROM public.bangkas vessel
          WHERE vessel.bangkero_id = p_bangkero_id
        )
      )
  ) OR EXISTS (
    SELECT 1
    FROM public.boat_rentals rental
    JOIN public.bangkas vessel ON vessel.id = rental.bangka_id
    WHERE vessel.bangkero_id = p_bangkero_id
      AND rental.status IN ('awaiting_payment', 'pending', 'confirmed')
  ) THEN
    RAISE EXCEPTION 'This bangkero has active bookings or rentals. Complete or cancel them before deleting.'
      USING ERRCODE = '23503';
  END IF;

  UPDATE public.bangkeros
  SET is_deleted = true,
      deleted_at = now(),
      deleted_was_available = is_available,
      is_available = false,
      updated_at = now()
  WHERE id = p_bangkero_id;

  UPDATE public.bangkas
    SET deleted_was_active = is_active,
      is_active = false,
      rental_listed = false
  WHERE bangkero_id = p_bangkero_id;

  UPDATE public.port_queue
  SET left_at = now()
  WHERE bangkero_id = p_bangkero_id AND left_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_restore_bangkero(p_bangkero_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_verification TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND user_role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only admins may restore bangkeros.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.bangkeros
  SET is_deleted = false,
      deleted_at = NULL,
      is_available = COALESCE(deleted_was_available, false) AND v_verification = 'verified',
      deleted_was_available = NULL,
      updated_at = now()
  WHERE id = p_bangkero_id AND is_deleted = true
  RETURNING verification_stat INTO v_verification;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Deleted bangkero not found.' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.bangkas
    SET is_active = COALESCE(deleted_was_active, false) AND v_verification = 'verified',
      deleted_was_active = NULL,
      rental_listed = false
  WHERE bangkero_id = p_bangkero_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_bangkero(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_restore_bangkero(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_bangkero(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_restore_bangkero(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.gates_ok(p_bangkero UUID)
RETURNS BOOLEAN
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (
      SELECT 1 FROM public.bangkeros b
      WHERE b.id = p_bangkero AND b.is_deleted
    )
    AND (
      public.dev_gates_bypass()
      OR (
        EXISTS (
          SELECT 1 FROM public.bangkeros b
          WHERE b.id = p_bangkero
            AND b.verification_stat = 'verified'
            AND NOT b.is_deleted
        )
        AND public.bangkero_rating_ok(p_bangkero)
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.dispatch_eligible(p_bangkero UUID, p_port TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
      SELECT 1 FROM public.port_queue pq
      WHERE pq.bangkero_id = p_bangkero
        AND pq.port_id = p_port
        AND pq.left_at IS NULL
        AND pq.entered_at <= now() - INTERVAL '5 minutes'
    )
    AND EXISTS (
      SELECT 1 FROM public.bangkeros b
      WHERE b.id = p_bangkero
        AND b.is_available
        AND NOT b.is_deleted
    )
    AND EXISTS (
      SELECT 1 FROM public.vessel_tracking vt
      JOIN public.bangkas bk ON bk.id = vt.bangka_id
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
  SELECT EXISTS (
      SELECT 1 FROM public.bangkeros b
      WHERE b.id = p_bangkero AND NOT b.is_deleted
    )
    AND (
      p_service = 'rental'
      OR COALESCE((
        SELECT k.capacity FROM public.bangkas k
        WHERE k.bangkero_id = p_bangkero AND k.is_active
        ORDER BY k.id LIMIT 1
      ), 0) >= p_pax + COALESCE((
        SELECT SUM(b.num_of_passenger) FROM public.bookings b
        WHERE b.operator_id = p_bangkero AND b.trip_stat = 'accepted'
      ), 0)
    );
$$;

CREATE OR REPLACE FUNCTION public.require_active_bangka()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.bangka_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.bangkas vessel
    JOIN public.bangkeros operator ON operator.id = vessel.bangkero_id
    WHERE vessel.id = NEW.bangka_id
      AND vessel.is_active
      AND operator.verification_stat = 'verified'
      AND NOT operator.is_deleted
  ) THEN
    RAISE EXCEPTION 'This vessel is unavailable or its bangkero is not verified.';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.require_active_bangka() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.prevent_bangka_deactivation_in_use()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.is_active IS DISTINCT FROM NEW.is_active AND (
    EXISTS (
      SELECT 1 FROM public.bookings
      WHERE bangka_id = OLD.id AND trip_stat IN ('open', 'pending', 'accepted')
    )
    OR EXISTS (
      SELECT 1 FROM public.boat_rentals
      WHERE bangka_id = OLD.id AND status IN ('awaiting_payment', 'pending', 'confirmed')
    )
  ) THEN
    RAISE EXCEPTION 'This vessel is in use. Complete or cancel its active booking or rental before changing its status.'
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_bangka_deactivation_in_use() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bangkas_prevent_deactivation_in_use ON public.bangkas;
CREATE TRIGGER bangkas_prevent_deactivation_in_use
  BEFORE UPDATE OF is_active ON public.bangkas
  FOR EACH ROW EXECUTE FUNCTION public.prevent_bangka_deactivation_in_use();

DROP TRIGGER IF EXISTS vessel_tracking_require_active_bangka ON public.vessel_tracking;
CREATE TRIGGER vessel_tracking_require_active_bangka
  BEFORE INSERT OR UPDATE OF bangka_id ON public.vessel_tracking
  FOR EACH ROW EXECUTE FUNCTION public.require_active_bangka();

NOTIFY pgrst, 'reload schema';