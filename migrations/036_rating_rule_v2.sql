-- =============================================================
-- 036 — RATING RULE V2 + DEMO RESET
--
-- Rule changes (replaces the 3.0 floor from 010/020):
--   1. SMOOTHING — effective = (sum + 5*4) / (count + 4)
--      - penalty + recovery_stars. A new bangkero counts as four
--      5★ reviews, so ONE first-time 1★ lands at 4.2★ and can
--      never lock them out (the old rule locked at 1.0 immediately
--      with no way to earn more ratings — a permanent deadlock).
--   2. FLOOR 3.0 → 1.0 — only an effective rating at or below 1.0★
--      blocks offers/accepts.
--   3. 2-DAY RECOVERY — while locked (<= 1.0★) the clock runs;
--      after 2 days the bangkero regains 1 star (unlocking at 2★)
--      and the clock restarts. State lives in rating_low_since /
--      rating_recovery_stars; the tick runs inside the rating
--      function itself (VOLATILE, SECURITY DEFINER), so every gate
--      call and every screen read advances it.
--   4. BOOKER-ONLY RATINGS — ratings_insert_own now also requires
--      the rating's booking to belong to the rater. Companions have
--      no account, but this closes "any user rates any booking".
--   5. NOT RATING NEVER REMOVES A STAR — unchanged behaviour: the
--      average counts only ratings that exist; the smoothing prior
--      only ever ADDS stars.
--
-- The dev switch dev_flags.gates_bypass already lifted the rating
-- gate (010 gates_ok / accept_booking_hold) — unchanged here.
--
-- ⚠ DEMO RESET at the bottom wipes every rating. Run by hand, once.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Recovery columns
-- -------------------------------------------------------------
ALTER TABLE bangkeros
  ADD COLUMN IF NOT EXISTS rating_recovery_stars INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rating_low_since TIMESTAMPTZ;

-- -------------------------------------------------------------
-- 2. The single source of truth. Mirrors in rating.service.ts are
--    GONE — the app calls this RPC. Also performs the recovery tick.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION bangkero_effective_rating(p_bangkero UUID)
RETURNS NUMERIC
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sum      NUMERIC := 0;
  v_count    INT     := 0;
  v_penalty  NUMERIC := 0;
  v_recovery INT     := 0;
  v_low      TIMESTAMPTZ;
  v_eff      NUMERIC;
BEGIN
  SELECT COALESCE(SUM(r.score), 0), COUNT(r.id)
    INTO v_sum, v_count
    FROM ratings r
   WHERE r.bangkero_id = p_bangkero;

  SELECT COALESCE(b.rating_penalty, 0),
         COALESCE(b.rating_recovery_stars, 0),
         b.rating_low_since
    INTO v_penalty, v_recovery, v_low
    FROM bangkeros b
   WHERE b.id = p_bangkero;

  IF NOT FOUND THEN
    RETURN 5.0; -- unknown row: never gate on missing data
  END IF;

  -- Smoothing: four 5★ of prior weight (unrated = exactly 5.0).
  v_eff := (v_sum + 5.0 * 4) / (v_count + 4) - v_penalty + v_recovery;

  -- 2-day recovery tick.
  IF v_eff <= 1.0 THEN
    IF v_low IS NULL THEN
      UPDATE bangkeros SET rating_low_since = now() WHERE id = p_bangkero;
    ELSIF now() - v_low >= INTERVAL '2 days' THEN
      UPDATE bangkeros
         SET rating_recovery_stars = rating_recovery_stars + 1,
             rating_low_since = NULL
       WHERE id = p_bangkero;
      v_eff := v_eff + 1;
    END IF;
  ELSIF v_low IS NOT NULL THEN
    -- Recovered above the floor on their own — drop the clock.
    UPDATE bangkeros SET rating_low_since = NULL WHERE id = p_bangkero;
  END IF;

  RETURN GREATEST(0, v_eff);
END;
$$;

REVOKE ALL ON FUNCTION bangkero_effective_rating(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION bangkero_effective_rating(uuid) TO authenticated;

-- The accept/offer gate: same name as 010 so assign_next_hold and
-- accept_booking_hold pick up v2 with NO body re-patch — floor 1.0.
CREATE OR REPLACE FUNCTION bangkero_rating_ok(p_bangkero UUID)
RETURNS BOOLEAN
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  SELECT bangkero_effective_rating(p_bangkero) > 1.0;
$$;

-- Recreate with the honest volatility label (it now calls a tick).
CREATE OR REPLACE FUNCTION gates_ok(p_bangkero UUID)
RETURNS BOOLEAN
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  SELECT dev_gates_bypass()
    OR (
      EXISTS (
        SELECT 1 FROM bangkeros b
        WHERE b.id = p_bangkero AND b.verification_stat = 'verified'
      )
      AND bangkero_rating_ok(p_bangkero)
    );
$$;

-- -------------------------------------------------------------
-- 3. Only the MAIN BOOKER may rate: the rating's booking must
--    belong to the rater (companions have no account; this closes
--    rating someone else's trip by id).
-- -------------------------------------------------------------
DROP POLICY IF EXISTS "ratings_insert_own" ON ratings;
CREATE POLICY "ratings_insert_own" ON ratings
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM bookings b
       WHERE b.id = booking_id AND b.user_id = auth.uid()
    )
  );

-- -------------------------------------------------------------
-- 4. ⚠ DEMO RESET — irreversible. Wipes every rating, penalty and
--    recovery state so all bangkeros start clean at 5.0★.
--    Take a dump first if you care about the current data.
-- -------------------------------------------------------------
DELETE FROM ratings;
UPDATE bangkeros
   SET rating_penalty = 0,
       rating_recovery_stars = 0,
       rating_low_since = NULL;
