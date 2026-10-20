-- =============================================================
-- 056_offline_track_sync.sql
--
-- The offline GPS outbox's server half (BangkaGo core sailing batch).
--
--   1. sync_track_points — the client queues fixes while offline
--      (AsyncStorage FIFO, useLocationTracking) and flushes them in
--      batches here when the connection returns.
--
--      Why not report_boat_position (008): it stamps recorded_at with
--      now(), so replaying a queued backlog would rewrite history to
--      "everything happened at flush time" — dispatch freshness, trip
--      duration and the passenger's last-seen clock all lie. It also
--      picks the boat server-side with ORDER BY id LIMIT 1, which
--      files fixes against the wrong hull the moment a bangkero owns
--      more than one. Here the client names the boat and the server
--      proves it is theirs.
--
--      Port-queue presence (008's enter/leave logic) is synced from
--      the NEWEST point only — presence is a present-tense fact, not
--      something to replay 300 times. Real client timestamps mean a
--      late replay cannot fake GPS freshness either: dispatch_eligible
--      keeps reading vessel_tracking.recorded_at honestly.
--
--   2. cancel_own_booking gains the post-departure guard: once
--      depart_time is stamped the trip is at sea, and a passenger
--      cancel would leave the manifest sailing with a ghost aboard.
--
-- ⚠ No demo reset. Safe to run on a live database.
-- Apply manually in the Supabase SQL editor, after 055.
-- =============================================================

-- =============================================================
-- 1. sync_track_points(p_bangka_id, p_points)
--
-- p_points: JSON array of up to 500 fixes, oldest first:
--   { "lat": 10.31, "lng": 124.01, "speed": 2.5, "recorded_at": "ISO" }
-- Returns the number of fixes inserted.
-- =============================================================
CREATE OR REPLACE FUNCTION sync_track_points(
  p_bangka_id UUID,
  p_points JSONB
) RETURNS INTEGER AS $$
DECLARE
  v_bangka UUID;
  v_n INT := 0;
  v_point JSONB;
  v_lat NUMERIC;
  v_lng NUMERIC;
  v_speed NUMERIC;
  v_at TIMESTAMPTZ;
  v_count INT;
  v_newest RECORD;
  -- Presence state, same shapes as report_boat_position (008).
  v_active port_queue%ROWTYPE;
  v_recent port_queue%ROWTYPE;
  v_port ports%ROWTYPE;
  v_now TIMESTAMPTZ := now();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- The client names the boat; the server proves it is ours.
  SELECT id INTO v_bangka
  FROM bangkas
  WHERE id = p_bangka_id AND bangkero_id = auth.uid();
  IF v_bangka IS NULL THEN
    RAISE EXCEPTION 'this is not your bangka';
  END IF;

  IF p_points IS NULL
     OR jsonb_typeof(p_points) <> 'array'
     OR jsonb_array_length(p_points) < 1 THEN
    RAISE EXCEPTION 'points must be a non-empty array';
  END IF;

  v_count := jsonb_array_length(p_points);
  IF v_count > 500 THEN
    RAISE EXCEPTION 'at most 500 points per flush';
  END IF;

  FOR v_point IN SELECT value FROM jsonb_array_elements(p_points) LOOP
    BEGIN
      v_lat := (v_point->>'lat')::NUMERIC;
      v_lng := (v_point->>'lng')::NUMERIC;
      v_speed := NULLIF(v_point->>'speed', '')::NUMERIC;
      v_at := (v_point->>'recorded_at')::TIMESTAMPTZ;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'malformed fix in batch';
    END;

    IF v_lat IS NULL OR v_lng IS NULL OR v_at IS NULL
       OR v_lat NOT BETWEEN -90 AND 90
       OR v_lng NOT BETWEEN -180 AND 180 THEN
      RAISE EXCEPTION 'fix out of range';
    END IF;
    -- Client clock skew tolerance one way, garbage the other: a fix
    -- from the future or older than a day is a bug, not a sailing.
    IF v_at > v_now + INTERVAL '5 minutes'
       OR v_at < v_now - INTERVAL '24 hours' THEN
      RAISE EXCEPTION 'fix timestamp out of range';
    END IF;

    INSERT INTO vessel_tracking (latitude, longitude, speed, bangka_id, recorded_at)
    VALUES (v_lat, v_lng, v_speed, v_bangka, v_at);
    v_n := v_n + 1;
  END LOOP;

  -- Port-queue presence from the NEWEST fix only — the same enter/leave
  -- logic as report_boat_position (008), evaluated at flush time.
  SELECT * INTO v_newest
  FROM vessel_tracking
  WHERE bangka_id = v_bangka
  ORDER BY recorded_at DESC
  LIMIT 1;

  SELECT * INTO v_active
  FROM port_queue
  WHERE bangkero_id = auth.uid() AND left_at IS NULL;

  SELECT * INTO v_port
  FROM ports
  WHERE is_active
    AND latitude IS NOT NULL
    AND longitude IS NOT NULL
    AND haversine_m(v_newest.latitude, v_newest.longitude, latitude, longitude)
        <= geofence_radius_m
  ORDER BY haversine_m(v_newest.latitude, v_newest.longitude, latitude, longitude)
  LIMIT 1;

  IF v_port.id IS NULL THEN
    IF v_active.id IS NOT NULL THEN
      UPDATE port_queue SET left_at = v_now WHERE id = v_active.id;
    END IF;
    RETURN v_n;
  END IF;

  IF v_active.id IS NOT NULL AND v_active.port_id = v_port.id THEN
    RETURN v_n; -- already on this port's list
  END IF;

  -- Jitter grace, same 60s window as 008: a row closed at THIS port
  -- recently reopens with entered_at preserved (FCFS order survives).
  SELECT * INTO v_recent
  FROM port_queue
  WHERE bangkero_id = auth.uid()
    AND port_id = v_port.id
    AND left_at IS NOT NULL
    AND left_at > v_now - INTERVAL '60 seconds'
  ORDER BY left_at DESC
  LIMIT 1;

  UPDATE port_queue
  SET left_at = v_now
  WHERE bangkero_id = auth.uid() AND left_at IS NULL;

  IF v_recent.id IS NOT NULL THEN
    UPDATE port_queue SET left_at = NULL WHERE id = v_recent.id;
  ELSE
    INSERT INTO port_queue (port_id, bangkero_id, entered_at)
    VALUES (v_port.id, auth.uid(), v_now);
  END IF;

  RETURN v_n;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION sync_track_points(UUID, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION sync_track_points(UUID, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION sync_track_points(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION sync_track_points(UUID, JSONB) TO service_role;

-- The offline demo can flush a few hundred rows at once; the reads that
-- power passenger tracking and dispatch freshness order by this index.
CREATE INDEX IF NOT EXISTS idx_vessel_tracking_bangka_recorded
  ON vessel_tracking (bangka_id, recorded_at DESC);

-- =============================================================
-- 2. cancel_own_booking — 020 body + the post-departure guard.
--
-- 'accepted' persists from accept through sailing, so trip_stat alone
-- never blocked a mid-trip cancel: a passenger could cancel AFTER the
-- boat left, leaving the manifest sailing with a ghost aboard. The
-- departure stamp is the line — before it, cancel freely (no-shows,
-- escape valve); after it, the trip must be disputed or completed.
-- =============================================================
CREATE OR REPLACE FUNCTION cancel_own_booking(p_booking_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS VOID AS $$
DECLARE
  v bookings%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v FROM bookings WHERE id = p_booking_id AND user_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'this booking was already cancelled or has changed';
  END IF;

  IF v.depart_time IS NOT NULL THEN
    RAISE EXCEPTION 'the boat has already departed — this trip can no longer be cancelled';
  END IF;

  UPDATE bookings
  SET trip_stat = 'cancelled',
      cancelled_at = now(),
      cancel_reason = p_reason
  WHERE id = p_booking_id
    AND trip_stat IN ('open', 'accepted', 'pending');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'this booking was already cancelled or has changed';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION cancel_own_booking(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION cancel_own_booking(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION cancel_own_booking(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION cancel_own_booking(UUID, TEXT) TO service_role;
