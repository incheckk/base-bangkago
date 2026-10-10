-- =============================================================
-- 031 — DAY-CONFLICT RACE + COVERAGE FIX (audit #22)
--
-- 027's trigger was an EXISTS check with no mutual exclusion: two
-- concurrent accepts for the same operator/day both pass the check
-- before either commits, so both land. This fix:
--
--   1. Takes a transaction-scoped advisory lock on (operator, day)
--      BEFORE the check — same-day writers serialize, the second one
--      sees the first one's committed row and raises. The lock
--      auto-releases at commit/rollback (no stale locks, no cleanup).
--   2. Makes the check function SECURITY DEFINER (defense in depth —
--      the scan must see every row regardless of the writer's RLS).
--   3. Fires the bookings trigger on operator_id reassignment too:
--      moving an already-accepted booking onto another operator never
--      re-ran the check (UPDATE OF trip_stat only).
--
-- Deliberately unchanged: `awaiting_payment` charters still count as
-- committed days (the "one committed day" rule from 027 — relaxing it
-- is a product call, not a bugfix). Rental triggers are untouched; they
-- call this function by name and pick the fix up automatically.
--
-- Run manually in the SQL editor after 030.
-- =============================================================

CREATE OR REPLACE FUNCTION enforce_bangkero_day_free()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_bangkero UUID;
  v_day DATE;
BEGIN
  IF TG_TABLE_NAME = 'bookings' THEN
    v_bangkero := NEW.operator_id;
    v_day := COALESCE(NEW.scheduled_date, (now() AT TIME ZONE 'Asia/Manila')::date);
  ELSE
    SELECT bk.bangkero_id INTO v_bangkero
    FROM bangkas bk WHERE bk.id = NEW.bangka_id;
    v_day := NEW.rental_date;
  END IF;

  -- Serialize same-operator same-day writers. Without this, two
  -- concurrent transactions both run has_day_conflict before either
  -- commits and both pass — the check is correct but not atomic.
  IF v_bangkero IS NOT NULL AND v_day IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtext('bangkero_day_conflict'),
      hashtext(v_bangkero::text || ':' || v_day::text)
    );
  END IF;

  IF TG_TABLE_NAME = 'bookings' THEN
    IF has_day_conflict(v_bangkero, v_day, NEW.id, NULL) THEN
      RAISE EXCEPTION 'You already have a booking or charter scheduled on that date.';
    END IF;
  ELSE
    IF has_day_conflict(v_bangkero, v_day, NULL, NEW.id) THEN
      RAISE EXCEPTION 'That date is already booked for this boat''s operator.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION enforce_bangkero_day_free() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION enforce_bangkero_day_free() TO authenticated;
GRANT EXECUTE ON FUNCTION enforce_bangkero_day_free() TO service_role;

-- Reassignment coverage: an accepted trip moved onto another operator
-- must pass the day check for its NEW owner.
DROP TRIGGER IF EXISTS trg_bookings_day_conflict ON bookings;
CREATE TRIGGER trg_bookings_day_conflict
  BEFORE UPDATE OF trip_stat, operator_id ON bookings
  FOR EACH ROW
  WHEN (NEW.trip_stat = 'accepted'
        AND (OLD.trip_stat IS DISTINCT FROM 'accepted'
             OR OLD.operator_id IS DISTINCT FROM NEW.operator_id))
  EXECUTE FUNCTION enforce_bangkero_day_free();

-- =============================================================
-- DONE.
--
-- Verify:
--   -- reassignment onto a busy operator must raise:
--   UPDATE bookings SET operator_id = '<busy bangkero>'
--    WHERE id = '<accepted booking of another bangkero same day>';
--   -- concurrency: two simultaneous accepts for one operator/day →
--   -- exactly one commits, the other raises the conflict message.
-- =============================================================
