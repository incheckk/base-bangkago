-- =============================================================
-- 083 -- RBAC matrix alignment
--
-- Closes the remaining role gaps found in the feature audit:
--
--   1. demand_predictions was readable by every signed-in account.
--      Only Admin, Bangkero, and Coast Guard/LGU may read forecasts.
--   2. passenger_details had SELECT/INSERT but no UPDATE policy, so
--      the "manage passenger list" feature could not edit a companion.
--      Add owner/operator/admin UPDATE policies plus a guard trigger
--      that keeps ownership, QR tokens, and boarding status safe.
--   3. Removing a companion is not a raw DELETE: the booking's pax
--      count and fare must move together, and a boarded/paid booking
--      must not lose a passenger. remove_passenger_detail() does that
--      atomically for rides and charters.
--   4. Admin and Coast Guard need an inbox. Booking lifecycle events
--      now fan out notifications to both operations roles.
--
-- Admin's INSERT into safety_alerts is intentional (manage-alerts.html)
-- and is deliberately left unchanged.
--
-- Run after 082, in the SQL editor, once. Idempotent.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Demand forecasts: operations roles only
-- -------------------------------------------------------------
DROP POLICY IF EXISTS "demand_predictions_select_all" ON demand_predictions;
DROP POLICY IF EXISTS "demand_predictions_select_ops" ON demand_predictions;

CREATE POLICY "demand_predictions_select_ops" ON demand_predictions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid()
        AND user_role IN ('admin', 'bangkero', 'coastguard')
    )
  );

-- -------------------------------------------------------------
-- 2. Passenger details: owner / operator / admin can edit
-- -------------------------------------------------------------
DROP POLICY IF EXISTS "passenger_details_update_own" ON passenger_details;
CREATE POLICY "passenger_details_update_own" ON passenger_details
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.id = booking_id AND b.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM boat_rentals r
      WHERE r.id = boat_rental_id AND r.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.id = booking_id AND b.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM boat_rentals r
      WHERE r.id = boat_rental_id AND r.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "passenger_details_update_operator" ON passenger_details;
CREATE POLICY "passenger_details_update_operator" ON passenger_details
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.id = booking_id AND b.operator_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM boat_rentals r
      JOIN bangkas bk ON bk.id = r.bangka_id
      WHERE r.id = boat_rental_id AND bk.bangkero_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.id = booking_id AND b.operator_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM boat_rentals r
      JOIN bangkas bk ON bk.id = r.bangka_id
      WHERE r.id = boat_rental_id AND bk.bangkero_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "passenger_details_update_admin" ON passenger_details;
CREATE POLICY "passenger_details_update_admin" ON passenger_details
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin'
    )
  );

-- A passenger may correct their own details, but only the operator or an
-- admin may flip boarding/no-show flags. Ownership and QR tokens are
-- immutable for everyone. Detail edits stop at departure; boarding flags
-- stay writable during the trip (081's charter tick uses this path).
CREATE OR REPLACE FUNCTION public.guard_passenger_detail_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_is_admin BOOLEAN := false;
  v_is_operator BOOLEAN := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT user_role INTO v_role FROM public.users WHERE id = v_uid;
  v_is_admin := (v_role = 'admin');

  IF NEW.booking_id IS DISTINCT FROM OLD.booking_id
     OR NEW.boat_rental_id IS DISTINCT FROM OLD.boat_rental_id THEN
    RAISE EXCEPTION 'A passenger cannot be moved to another booking.';
  END IF;

  IF NEW.qr_token IS DISTINCT FROM OLD.qr_token THEN
    RAISE EXCEPTION 'The boarding QR cannot be edited.';
  END IF;

  IF NEW.boarded_at IS DISTINCT FROM OLD.boarded_at
     OR NEW.no_show_at IS DISTINCT FROM OLD.no_show_at THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.bookings b
      WHERE b.id = OLD.booking_id AND b.operator_id = v_uid
      UNION ALL
      SELECT 1
      FROM public.boat_rentals r
      JOIN public.bangkas k ON k.id = r.bangka_id
      WHERE r.id = OLD.boat_rental_id AND k.bangkero_id = v_uid
    ) INTO v_is_operator;

    IF NOT v_is_admin AND NOT v_is_operator THEN
      RAISE EXCEPTION 'Only the operator can change boarding status.';
    END IF;
  ELSE
    -- Ordinary detail edit: refuse once the trip/boarding has started.
    IF NOT v_is_admin THEN
      IF OLD.booking_id IS NOT NULL THEN
        IF EXISTS (
          SELECT 1
          FROM public.bookings b
          WHERE b.id = OLD.booking_id
            AND (
              b.trip_stat IN ('completed', 'cancelled')
              OR b.depart_time IS NOT NULL
              OR b.onboarded_at IS NOT NULL
            )
        ) OR OLD.boarded_at IS NOT NULL OR OLD.no_show_at IS NOT NULL THEN
          RAISE EXCEPTION 'Passenger details cannot be edited after boarding or departure.';
        END IF;
      ELSE
        IF EXISTS (
          SELECT 1
          FROM public.boat_rentals r
          WHERE r.id = OLD.boat_rental_id
            AND (
              r.status IN ('completed', 'cancelled')
              OR r.started_at IS NOT NULL
              OR r.completed_at IS NOT NULL
            )
        ) OR OLD.boarded_at IS NOT NULL OR OLD.no_show_at IS NOT NULL THEN
          RAISE EXCEPTION 'Passenger details cannot be edited after boarding or departure.';
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_passenger_details_guard_update ON passenger_details;
CREATE TRIGGER trg_passenger_details_guard_update
  BEFORE UPDATE ON passenger_details
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_passenger_detail_update();

