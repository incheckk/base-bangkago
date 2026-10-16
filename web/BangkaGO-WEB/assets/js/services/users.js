/**
 * User management service for web dashboards.
 * Mirrors mobile admin user operations (src/services/admin.service.ts).
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
      isVerified: row.is_verified,
      createdAt: row.created_at
    };
  }

  async function listAll(options) {
    options = options || {};
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var q = c.from('users').select('*');
    if (options.role) q = q.eq('user_role', options.role);
    if (options.isVerified !== undefined) q = q.eq('is_verified', options.isVerified);
    if (options.search) {
      var term = options.search.toLowerCase();
      q = q.or('first_name.ilike.%' + term + '%,last_name.ilike.%' + term + '%,email.ilike.%' + term + '%,phone_number.ilike.%' + term + '%');
    }
    var r = await q.order('created_at', { ascending: false });
    if (r.error) throw r.error;
    return (r.data || []).map(mapRow);
  }

  async function getById(uid) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var r = await c.from('users').select('*').eq('id', uid).maybeSingle();
    if (r.error) throw r.error;
    return r.data ? mapRow(r.data) : null;
  }

  // Admin: suspend user (sets is_verified = false)
  async function suspend(uid) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var r = await c.from('users').update({ is_verified: false }).eq('id', uid);
    if (r.error) throw r.error;
  }

  // Admin: assign role
  async function assignRole(uid, role) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var allowed = ['passenger', 'bangkero', 'admin', 'coastguard', 'lgu'];
    if (!allowed.includes(role)) throw new Error('Invalid role');
    var r = await c.from('users').update({ user_role: role }).eq('id', uid);
    if (r.error) throw r.error;
  }

  window.bangkagoUsers = { listAll, getById, suspend, assignRole };
})();