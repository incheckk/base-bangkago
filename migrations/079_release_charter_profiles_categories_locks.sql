-- =============================================================
-- 079 — ESCROW RELEASE, CHARTER DAY, PROFILE DETAILS,
--       NOTIFICATION KINDS, ROUTE / MODULE LOCKS
--
-- 1. notifications.category — the inbox can color a row by kind.
-- 2. users.age / users.address — the main booker is a passenger too;
--    manifests need the same details companions already carry.
-- 3. downpayments release ledger — the admin pays the held 50% to the
--    operator's GCash QR (or cash) once the trip is completed.
-- 4. boat_rentals.started_at / completed_at — a charter has a real
--    sailing record, not just a status flip.
-- 5. dev_flags.route_lock_bypass — the route lock leaves the FCFS
--    bypass. The module lock (ride / island hop / rental) becomes its
--    own always-on rule.
--
-- Run after 078, in the SQL editor, once.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Notification kinds
-- -------------------------------------------------------------
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'system';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notifications_category_check'
  ) THEN
    ALTER TABLE notifications ADD CONSTRAINT notifications_category_check
      CHECK (category IN ('booking', 'payment', 'cargo', 'safety', 'account', 'system'));
  END IF;
END $$;

-- Old rows were written before the column existed. Tag the obvious ones
-- by their title; anything ambiguous stays 'system'.
UPDATE notifications SET category = 'booking'
 WHERE category = 'system'
   AND (title ILIKE '%booking%' OR title ILIKE '%trip%' OR title ILIKE '%accepted%'
        OR title ILIKE '%confirmed%' OR title ILIKE '%declined%' OR title ILIKE '%sailing%');
UPDATE notifications SET category = 'payment'
 WHERE category = 'system'
   AND (title ILIKE '%payment%' OR title ILIKE '%downpayment%' OR title ILIKE '%paid%'
        OR title ILIKE '%fare%' OR title ILIKE '%released%');
UPDATE notifications SET category = 'cargo'
 WHERE category = 'system'
   AND (title ILIKE '%parcel%' OR title ILIKE '%cargo%' OR title ILIKE '%batch%'
        OR title ILIKE '%padala%');
UPDATE notifications SET category = 'safety'
 WHERE category = 'system'
   AND (title ILIKE '%sos%' OR title ILIKE '%safety%' OR title ILIKE '%alert%'
        OR title ILIKE '%advisory%');

-- -------------------------------------------------------------
-- 2. Main-booker details
-- -------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS age INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS address TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_age_check'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_age_check CHECK (age IS NULL OR age BETWEEN 1 AND 120);
  END IF;
END $$;

-- A bangkero already sees the booker's name/phone on the booking row but
-- cannot SELECT the booker's users row (only own / admin / rental party
-- since 018), so age + address would read null. Helper keeps the policy
-- a leaf predicate — 018's recursion lesson.
CREATE OR REPLACE FUNCTION public.is_booking_operator(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.operator_id = auth.uid() AND b.user_id = p_user_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_booking_operator(uuid) TO authenticated;

DROP POLICY IF EXISTS "users_select_booking_operator" ON public.users;
CREATE POLICY "users_select_booking_operator" ON public.users
  FOR SELECT TO authenticated
  USING (public.is_booking_operator(id));

-- -------------------------------------------------------------
-- 3. Downpayment release ledger
-- -------------------------------------------------------------
ALTER TABLE downpayments ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ;
ALTER TABLE downpayments ADD COLUMN IF NOT EXISTS released_to UUID REFERENCES users(id);
ALTER TABLE downpayments ADD COLUMN IF NOT EXISTS payout_method TEXT;
ALTER TABLE downpayments ADD COLUMN IF NOT EXISTS payout_ref TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'downpayments_payout_method_check'
  ) THEN
    ALTER TABLE downpayments ADD CONSTRAINT downpayments_payout_method_check
      CHECK (payout_method IS NULL OR payout_method IN ('gcash', 'cash'));
  END IF;
