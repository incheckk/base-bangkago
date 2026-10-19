-- 049 — Reversible Bangka deletion with history and Bangkero-state preservation.

ALTER TABLE public.bangkas
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_was_active BOOLEAN;

CREATE INDEX IF NOT EXISTS bangkas_deleted_updated_idx
  ON public.bangkas (deleted_at DESC)
  WHERE is_deleted = true;

CREATE OR REPLACE FUNCTION public.admin_delete_bangka(p_bangka_id UUID)
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
    RAISE EXCEPTION 'Only admins may delete bangkas.' USING ERRCODE = '42501';
  END IF;

  SELECT is_deleted INTO v_deleted
  FROM public.bangkas
  WHERE id = p_bangka_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bangka not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_deleted THEN
    RAISE EXCEPTION 'Bangka is already in Deleted Bangkas.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bookings
    WHERE bangka_id = p_bangka_id AND trip_stat IN ('open', 'pending', 'accepted')
  ) OR EXISTS (
    SELECT 1 FROM public.boat_rentals
    WHERE bangka_id = p_bangka_id AND status IN ('awaiting_payment', 'pending', 'confirmed')
  ) THEN
    RAISE EXCEPTION 'This Bangka is in use. Complete or cancel active bookings and rentals before deleting it.'
      USING ERRCODE = '23503';
  END IF;

  UPDATE public.bangkas
  SET deleted_was_active = COALESCE(deleted_was_active, is_active),
      is_deleted = true,
      deleted_at = now(),
      is_active = false,
      rental_listed = false
  WHERE id = p_bangka_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_restore_bangka(p_bangka_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_is_deleted BOOLEAN;
  v_was_active BOOLEAN;
  v_verification TEXT;
  v_operator_deleted BOOLEAN;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND user_role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only admins may restore bangkas.' USING ERRCODE = '42501';
  END IF;

  SELECT vessel.is_deleted,
         vessel.deleted_was_active,
         operator.verification_stat,
         operator.is_deleted
  INTO v_is_deleted, v_was_active, v_verification, v_operator_deleted
  FROM public.bangkas vessel
  LEFT JOIN public.bangkeros operator ON operator.id = vessel.bangkero_id
  WHERE vessel.id = p_bangka_id
  FOR UPDATE OF vessel;

  IF NOT FOUND OR NOT v_is_deleted THEN
    RAISE EXCEPTION 'Deleted Bangka not found.' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.bangkas
  SET is_deleted = false,
      deleted_at = NULL,
      is_active = COALESCE(v_was_active, false)
        AND v_verification = 'verified'
        AND NOT COALESCE(v_operator_deleted, true),
      deleted_was_active = CASE
        WHEN COALESCE(v_operator_deleted, true) THEN v_was_active
        ELSE NULL
      END,
      rental_listed = false
  WHERE id = p_bangka_id;
END;
$$;

-- Replace 048's version so Bangkero restore never reactivates a separately deleted Bangka.
CREATE OR REPLACE FUNCTION public.admin_restore_bangkero(p_bangkero_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_verification TEXT;
  v_was_available BOOLEAN;
  v_is_deleted BOOLEAN;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND user_role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only admins may restore bangkeros.' USING ERRCODE = '42501';
  END IF;

  SELECT verification_stat, deleted_was_available, is_deleted
  INTO v_verification, v_was_available, v_is_deleted
  FROM public.bangkeros
  WHERE id = p_bangkero_id
  FOR UPDATE;
  IF NOT FOUND OR NOT v_is_deleted THEN
    RAISE EXCEPTION 'Deleted bangkero not found.' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.bangkeros
  SET is_deleted = false,
      deleted_at = NULL,
      is_available = COALESCE(v_was_available, false) AND v_verification = 'verified',
      deleted_was_available = NULL,
      updated_at = now()
  WHERE id = p_bangkero_id;

  UPDATE public.bangkas
  SET is_active = COALESCE(deleted_was_active, false) AND v_verification = 'verified',
      deleted_was_active = NULL
  WHERE bangkero_id = p_bangkero_id AND NOT is_deleted;
END;
$$;

-- Preserve an earlier Bangka active-state snapshot if the operator is deleted too.
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
      AND (booking.operator_id = p_bangkero_id OR booking.bangka_id IN (
        SELECT vessel.id FROM public.bangkas vessel WHERE vessel.bangkero_id = p_bangkero_id
      ))
  ) OR EXISTS (
    SELECT 1 FROM public.boat_rentals rental
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
  SET deleted_was_active = COALESCE(deleted_was_active, is_active),
      is_active = false,
      rental_listed = false
  WHERE bangkero_id = p_bangkero_id AND NOT is_deleted;

  UPDATE public.port_queue
  SET left_at = now()
  WHERE bangkero_id = p_bangkero_id AND left_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_bangka(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_restore_bangka(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_bangka(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_restore_bangka(UUID) TO authenticated;

-- Deleted vessels remain unusable even if a stale client tries to create an assignment.
CREATE OR REPLACE FUNCTION public.require_active_bangka()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.bangka_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.bangkas vessel
    JOIN public.bangkeros operator ON operator.id = vessel.bangkero_id
    WHERE vessel.id = NEW.bangka_id
      AND vessel.is_active
      AND NOT vessel.is_deleted
      AND operator.verification_stat = 'verified'
      AND NOT operator.is_deleted
  ) THEN
    RAISE EXCEPTION 'This vessel is unavailable or its bangkero is not verified.';
  END IF;
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';