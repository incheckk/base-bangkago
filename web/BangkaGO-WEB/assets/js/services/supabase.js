/**
 * Shared Supabase client + helpers for web dashboards.
 * Mirrors src/services/supabase.ts + src/utils/phone.ts
 * Loaded after window.supabase (UMD) and window.BANGKAGO_WEB (config.js)
 * REUSES the canonical window.bangkago.client created by supabase-client.js
 * (loaded by the route guard) to ensure a single authenticated session.
 */
(function () {
  'use strict';

  var cfg = window.BANGKAGO_WEB || {};

  /* Reuse the canonical client from window.bangkago (initialized by supabase-client.js).
     Falls back to creating a new client only if the canonical one is not yet available
     (e.g., when loaded standalone without the guard). */
  function getClient() {
    if (window.bangkago && window.bangkago.client) {
      return window.bangkago.client;
    }
    // Fallback: create client with proper auth config (should rarely be needed)
    if (window.supabase && cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY) {
      return window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false
        }
      });
    }
    return null;
  }

  /* Phone helpers (mirror src/utils/phone.ts) */
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

  function phoneToAuthEmail(e164) {
    return 'bangkago+' + e164.slice(1) + '@gmail.com';
  }

  function loginIdentifier(raw) {
    var e164 = normalizePhone(raw);
    return e164 ? phoneToAuthEmail(e164) : String(raw || '').trim();
  }

  /* Session / auth */
  async function getSession() {
    var c = getClient();
    if (!c) return { data: { session: null }, error: { message: 'Supabase client not initialized' } };
    return c.auth.getSession();
  }

  async function getUser() {
    var c = getClient();
    if (!c) return { data: { user: null }, error: { message: 'Supabase client not initialized' } };
    return c.auth.getUser();
  }

  async function signOut() {
    var c = getClient();
    if (!c) return;
    try { await c.auth.signOut(); } catch (e) { /* ignore */ }
  }

  /* User role lookup */
  async function getCurrentUserRole() {
    var c = getClient();
    if (!c) return null;
    try {
      var ures = await c.auth.getUser();
      var user = ures.data?.user;
      if (!user) return null;
      var r = await c.from('users').select('user_role').eq('id', user.id).maybeSingle();
      return r.data?.user_role ?? null;
    } catch (e) {
      return null;
    }
  }

  window.bangkagoServices = {
    getClient: getClient,
    normalizePhone: normalizePhone,
    phoneToAuthEmail: phoneToAuthEmail,
    loginIdentifier: loginIdentifier,
    getSession: getSession,
    getUser: getUser,
    signOut: signOut,
    getCurrentUserRole: getCurrentUserRole
  };
})();