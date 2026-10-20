-- =============================================================
-- 064 — Admin can read parcel item lines (trip manifest)
--
-- The admin trip manifest (mobile (admin)/booking/[id] and the web
-- "View Manifest") shows what cargo is actually aboard. 038 already
-- granted admin SELECT on parcels and passenger_details, but
-- parcel_items is still owner-only (005), so an admin session reads
-- zero item rows and the manifest looks empty.
--
-- Same policy shape as 038. INSERT policy untouched: items are
-- written by the parcel owner only.
--
-- Run manually in the SQL editor, after 063.
-- No demo reset.
-- =============================================================

DROP POLICY IF EXISTS "parcel_items_select_admin" ON parcel_items;
CREATE POLICY "parcel_items_select_admin" ON parcel_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_role = 'admin')
  );

-- Pick up the new policy for PostgREST.
NOTIFY pgrst, 'reload schema';
