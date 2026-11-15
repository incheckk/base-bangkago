-- =============================================================
-- 082 — Semantic user activity audit trail (run AFTER 081)
-- =============================================================
-- Store authenticated app/web changes as user-facing activities, not
-- raw database operations. The row trigger is the shared boundary for
-- direct writes and RPCs, and writes the audit row in the same transaction.
-- Reads, generated notifications, GPS/weather telemetry, and SQL-editor or
-- service-role writes without auth.uid() are not user-attributed activities.
--
-- The existing audit_log table and admin-only SELECT policy come from 038.
-- This migration preserves old entries, adds identity/event/record snapshots,
-- replaces the old admin-only logging rule, and audits business tables used
-- by passengers, bangkeros, coastguard, and admins.
-- =============================================================

ALTER TABLE public.audit_log
  ADD COLUMN IF NOT EXISTS actor_name TEXT,
  ADD COLUMN IF NOT EXISTS event_name TEXT,
  ADD COLUMN IF NOT EXISTS target_label TEXT;

CREATE OR REPLACE FUNCTION public.audit_activity_name(
  p_table TEXT,
  p_action TEXT,
  p_old JSONB,
  p_new JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_status TEXT := COALESCE(
    p_new ->> 'trip_stat', p_new ->> 'status',
    p_old ->> 'trip_stat', p_old ->> 'status'
  );
BEGIN
  IF p_table = 'bookings' THEN
    IF p_action = 'INSERT' THEN
      RETURN CASE
        WHEN COALESCE(p_new ->> 'service_type', '') = 'cargo' THEN 'Sent a cargo request'
        WHEN p_new ->> 'package_id' IS NOT NULL THEN 'Booked an island-hop trip'
        ELSE 'Requested a boat trip'
      END;
    ELSIF p_action = 'DELETE' THEN
      RETURN 'Removed a booking';
    ELSIF p_old -> 'trip_stat' IS DISTINCT FROM p_new -> 'trip_stat' THEN
      RETURN CASE v_status
        WHEN 'accepted' THEN 'Accepted a booking'
        WHEN 'completed' THEN 'Completed a trip'
        WHEN 'cancelled' THEN 'Cancelled a booking'
        WHEN 'open' THEN 'Reopened a booking'
        ELSE 'Changed a booking status'
      END;
    ELSIF p_old -> 'depart_time' IS DISTINCT FROM p_new -> 'depart_time'
      AND p_new ->> 'depart_time' IS NOT NULL THEN
      RETURN 'Started a sailing';
    ELSIF p_old -> 'rejected_by' IS DISTINCT FROM p_new -> 'rejected_by' THEN
      RETURN 'Declined a booking request';
    END IF;
    RETURN 'Updated a booking';
  ELSIF p_table = 'boat_rentals' THEN
    IF p_action = 'INSERT' THEN RETURN 'Requested a boat charter'; END IF;
    IF p_action = 'DELETE' THEN RETURN 'Removed a boat charter'; END IF;
    IF p_old -> 'status' IS DISTINCT FROM p_new -> 'status' THEN
      RETURN CASE p_new ->> 'status'
        WHEN 'confirmed' THEN 'Confirmed a boat charter'
        WHEN 'completed' THEN 'Completed a boat charter'
        WHEN 'cancelled' THEN 'Cancelled a boat charter'
        ELSE 'Updated a boat charter'
      END;
    END IF;
    RETURN 'Updated a boat charter';
  ELSIF p_table = 'downpayments' THEN
    IF p_action = 'INSERT' THEN RETURN 'Submitted a downpayment'; END IF;
    IF p_action = 'DELETE' THEN RETURN 'Removed a downpayment record'; END IF;
    IF p_old -> 'released_at' IS DISTINCT FROM p_new -> 'released_at'
      AND p_new ->> 'released_at' IS NOT NULL THEN
      RETURN 'Released a downpayment';
    END IF;
    IF p_old -> 'status' IS DISTINCT FROM p_new -> 'status' THEN
      RETURN CASE p_new ->> 'status'
        WHEN 'approved' THEN 'Approved a downpayment'
        WHEN 'refunded' THEN 'Refunded a downpayment'
        ELSE 'Updated a downpayment'
      END;
    END IF;
    RETURN 'Updated a downpayment';
  ELSIF p_table = 'users' THEN
    IF p_action = 'INSERT' THEN RETURN 'Created an account'; END IF;
    IF p_action = 'DELETE' THEN RETURN 'Removed a user account'; END IF;
    IF p_old -> 'is_suspended' IS DISTINCT FROM p_new -> 'is_suspended' THEN
      RETURN CASE WHEN COALESCE((p_new ->> 'is_suspended')::BOOLEAN, FALSE)
        THEN 'Suspended a user account' ELSE 'Reactivated a user account' END;
    END IF;
    IF p_old -> 'user_role' IS DISTINCT FROM p_new -> 'user_role' THEN
      RETURN 'Changed a user role';
    END IF;
    RETURN 'Updated a user profile';
  ELSIF p_table = 'bangkeros' THEN
    IF p_action = 'INSERT' THEN RETURN 'Created a bangkero profile'; END IF;
    IF p_action = 'DELETE' THEN RETURN 'Removed a bangkero profile'; END IF;
    IF p_old -> 'verification_stat' IS DISTINCT FROM p_new -> 'verification_stat' THEN
      RETURN 'Changed bangkero verification status';
    END IF;
    IF p_old -> 'is_available' IS DISTINCT FROM p_new -> 'is_available' THEN
      RETURN CASE WHEN COALESCE((p_new ->> 'is_available')::BOOLEAN, FALSE)
        THEN 'Set bangkero availability online' ELSE 'Set bangkero availability offline' END;
    END IF;
    IF p_old -> 'rating_penalty' IS DISTINCT FROM p_new -> 'rating_penalty'
      OR p_old -> 'rating_recovery_stars' IS DISTINCT FROM p_new -> 'rating_recovery_stars' THEN
      RETURN 'Adjusted a bangkero rating';
    END IF;
    RETURN 'Updated a bangkero profile';
  ELSIF p_table = 'bangkero_verification' THEN
    IF p_action = 'INSERT' THEN RETURN 'Submitted verification documents'; END IF;
    IF p_action = 'DELETE' THEN RETURN 'Removed a verification record'; END IF;
    IF p_old -> 'status' IS DISTINCT FROM p_new -> 'status' THEN
      RETURN CASE p_new ->> 'status'
        WHEN 'approved' THEN 'Approved bangkero documents'
        WHEN 'rejected' THEN 'Rejected bangkero documents'
        ELSE 'Updated bangkero document review'
      END;
    END IF;
    RETURN 'Updated bangkero verification details';
  ELSIF p_table = 'bangkas' THEN
    IF p_action = 'INSERT' THEN RETURN 'Registered a boat'; END IF;
    IF p_action = 'DELETE' THEN RETURN 'Removed a boat'; END IF;
    IF p_old -> 'is_active' IS DISTINCT FROM p_new -> 'is_active' THEN
      RETURN CASE WHEN COALESCE((p_new ->> 'is_active')::BOOLEAN, FALSE)
        THEN 'Activated a boat' ELSE 'Deactivated a boat' END;
    END IF;
    IF p_old -> 'standard_price' IS DISTINCT FROM p_new -> 'standard_price' THEN
      RETURN 'Changed a boat charter price';
    END IF;
    RETURN 'Updated boat details';
  ELSIF p_table = 'ports' THEN
    IF p_action = 'INSERT' THEN RETURN 'Added a port'; END IF;
    IF p_action = 'DELETE' THEN RETURN 'Removed a port'; END IF;
    IF p_old -> 'is_active' IS DISTINCT FROM p_new -> 'is_active' THEN
      RETURN CASE WHEN COALESCE((p_new ->> 'is_active')::BOOLEAN, FALSE)
        THEN 'Activated a port' ELSE 'Deactivated a port' END;
    END IF;
    RETURN 'Updated port details';
  ELSIF p_table = 'routes' THEN
    IF p_action = 'INSERT' THEN RETURN 'Added a route'; END IF;
    IF p_action = 'DELETE' THEN RETURN 'Removed a route'; END IF;
    IF p_old -> 'base_fare' IS DISTINCT FROM p_new -> 'base_fare' THEN
      RETURN 'Changed a route fare';
    END IF;
    RETURN 'Updated route details';
  ELSIF p_table = 'safety_alerts' THEN
    IF p_action = 'INSERT' THEN RETURN 'Sent a safety alert'; END IF;
    IF p_action = 'DELETE' THEN RETURN 'Removed a safety alert'; END IF;
    IF p_old -> 'is_resolved' IS DISTINCT FROM p_new -> 'is_resolved' THEN
      RETURN CASE WHEN COALESCE((p_new ->> 'is_resolved')::BOOLEAN, FALSE)
        THEN 'Resolved a safety alert' ELSE 'Reopened a safety alert' END;
    END IF;
    RETURN 'Updated a safety alert';
  ELSIF p_table = 'dev_flags' THEN
    IF p_action = 'INSERT' THEN RETURN 'Configured developer settings'; END IF;
    IF p_action = 'DELETE' THEN RETURN 'Removed developer settings'; END IF;
    RETURN 'Changed developer settings';
  ELSIF p_table = 'parcels' THEN
    IF p_action = 'INSERT' THEN RETURN 'Created a parcel delivery'; END IF;
    IF p_action = 'DELETE' THEN RETURN 'Removed a parcel delivery'; END IF;
    IF p_old -> 'loaded_at' IS DISTINCT FROM p_new -> 'loaded_at'
      AND p_new ->> 'loaded_at' IS NOT NULL THEN
      RETURN 'Marked a parcel as loaded';
    END IF;
    IF p_old -> 'status' IS DISTINCT FROM p_new -> 'status' THEN
      RETURN CASE p_new ->> 'status'
        WHEN 'delivered' THEN 'Marked a parcel as delivered'
        WHEN 'returned' THEN 'Returned a parcel'
        WHEN 'in_transit' THEN 'Started parcel delivery'
        ELSE 'Updated a parcel delivery'
      END;
    END IF;
    RETURN 'Updated parcel details';
  ELSIF p_table = 'parcel_items' THEN
    IF p_action = 'INSERT' THEN RETURN 'Added an item to a parcel'; END IF;
    IF p_action = 'DELETE' THEN RETURN 'Removed an item from a parcel'; END IF;
    RETURN 'Updated a parcel item';
  ELSIF p_table = 'passenger_details' THEN
    IF p_action = 'INSERT' THEN RETURN 'Added passenger details'; END IF;
    IF p_action = 'DELETE' THEN RETURN 'Removed passenger details'; END IF;
    RETURN 'Updated passenger details';
  ELSIF p_table = 'payments' THEN
    IF p_action = 'INSERT' THEN RETURN 'Recorded a payment'; END IF;
    IF p_action = 'DELETE' THEN RETURN 'Removed a payment record'; END IF;
    IF p_old -> 'payment_status' IS DISTINCT FROM p_new -> 'payment_status' THEN
      RETURN 'Changed payment status';
    END IF;
    RETURN 'Updated payment details';
  ELSIF p_table = 'ratings' THEN
    IF p_action = 'INSERT' THEN RETURN 'Rated a trip'; END IF;
    IF p_action = 'DELETE' THEN RETURN 'Removed a trip rating'; END IF;
    RETURN 'Updated a trip rating';
  ELSIF p_table = 'island_packages' THEN
    IF p_action = 'INSERT' THEN RETURN 'Added an island-hop package'; END IF;
    IF p_action = 'DELETE' THEN RETURN 'Removed an island-hop package'; END IF;
    RETURN 'Updated an island-hop package';
  ELSIF p_table = 'route_stops' THEN
    IF p_action = 'INSERT' THEN RETURN 'Added a route stop'; END IF;
    IF p_action = 'DELETE' THEN RETURN 'Removed a route stop'; END IF;
    RETURN 'Updated a route stop';
  ELSIF p_table = 'trip_manifest' THEN
    IF p_action = 'INSERT' THEN RETURN 'Created a sailing manifest'; END IF;
    IF p_action = 'DELETE' THEN RETURN 'Removed a sailing manifest'; END IF;
    RETURN 'Updated a sailing manifest';
  ELSIF p_table = 'manifest_passengers' THEN
    IF p_action = 'INSERT' THEN RETURN 'Added a passenger to the manifest'; END IF;
    IF p_action = 'DELETE' THEN RETURN 'Removed a passenger from the manifest'; END IF;
    RETURN 'Updated a manifest passenger';
  ELSIF p_table = 'manifest_parcels' THEN
    IF p_action = 'INSERT' THEN RETURN 'Added a parcel to the manifest'; END IF;
    IF p_action = 'DELETE' THEN RETURN 'Removed a parcel from the manifest'; END IF;
    RETURN 'Updated a manifest parcel';
  ELSIF p_table = 'wallet_transactions' THEN
    IF p_action = 'INSERT' THEN RETURN 'Recorded a wallet transaction'; END IF;
    IF p_action = 'DELETE' THEN RETURN 'Removed a wallet transaction'; END IF;
    RETURN 'Updated a wallet transaction';
  ELSIF p_table = 'wallets' THEN
    IF p_action = 'INSERT' THEN RETURN 'Created a wallet'; END IF;
    IF p_action = 'DELETE' THEN RETURN 'Removed a wallet'; END IF;
    RETURN 'Updated a wallet';
  ELSIF p_table = 'notifications' THEN
    IF p_old -> 'is_read' IS DISTINCT FROM p_new -> 'is_read' THEN
      RETURN CASE WHEN COALESCE((p_new ->> 'is_read')::BOOLEAN, FALSE)
        THEN 'Read a notification' ELSE 'Marked a notification unread' END;
    END IF;
    RETURN 'Updated a notification';
  ELSIF p_table = 'sailing_advisory' THEN
    IF p_old -> 'is_suspended' IS DISTINCT FROM p_new -> 'is_suspended' THEN
      RETURN CASE WHEN COALESCE((p_new ->> 'is_suspended')::BOOLEAN, FALSE)
        THEN 'Suspended sailing' ELSE 'Resumed sailing' END;
    END IF;
    RETURN 'Updated the sailing advisory';
  ELSIF p_table = 'parcel_rates' THEN
    IF p_action = 'INSERT' THEN RETURN 'Added parcel delivery rates'; END IF;
    IF p_action = 'DELETE' THEN RETURN 'Removed parcel delivery rates'; END IF;
    RETURN 'Changed parcel delivery rates';
  ELSIF p_table = 'app_settings' THEN
    IF p_action = 'INSERT' THEN RETURN 'Added an app setting'; END IF;
    IF p_action = 'DELETE' THEN RETURN 'Removed an app setting'; END IF;
    RETURN 'Changed an app setting';
  END IF;

  RETURN CASE p_action
    WHEN 'INSERT' THEN 'Created a ' || REPLACE(p_table, '_', ' ') || ' record'
    WHEN 'DELETE' THEN 'Removed a ' || REPLACE(p_table, '_', ' ') || ' record'
    ELSE 'Updated a ' || REPLACE(p_table, '_', ' ') || ' record'
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_target_label(
  p_table TEXT,
  p_target_id TEXT,
  p_old JSONB,
  p_new JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_data JSONB := COALESCE(p_new, p_old, '{}'::JSONB);
  v_name TEXT;
BEGIN
  CASE p_table
    WHEN 'users' THEN
      v_name := NULLIF(TRIM(CONCAT_WS(' ', v_data ->> 'first_name', v_data ->> 'last_name')), '');
      RETURN COALESCE(v_name, 'User account');
    WHEN 'bangkeros' THEN
      RETURN COALESCE(NULLIF(v_data ->> 'display_name', ''), 'Bangkero profile');
    WHEN 'bangkas' THEN
      RETURN COALESCE(NULLIF(v_data ->> 'bangka_name', ''), 'Boat');
    WHEN 'bookings' THEN
      RETURN COALESCE(NULLIF(v_data ->> 'ref', ''), 'Booking ' || LEFT(COALESCE(p_target_id, ''), 8));
    WHEN 'boat_rentals' THEN
      RETURN COALESCE(NULLIF(v_data ->> 'event_name', ''), 'Boat charter ' || LEFT(COALESCE(p_target_id, ''), 8));
    WHEN 'ports' THEN
      RETURN COALESCE(NULLIF(v_data ->> 'port_name', ''), 'Port');
    WHEN 'routes' THEN
      RETURN COALESCE(NULLIF(v_data ->> 'id', ''), 'Route');
    WHEN 'downpayments' THEN
      RETURN 'Downpayment ' || LEFT(COALESCE(p_target_id, ''), 8);
    WHEN 'safety_alerts' THEN
      RETURN 'Safety alert ' || LEFT(COALESCE(p_target_id, ''), 8);
    WHEN 'parcels' THEN
      RETURN 'Parcel ' || LEFT(COALESCE(p_target_id, ''), 8);
    WHEN 'parcel_items' THEN
      RETURN COALESCE(NULLIF(v_data ->> 'item_name', ''), 'Parcel item');
    WHEN 'passenger_details' THEN
      v_name := NULLIF(TRIM(CONCAT_WS(' ', v_data ->> 'first_name', v_data ->> 'last_name')), '');
      RETURN COALESCE(v_name, 'Passenger details');
    WHEN 'island_packages' THEN
      RETURN COALESCE(NULLIF(v_data ->> 'package_name', ''), 'Island-hop package');
    WHEN 'payments' THEN
      RETURN 'Payment ' || LEFT(COALESCE(p_target_id, ''), 8);
    WHEN 'notifications' THEN
      RETURN COALESCE(NULLIF(v_data ->> 'title', ''), 'Notification ' || LEFT(COALESCE(p_target_id, ''), 8));
    WHEN 'sailing_advisory' THEN
      RETURN 'Sailing advisory';
    WHEN 'parcel_rates' THEN
      RETURN 'Parcel rates · ' || COALESCE(NULLIF(v_data ->> 'zone', ''), 'zone');
    WHEN 'app_settings' THEN
      RETURN 'Setting · ' || COALESCE(NULLIF(v_data ->> 'key', ''), 'app');
    ELSE
      RETURN INITCAP(REPLACE(p_table, '_', ' ')) || ' ' || LEFT(COALESCE(p_target_id, ''), 8);
  END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_safe_data(p_data JSONB)
RETURNS JSONB
LANGUAGE SQL
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_data IS NULL THEN NULL
    ELSE COALESCE(
      JSONB_OBJECT_AGG(
        entry.key,
        CASE
          WHEN entry.key ~* '(password|token|secret|credential|_url$|_path$)'
            OR entry.key = 'value'
            OR entry.key IN ('email', 'profile_photo', 'evidence_paths', 'receipt_image', 'gov_issued_id',
                             'boat_registration_cert', 'coastal_permit', 'brgy_clearance')
          THEN '"[redacted]"'::JSONB
          ELSE entry.value
        END
      ) FILTER (WHERE entry.key NOT IN ('id', 'created_at', 'updated_at')),
      '{}'::JSONB
    )
  END
  FROM JSONB_EACH(p_data) AS entry;
$$;

REVOKE ALL ON FUNCTION public.audit_activity_name(TEXT, TEXT, JSONB, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.audit_target_label(TEXT, TEXT, JSONB, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.audit_safe_data(JSONB) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.audit_log_row()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_actor_name TEXT;
  v_old JSONB;
  v_new JSONB;
  v_old_ch JSONB := '{}'::JSONB;
  v_new_ch JSONB := '{}'::JSONB;
  v_target_id TEXT;
  v_target_label TEXT;
  v_event_name TEXT;
  k TEXT;
  item RECORD;
BEGIN
  IF v_uid IS NULL OR pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;

  IF TG_OP <> 'INSERT' THEN v_old := TO_JSONB(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN v_new := TO_JSONB(NEW); END IF;

  SELECT u.user_role, NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), '')
    INTO v_role, v_actor_name
    FROM public.users u
   WHERE u.id = v_uid;

  -- Keep the actor's pre-edit identity if they change their own profile.
  IF TG_TABLE_NAME = 'users' AND TG_OP IN ('UPDATE', 'DELETE')
    AND (v_old ->> 'id') = v_uid::TEXT THEN
    v_role := COALESCE(v_old ->> 'user_role', v_role);
    v_actor_name := COALESCE(
      NULLIF(TRIM(CONCAT_WS(' ', v_old ->> 'first_name', v_old ->> 'last_name')), ''),
      v_actor_name
    );
  END IF;

  IF v_role IS NULL THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    FOR item IN SELECT key, value FROM JSONB_EACH(v_new) LOOP
      k := item.key;
      IF k IN ('id', 'created_at', 'updated_at') THEN CONTINUE; END IF;
      IF (v_old -> k) IS DISTINCT FROM (v_new -> k) THEN
        IF k ~* '(password|token|secret|credential|_url$|_path$)' OR k = 'value'
          OR k IN ('email', 'profile_photo', 'evidence_paths', 'receipt_image', 'gov_issued_id',
                   'boat_registration_cert', 'coastal_permit', 'brgy_clearance') THEN
          v_old_ch := v_old_ch || JSONB_BUILD_OBJECT(k, '[redacted]');
          v_new_ch := v_new_ch || JSONB_BUILD_OBJECT(k, '[redacted]');
        ELSE
          v_old_ch := v_old_ch || JSONB_BUILD_OBJECT(k, v_old -> k);
          v_new_ch := v_new_ch || JSONB_BUILD_OBJECT(k, v_new -> k);
        END IF;
      END IF;
    END LOOP;
    IF v_old_ch = '{}'::JSONB THEN RETURN NULL; END IF;
  ELSIF TG_OP = 'INSERT' THEN
    FOR item IN SELECT key, value FROM JSONB_EACH(v_new) LOOP
      k := item.key;
      IF k IN ('id', 'created_at', 'updated_at') THEN CONTINUE; END IF;
      IF k ~* '(password|token|secret|credential|_url$|_path$)' OR k = 'value'
        OR k IN ('email', 'profile_photo', 'evidence_paths', 'receipt_image', 'gov_issued_id',
                 'boat_registration_cert', 'coastal_permit', 'brgy_clearance') THEN
        v_new_ch := v_new_ch || JSONB_BUILD_OBJECT(k, '[redacted]');
      ELSE
        v_new_ch := v_new_ch || JSONB_BUILD_OBJECT(k, item.value);
      END IF;
    END LOOP;
  ELSE
    FOR item IN SELECT key, value FROM JSONB_EACH(v_old) LOOP
      k := item.key;
      IF k IN ('id', 'created_at', 'updated_at') THEN CONTINUE; END IF;
      IF k ~* '(password|token|secret|credential|_url$|_path$)' OR k = 'value'
        OR k IN ('email', 'profile_photo', 'evidence_paths', 'receipt_image', 'gov_issued_id',
                 'boat_registration_cert', 'coastal_permit', 'brgy_clearance') THEN
        v_old_ch := v_old_ch || JSONB_BUILD_OBJECT(k, '[redacted]');
      ELSE
        v_old_ch := v_old_ch || JSONB_BUILD_OBJECT(k, item.value);
      END IF;
    END LOOP;
  END IF;

  v_target_id := COALESCE(
    v_new ->> 'id', v_old ->> 'id',
    v_new ->> 'key', v_old ->> 'key',
    v_new ->> 'zone', v_old ->> 'zone'
  );
  v_event_name := public.audit_activity_name(TG_TABLE_NAME, TG_OP, v_old, v_new);
  v_target_label := public.audit_target_label(TG_TABLE_NAME, v_target_id, v_old, v_new);

  INSERT INTO public.audit_log (
    actor_id, actor_role, actor_name, action, event_name,
    target_table, target_id, target_label, old_data, new_data
  )
  VALUES (
    v_uid,
    v_role,
    COALESCE(v_actor_name, 'Account ' || LEFT(v_uid::TEXT, 8)),
    TG_OP,
    v_event_name,
    TG_TABLE_NAME,
    v_target_id,
    v_target_label,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN v_old_ch ELSE NULL END,
    CASE WHEN TG_OP IN ('UPDATE', 'INSERT') THEN v_new_ch ELSE NULL END
  );

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_log_row() FROM PUBLIC, anon;

-- Retain and re-label the existing 038 history; do not fabricate entries.
UPDATE public.audit_log a
   SET actor_name = COALESCE(
         NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''),
         'Account ' || LEFT(a.actor_id::TEXT, 8)
       ),
       event_name = public.audit_activity_name(a.target_table, a.action, a.old_data, a.new_data),
       target_label = public.audit_target_label(a.target_table, a.target_id, a.old_data, a.new_data),
       old_data = public.audit_safe_data(a.old_data),
       new_data = public.audit_safe_data(a.new_data)
  FROM public.users u
 WHERE a.actor_id = u.id
   AND (a.actor_name IS NULL OR a.event_name IS NULL OR a.target_label IS NULL);

UPDATE public.audit_log a
   SET actor_name = COALESCE(a.actor_name, 'Account ' || LEFT(a.actor_id::TEXT, 8)),
       event_name = COALESCE(a.event_name, public.audit_activity_name(a.target_table, a.action, a.old_data, a.new_data)),
       target_label = COALESCE(a.target_label, public.audit_target_label(a.target_table, a.target_id, a.old_data, a.new_data)),
       old_data = public.audit_safe_data(a.old_data),
       new_data = public.audit_safe_data(a.new_data)
 WHERE a.actor_name IS NULL OR a.event_name IS NULL OR a.target_label IS NULL
    OR a.old_data IS DISTINCT FROM public.audit_safe_data(a.old_data)
    OR a.new_data IS DISTINCT FROM public.audit_safe_data(a.new_data);

DO $$
DECLARE
  v_table TEXT;
  v_tables TEXT[] := ARRAY[
    'users', 'bangkeros', 'bangkero_verification', 'dev_flags', 'downpayments',
    'bookings', 'boat_rentals', 'ports', 'routes', 'safety_alerts', 'bangkas',
    'island_packages', 'passenger_details', 'payments', 'ratings', 'parcels',
    'parcel_items', 'route_stops', 'trip_manifest', 'manifest_passengers',
    'manifest_parcels', 'wallet_transactions', 'wallets', 'notifications'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE FORMAT('DROP TRIGGER IF EXISTS audit_%I ON public.%I', v_table, v_table);
    EXECUTE FORMAT('DROP TRIGGER IF EXISTS audit_activity_%I ON public.%I', v_table, v_table);
    IF v_table = 'notifications' THEN
      EXECUTE 'CREATE TRIGGER audit_activity_notifications AFTER UPDATE OF is_read ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.audit_log_row()';
    ELSE
      EXECUTE FORMAT(
        'CREATE TRIGGER audit_activity_%I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_log_row()',
        v_table, v_table
      );
    END IF;
  END LOOP;

  FOREACH v_table IN ARRAY ARRAY['sailing_advisory', 'parcel_rates', 'app_settings'] LOOP
    EXECUTE FORMAT('DROP TRIGGER IF EXISTS audit_activity_%I ON public.%I', v_table, v_table);
    EXECUTE FORMAT(
      'CREATE TRIGGER audit_activity_%I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_log_row()',
      v_table, v_table
    );
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
