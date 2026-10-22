/**
 * User management service for web dashboards.
 * Mirrors mobile admin user operations (src/services/admin.service.ts).
 *
 * Account status comes from users.is_suspended (migration 065) - the only
 * flag the app and the portal actually enforce. users.is_verified is NOT
 * status: the app writes false on every sign-up and reads it nowhere.
 */
(function() {
  'use strict';
  var svc = window.bangkagoServices;

  function mapRow(row) {
    return {
      uid: row.id,
      firstName: row.first_name,
      middleName: row.middle_name,
      lastName: row.last_name,
      email: row.email,
      phone: row.phone_number,
      role: row.user_role,
      profilePhoto: row.profile_photo,
      isSuspended: row.is_suspended === true,
      // A suspended bangkero (bangkeros.is_deleted) can never sign in
      // (fetchUserDoc rejects them), so the directory must not call them
      // Active. Filled in by the callers.
      bangkeroDeleted: false,
      createdAt: row.created_at
    };
  }

  async function listAll(options) {
    options = options || {};
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var q = c.from('users').select('*');
    if (options.role) q = q.eq('user_role', options.role);
    if (options.isSuspended !== undefined) q = q.eq('is_suspended', options.isSuspended);
    if (options.search) {
      var term = options.search.toLowerCase();
      // Phone-first: identity is the PH mobile number (the "email" is a
      // synthetic bangkago+<digits>@gmail.com copy of it) — don't search it.
      q = q.or('first_name.ilike.%' + term + '%,last_name.ilike.%' + term + '%,phone_number.ilike.%' + term + '%');
    }
    var r = await q.order('created_at', { ascending: false });
    if (r.error) throw r.error;

    var users = (r.data || []).map(mapRow);
    await markDeletedBangkeros(c, users);
    return users;
  }

  // One extra query instead of a users -> bangkeros embed: the reverse
  // relationship name is not part of any tested path here (same reasoning
  // as enrichBangkeros).
  async function markDeletedBangkeros(c, users) {
    var ids = users.filter(function(u) { return u.role === 'bangkero'; }).map(function(u) { return u.uid; });
    if (!ids.length) return;
    var r = await c.from('bangkeros').select('id, is_deleted').in('id', ids);
    if (r.error) throw r.error;
    var deleted = {};
    (r.data || []).forEach(function(row) { if (row.is_deleted) deleted[row.id] = true; });
    users.forEach(function(u) { u.bangkeroDeleted = deleted[u.uid] === true; });
  }

  async function getById(uid) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var r = await c.from('users').select('*').eq('id', uid).maybeSingle();
    if (r.error) throw r.error;
    if (!r.data) return null;
    var user = mapRow(r.data);
    if (user.role === 'bangkero') {
      var b = await c.from('bangkeros').select('is_deleted').eq('id', uid).maybeSingle();
      if (b.error) throw b.error;
      user.bangkeroDeleted = b.data ? b.data.is_deleted === true : false;
    }
    return user;
  }

  // Admin: suspend / reactivate (users.is_suspended, migration 065)
  async function setSuspended(uid, suspended) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    // A sole admin who suspends themselves is locked out of the portal.
    if (suspended) {
      var auth = await c.auth.getUser();
      if (auth && auth.data && auth.data.user && auth.data.user.id === uid) {
        throw new Error('You cannot suspend your own account.');
      }
    }
    var r = await c.from('users').update({ is_suspended: !!suspended }).eq('id', uid);
    if (r.error) throw r.error;
  }

  // Admin: assign role
  async function assignRole(uid, role) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    // Matches the DB CHECK after 025 — 'lgu' is not a real role.
    var allowed = ['passenger', 'bangkero', 'admin', 'coastguard'];
    if (!allowed.includes(role)) throw new Error('Invalid role');
    var r = await c.from('users').update({ user_role: role }).eq('id', uid);
    if (r.error) throw r.error;
  }

  window.bangkagoUsers = { listAll, getById, setSuspended, assignRole };
})();