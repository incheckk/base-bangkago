/* Shared Supabase client for the static web.
   Load order: config.js -> supabase UMD (CDN) -> this file.
   Exposes window.bangkago with the client, phone->auth-email helpers
   (mirror of src/utils/phone.ts), and the role lookup used by the
   login page and the dashboard route guards.
   This is the CANONICAL client — all dashboard services must reuse it. */
(function () {
  'use strict';

  var cfg = window.BANGKAGO_WEB || {};
  var client =
    window.supabase && cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY
      ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: false
          }
        })
      : null;

  /* Mirror of src/utils/phone.ts — PH mobile in any common format -> E.164. */
  function normalizePhone(raw) {
    if (!raw) return null;
    var digits = raw.replace(/\D/g, '');
    if (!digits) return null;
    var local;
    if (digits.indexOf('0063') === 0) local = digits.slice(4);
    else if (digits.indexOf('63') === 0) local = digits.slice(2);
    else if (digits.indexOf('0') === 0) local = digits.slice(1);
    else local = digits;
    if (local.length !== 10 || local.charAt(0) !== '9') return null;
    return '+63' + local;
  }

  /* +639171234567 -> bangkago+639171234567@gmail.com (same as the app). */
  function phoneToAuthEmail(e164) {
    return 'bangkago+' + e164.slice(1) + '@gmail.com';
  }

  /* Login accepts a PH mobile number (like the app) or a raw email. */
  function loginIdentifier(raw) {
    var e164 = normalizePhone(raw);
    return e164 ? phoneToAuthEmail(e164) : String(raw || '').trim();
  }

  /* Signed-in user's users.user_role.
     Three outcomes, because the guards must not bounce a signed-in
     admin to the login page over a venue-wifi blip:
       'admin'|'coastguard'|'passenger'|'bangkero'  verified role
       null            genuinely no session (or no client) -> redirect OK
       'unverified'    session exists but the role lookup failed
                       after retries -> show a connection error instead */
  async function role() {
    if (!client) return null;
    var session = null;
    try {
      // Local session read (the JWT is validated by the query below).
      var s = await client.auth.getSession();
      session = s && s.data ? s.data.session : null;
    } catch (e) {
      return 'unverified';
    }
    if (!session || !session.user) return null; // truly signed out
    var lastErr = null;
    for (var attempt = 0; attempt < 3; attempt++) {
      try {
        var row = await client
          .from('users')
          .select('user_role')
          .eq('id', session.user.id)
          .maybeSingle();
        if (row.error) {
          lastErr = row.error;
        } else {
          return row.data ? row.data.user_role : null;
        }
      } catch (e) {
        lastErr = e;
      }
      await new Promise(function (r) { setTimeout(r, 400 * (attempt + 1)); });
    }
    console.warn('role(): could not verify role after retries', lastErr);
    return 'unverified';
  }

  async function signIn(identifier, password) {
    if (!client) throw new Error('Cannot reach the server. Check your connection.');
    var res = await client.auth.signInWithPassword({
      email: loginIdentifier(identifier),
      password: password,
    });
    if (res.error) throw res.error;
  }

  async function signOut() {
    if (!client) return;
    try {
      await client.auth.signOut();
    } catch (e) {
      /* already signed out / offline — page navigation continues */
    }
  }

  window.bangkago = {
    client: client,
    normalizePhone: normalizePhone,
    loginIdentifier: loginIdentifier,
    role: role,
    signIn: signIn,
    signOut: signOut,
  };
})();