REVOKE ALL ON FUNCTION public.guard_passenger_detail_update() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guard_passenger_detail_update() TO authenticated, service_role;

-- -------------------------------------------------------------
-- 3. Atomic companion removal
-- -------------------------------------------------------------
-- The owner, the assigned operator, and an admin may remove a companion.
-- The row, bookings.num_of_passenger, and the fare (for a plain passenger
-- ride) move together. Refuse after boarding/departure, after any payment
-- was completed/refunded, or once a downpayment was filed. Charters have
-- a fixed whole-boat fare, so only the roster row goes.
CREATE OR REPLACE FUNCTION public.remove_passenger_detail(p_passenger_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_row passenger_details%ROWTYPE;
  v_booking bookings%ROWTYPE;
  v_rental boat_rentals%ROWTYPE;
  v_role TEXT;
  v_is_admin BOOLEAN := false;
  v_new_count INTEGER;
  v_new_total NUMERIC(10, 2);
  v_route routes%ROWTYPE;
  v_advance BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_row
  FROM passenger_details
  WHERE id = p_passenger_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Passenger not found.';
  END IF;

  SELECT user_role INTO v_role FROM users WHERE id = v_uid;
  v_is_admin := (v_role = 'admin');

  IF v_row.booking_id IS NOT NULL THEN
    SELECT * INTO v_booking
    FROM bookings
    WHERE id = v_row.booking_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Booking not found.';
    END IF;

    IF NOT v_is_admin
       AND v_booking.user_id IS DISTINCT FROM v_uid
       AND v_booking.operator_id IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'You cannot change this passenger list.';
    END IF;

    IF v_booking.trip_stat IN ('completed', 'cancelled')
       OR v_booking.depart_time IS NOT NULL
       OR v_booking.onboarded_at IS NOT NULL
       OR v_row.boarded_at IS NOT NULL
       OR v_row.no_show_at IS NOT NULL THEN
      RAISE EXCEPTION 'Passengers cannot be removed after boarding or departure.';
    END IF;

    IF v_booking.num_of_passenger <= 1 THEN
      RAISE EXCEPTION 'A booking must keep at least one passenger.';
    END IF;

    IF EXISTS (
      SELECT 1 FROM downpayments
      WHERE booking_id = v_booking.id
        AND status IN ('pending', 'approved')
    ) THEN
      RAISE EXCEPTION 'A downpayment has already been filed for this booking; settle it before changing the passenger list.';
    END IF;

    IF EXISTS (
      SELECT 1 FROM payments
      WHERE booking_id = v_booking.id
        AND payment_status IN ('completed', 'refunded')
    ) THEN
      RAISE EXCEPTION 'The fare has already been paid; the passenger list is locked.';
    END IF;

    DELETE FROM passenger_details WHERE id = p_passenger_id;

    v_new_count := v_booking.num_of_passenger - 1;
    UPDATE bookings
    SET num_of_passenger = v_new_count
    WHERE id = v_booking.id;

    -- Plain rides are priced per seat. Packages and charters are not.
    IF v_booking.service_type = 'passenger' AND v_booking.package_id IS NULL THEN
      SELECT * INTO v_route FROM routes WHERE id = v_booking.route_id;
      IF FOUND AND v_route.base_fare IS NOT NULL THEN
        v_new_total := round(v_route.base_fare * v_new_count, 2);
        UPDATE bookings
        SET total_price = v_new_total
        WHERE id = v_booking.id;

        v_advance := v_booking.scheduled_date IS NOT NULL
          AND v_booking.scheduled_date > (now() AT TIME ZONE 'Asia/Manila')::date;

        -- Keep the single pending onboard-fare row in step. Advance
        -- bookings record only the remainder after the 50% escrow.
        UPDATE payments
        SET amount = CASE
          WHEN v_advance THEN round(v_new_total / 2, 2)
          ELSE v_new_total
        END
        WHERE booking_id = v_booking.id
          AND payment_status = 'pending';
      END IF;
    END IF;

    RETURN;
  END IF;

  SELECT * INTO v_rental
  FROM boat_rentals
  WHERE id = v_row.boat_rental_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Charter not found.';
  END IF;

  IF NOT v_is_admin
     AND v_rental.user_id IS DISTINCT FROM v_uid
     AND NOT EXISTS (
       SELECT 1
       FROM bangkas bk
       WHERE bk.id = v_rental.bangka_id AND bk.bangkero_id = v_uid
     ) THEN
    RAISE EXCEPTION 'You cannot change this charter passenger list.';
  END IF;

  IF v_rental.status IN ('completed', 'cancelled')
     OR v_rental.started_at IS NOT NULL
     OR v_rental.completed_at IS NOT NULL
     OR v_row.boarded_at IS NOT NULL
     OR v_row.no_show_at IS NOT NULL THEN
    RAISE EXCEPTION 'Passengers cannot be removed after boarding or departure.';
  END IF;

  DELETE FROM passenger_details WHERE id = p_passenger_id;
END;
$$;

REVOKE ALL ON FUNCTION public.remove_passenger_detail(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_passenger_detail(UUID) TO authenticated, service_role;

-- -------------------------------------------------------------
-- 4. Operations inbox: booking lifecycle fan-out
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_ops_booking_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title TEXT;
  v_message TEXT;
  v_when TEXT;
BEGIN
  v_when := COALESCE(to_char(NEW.scheduled_date, 'Mon DD'), 'today');
  IF NEW.scheduled_time IS NOT NULL THEN
    v_when := v_when || ' ' || NEW.scheduled_time;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_title := 'New booking ' || NEW.ref;
    v_message := COALESCE(NEW.passenger_name, 'A passenger') || ': ' ||
      COALESCE(NEW.from_port_name, 'origin') || ' -> ' ||
      COALESCE(NEW.to_port_name, 'destination') || ' on ' || v_when || '.';
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.trip_stat IS DISTINCT FROM OLD.trip_stat THEN
      IF NEW.trip_stat = 'accepted' THEN
        v_title := 'Booking accepted ' || NEW.ref;
        v_message := COALESCE(NEW.operator_name, 'A bangkero') || ' accepted ' ||
          COALESCE(NEW.passenger_name, 'a passenger') || ' for ' ||
          COALESCE(NEW.from_port_name, 'origin') || ' -> ' ||
          COALESCE(NEW.to_port_name, 'destination') || ' on ' || v_when || '.';
      ELSIF NEW.trip_stat = 'completed' THEN
        v_title := 'Trip completed ' || NEW.ref;
        v_message := COALESCE(NEW.operator_name, 'A bangkero') || ' completed ' ||
          COALESCE(NEW.from_port_name, 'origin') || ' -> ' ||
          COALESCE(NEW.to_port_name, 'destination') || '.';
      ELSIF NEW.trip_stat = 'cancelled' THEN
        v_title := 'Booking cancelled ' || NEW.ref;
        v_message := COALESCE(NEW.passenger_name, 'A passenger') || ' cancelled ' ||
          COALESCE(NEW.from_port_name, 'origin') || ' -> ' ||
          COALESCE(NEW.to_port_name, 'destination') || '.';
        IF NEW.cancel_reason IS NOT NULL AND btrim(NEW.cancel_reason) <> '' THEN
          v_message := v_message || ' Reason: ' || NEW.cancel_reason;
        END IF;
      ELSE
        RETURN NEW;
      END IF;
    ELSIF NEW.depart_time IS DISTINCT FROM OLD.depart_time
          AND NEW.depart_time IS NOT NULL THEN
      v_title := 'Trip departed ' || NEW.ref;
      v_message := COALESCE(NEW.operator_name, 'A bangkero') || ' departed ' ||
        COALESCE(NEW.from_port_name, 'origin') || ' -> ' ||
        COALESCE(NEW.to_port_name, 'destination') || ' on ' || v_when || '.';
    ELSIF NEW.onboarded_at IS DISTINCT FROM OLD.onboarded_at
          AND NEW.onboarded_at IS NOT NULL THEN
      v_title := 'Passengers boarded ' || NEW.ref;
      v_message := COALESCE(NEW.passenger_name, 'A passenger') || ' is aboard for ' ||
        COALESCE(NEW.from_port_name, 'origin') || ' -> ' ||
        COALESCE(NEW.to_port_name, 'destination') || ' on ' || v_when || '.';
    ELSE
      RETURN NEW;
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (user_id, title, message, category)
  SELECT u.id, v_title, v_message, 'booking'
  FROM public.users u
  WHERE u.user_role IN ('admin', 'coastguard');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bookings_ops_notify ON bookings;
CREATE TRIGGER trg_bookings_ops_notify
  AFTER INSERT OR UPDATE OF trip_stat, depart_time, onboarded_at ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_ops_booking_event();

REVOKE ALL ON FUNCTION public.notify_ops_booking_event() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notify_ops_booking_event() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
