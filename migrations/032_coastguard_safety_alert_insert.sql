-- 032 — Allow Coast Guard users to file compliance alerts.
-- Run manually in the Supabase SQL editor after migration 031.

DROP POLICY IF EXISTS "safety_alerts_insert_coastguard" ON safety_alerts;
CREATE POLICY "safety_alerts_insert_coastguard" ON safety_alerts
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM users
      WHERE id = auth.uid()
        AND user_role = 'coastguard'
    )
  );