END $$;

-- Admin-only. Refuses until the trip/rental is completed, refuses a
-- GCash release when the operator has no QR on file, and stamps the
-- operator server-side (the client never chooses who gets paid).
CREATE OR REPLACE FUNCTION release_downpayment(
  p_downpayment_id UUID,
  p_method TEXT,
  p_ref TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v downpayments%ROWTYPE;
  v_operator UUID;
  v_done BOOLEAN := false;
  v_qr TEXT;
  v_label TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin'
  ) THEN
    RAISE EXCEPTION 'admins only';
  END IF;
  IF p_method NOT IN ('gcash', 'cash') THEN
    RAISE EXCEPTION 'choose GCash or cash';
  END IF;

  SELECT * INTO v FROM downpayments WHERE id = p_downpayment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'downpayment not found';
  END IF;
  IF v.status <> 'approved' THEN
    RAISE EXCEPTION 'only an approved downpayment can be released';
  END IF;
  IF v.released_at IS NOT NULL THEN
    RAISE EXCEPTION 'this downpayment was already released';
  END IF;

  IF v.booking_id IS NOT NULL THEN
    SELECT b.operator_id, (b.trip_stat = 'completed'), b.ref
      INTO v_operator, v_done, v_label
      FROM bookings b WHERE b.id = v.booking_id;
  ELSIF v.boat_rental_id IS NOT NULL THEN
    SELECT bk.bangkero_id, (r.status = 'completed'), COALESCE(r.event_name, 'Boat rental')
      INTO v_operator, v_done, v_label
      FROM boat_rentals r
      JOIN bangkas bk ON bk.id = r.bangka_id
      WHERE r.id = v.boat_rental_id;
  END IF;

  IF v_operator IS NULL THEN
    RAISE EXCEPTION 'no operator on this booking';
  END IF;
  IF NOT v_done THEN
    RAISE EXCEPTION 'the trip must be completed before this downpayment is released';
  END IF;

  IF p_method = 'gcash' THEN
    SELECT gcash_qr_url INTO v_qr FROM bangkeros WHERE id = v_operator;
    IF v_qr IS NULL THEN
      RAISE EXCEPTION 'this bangkero has no GCash QR on file — release as cash instead';
    END IF;
  END IF;

  UPDATE downpayments
     SET released_at = now(),
         released_to = v_operator,
         payout_method = p_method,
         payout_ref = NULLIF(trim(COALESCE(p_ref, '')), '')
   WHERE id = v.id;

  INSERT INTO notifications (user_id, title, message, category)
  VALUES (
    v_operator,
    'Downpayment released',
    '₱' || trim(to_char(v.amount, 'FM999,999,990.00')) || ' for ' || v_label ||
      ' was released to you via ' ||
      CASE p_method WHEN 'gcash' THEN 'GCash' ELSE 'cash' END || '.',
    'payment'
  );
END;
$$;

REVOKE ALL ON FUNCTION release_downpayment(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION release_downpayment(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION release_downpayment(UUID, TEXT, TEXT) TO service_role;

-- -------------------------------------------------------------
-- 4. Charter sailing record
-- -------------------------------------------------------------
ALTER TABLE boat_rentals ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE boat_rentals ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- -------------------------------------------------------------
-- 5. Route lock leaves FCFS; module lock is its own rule
-- -------------------------------------------------------------
ALTER TABLE dev_flags ADD COLUMN IF NOT EXISTS route_lock_bypass BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION dev_route_lock_bypass()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT route_lock_bypass FROM dev_flags WHERE id = 1),
    false
  );
$$;

CREATE OR REPLACE FUNCTION set_route_lock_bypass(p_on BOOLEAN)
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
  UPDATE dev_flags SET route_lock_bypass = p_on WHERE id = 1;
END;
$$;

