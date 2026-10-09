// Public config for the static web (bangkaGo-access.html + dashboards).
// Same EXPO_PUBLIC_* values the Expo app uses — the anon key is
// public-by-design (RLS is the boundary). NEVER put the service-role key here.
// The supabase-js UMD is VENDORED at web/assets/js/supabase.js (same version
// the app ships) — no CDN on the login critical path; ad blockers kept
// breaking jsDelivr during demos.
window.BANGKAGO_WEB = {
  SUPABASE_URL: 'https://izsgvhcgnrtxcilwbuwo.supabase.co',
  SUPABASE_ANON_KEY:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml6c2d2aGNnbnJ0eGNpbHdidXdvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc3MTMwMDUsImV4cCI6MjEwMzI4OTAwNX0.eQxjMK2ceUMGssAYgoD7RwAMrmiScvhdfuXJsTXQ0nI',
};