REVOKE ALL ON FUNCTION dev_route_lock_bypass() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION dev_route_lock_bypass() TO authenticated, service_role;
REVOKE ALL ON FUNCTION set_route_lock_bypass(BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_route_lock_bypass(BOOLEAN) TO authenticated, service_role;

-- The FCFS switch still lifts queue/dwell/GPS/capacity; the route lock
-- now has its own switch, so the two never drag each other along.
CREATE OR REPLACE FUNCTION route_ok(p_bangkero UUID, p_dest TEXT)
RETURNS BOOLEAN AS $$
  SELECT dev_route_lock_bypass()
    OR NOT EXISTS (
      SELECT 1 FROM bookings b
      JOIN routes r ON r.id = b.route_id
      WHERE b.operator_id = p_bangkero
        AND b.trip_stat = 'accepted'
        AND r.end_port_id <> p_dest
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Module lock: one service per boat per sailing day. A ride cannot take
-- an island hop (or the reverse), and a live charter holds the whole
-- day. Same module + same route stays open — that is how a boat fills.
CREATE OR REPLACE FUNCTION module_lock_ok(
  p_bangkero UUID,
  p_is_package BOOLEAN,
  p_day DATE,
  p_ignore UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.operator_id = p_bangkero
      AND b.trip_stat = 'accepted'
      AND b.id IS DISTINCT FROM p_ignore
      AND COALESCE(b.scheduled_date, (now() AT TIME ZONE 'Asia/Manila')::date) = p_day
      AND (b.package_id IS NOT NULL) IS DISTINCT FROM p_is_package
  )
  AND NOT EXISTS (
    SELECT 1
    FROM boat_rentals r
    JOIN bangkas bk ON bk.id = r.bangka_id
    WHERE bk.bangkero_id = p_bangkero
      AND r.rental_date = p_day
      AND r.status IN ('awaiting_payment', 'pending', 'confirmed')
  );
$$;

REVOKE ALL ON FUNCTION module_lock_ok(UUID, BOOLEAN, DATE, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION module_lock_ok(UUID, BOOLEAN, DATE, UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION enforce_module_lock()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_day DATE;
BEGIN
  IF NEW.operator_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Same group = the same trip (piggyback stub on an island-hop carrier)
  -- and the first accepted member already set the module.
  IF NEW.group_booking_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM bookings g
    WHERE g.group_booking_id = NEW.group_booking_id
      AND g.trip_stat = 'accepted'
      AND g.id IS DISTINCT FROM NEW.id
  ) THEN
    RETURN NEW;
  END IF;

  -- Serialize accepts per boat so two taps on different modules cannot
  -- both pass before either row is visible.
  PERFORM pg_advisory_xact_lock(hashtext('module_lock:' || NEW.operator_id::text));

  v_day := COALESCE(NEW.scheduled_date, (now() AT TIME ZONE 'Asia/Manila')::date);
  IF NOT module_lock_ok(NEW.operator_id, NEW.package_id IS NOT NULL, v_day, NEW.id) THEN
    RAISE EXCEPTION 'you already accepted a different service for this sailing day';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bookings_module_lock ON bookings;
CREATE TRIGGER trg_bookings_module_lock
  BEFORE UPDATE OF trip_stat ON bookings
  FOR EACH ROW
  WHEN (NEW.trip_stat = 'accepted' AND OLD.trip_stat IS DISTINCT FROM 'accepted')
  EXECUTE FUNCTION enforce_module_lock();

REVOKE ALL ON FUNCTION enforce_module_lock() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION enforce_module_lock() TO authenticated, service_role;

-- =============================================================
-- DONE.
--
-- Verify:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'notifications' AND column_name = 'category';
--   SELECT age, address FROM users WHERE id = auth.uid();
--   SELECT * FROM dev_flags;              -- route_lock_bypass = false
--   SELECT dev_route_lock_bypass();       -- false
--   SELECT module_lock_ok(auth.uid(), false, current_date);
-- =============================================================
