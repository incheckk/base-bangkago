/**
 * Bangkero service for web dashboards.
 * Mirrors mobile bangkero operations (src/services/admin.service.ts).
 * Queries only the bangkeros table — matches mobile app's getAllBangkeros/getBangkerosByStatus.
 * Related vessel/user data fetched separately when needed by UI.
 */
(function() {
  'use strict';
  var svc = window.bangkagoServices;

  function mapRow(row) {
    return {
      uid: row.id,
      displayName: row.display_name,
      isAvailable: row.is_available,
      verificationStat: row.verification_stat,
      permitNumber: row.permit_number,
      govIssuedId: row.gov_issued_id,
      boatRegistrationCert: row.boat_registration_cert,
      coastalPermit: row.coastal_permit,
      brgyClearance: row.brgy_clearance,
      ratingPenalty: row.rating_penalty ?? 0,
      ratingRecoveryStars: row.rating_recovery_stars ?? 0,
      gcashQrUrl: row.gcash_qr_url ?? null,
      isDeleted: row.is_deleted === true,
      deletedAt: row.deleted_at ?? null,
      updatedAt: row.updated_at,
      // Related data fetched separately when needed
      boatName: null,
      boatCapacity: null,
      phoneNumber: null,
      firstName: null,
      lastName: null,
      email: null
    };
  }

  async function listAll(options) {
    options = options || {};
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var q = c.from('bangkeros').select('*');
    q = options.deleted === true ? q.eq('is_deleted', true) : q.eq('is_deleted', false);
    if (options.verificationStat) q = q.eq('verification_stat', options.verificationStat);
    if (options.isAvailable !== undefined) q = q.eq('is_available', options.isAvailable);
    var r = await q.order('updated_at', { ascending: false });
    if (r.error) throw r.error;
    return (r.data || []).map(mapRow);
  }

  function listDeleted() {
    return listAll({ deleted: true });
  }

  async function getById(uid) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var r = await c.from('bangkeros').select('*').eq('id', uid).maybeSingle();
    if (r.error) throw r.error;
    return r.data ? mapRow(r.data) : null;
  }

  // Fetch bangka (vessel) info for a bangkero — separate query to avoid JOIN RLS issues
  async function getBangkaForBangkero(bangkeroId) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var r = await c.from('bangkas').select('bangka_name, capacity').eq('bangkero_id', bangkeroId).order('bangka_name').limit(1).maybeSingle();
    if (r.error) throw r.error;
    return r.data ? { boatName: r.data.bangka_name, boatCapacity: r.data.capacity } : { boatName: null, boatCapacity: null };
  }

  // Fetch user info for a bangkero — separate query to avoid JOIN RLS issues
  async function getUserForBangkero(bangkeroId) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    // bangkeros.id references users.id
    var r = await c.from('users').select('phone_number, first_name, last_name, email').eq('id', bangkeroId).maybeSingle();
    if (r.error) throw r.error;
    return r.data ? {
      phoneNumber: r.data.phone_number,
      firstName: r.data.first_name,
      lastName: r.data.last_name,
      email: r.data.email
    } : { phoneNumber: null, firstName: null, lastName: null, email: null };
  }

  // Enrich bangkero list with boat and user data (for pages that need it).
  // Two batched queries total (was 2 per row — 40 round-trips on a
  // 20-bangkero list over venue wifi). One boat per bangkero: first by name.
  async function enrichBangkeros(bangkeros) {
    var ids = bangkeros.map(function(b) { return b.uid; });
    if (!ids.length) return [];
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var byId = {};
    bangkeros.forEach(function(b) { byId[b.uid] = b; });

    var boatsRes = await c.from('bangkas')
      .select('bangka_name, capacity, bangkero_id')
      .in('bangkero_id', ids)
      .order('bangka_name');
    var usersRes = await c.from('users')
      .select('id, phone_number, first_name, last_name, email')
      .in('id', ids);

    (boatsRes.data || []).forEach(function(bk) {
      var b = byId[bk.bangkero_id];
      // First boat by name wins; don't overwrite an earlier one.
      if (b && b.boatName === null) {
        b.boatName = bk.bangka_name;
        b.boatCapacity = bk.capacity;
      }
    });
    (usersRes.data || []).forEach(function(u) {
      var b = byId[u.id];
      if (b) {
        b.phoneNumber = u.phone_number;
        b.firstName = u.first_name;
        b.lastName = u.last_name;
        b.email = u.email;
      }
    });
    return bangkeros;
  }

  // Admin: approve/reject via RPC (update_bangkero_verification)
  async function updateVerification(uid, status, remarks) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var r = await c.rpc('update_bangkero_verification', { p_bangkero_id: uid, p_status: status, p_remarks: remarks ?? null });
    if (r.error) throw r.error;
  }

  async function softDelete(uid) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var r = await c.rpc('admin_delete_bangkero', { p_bangkero_id: uid });
    if (r.error) throw r.error;
  }

  async function restore(uid) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var r = await c.rpc('admin_restore_bangkero', { p_bangkero_id: uid });
    if (r.error) throw r.error;
  }

  async function setAvailability(uid, isAvailable) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var r = await c.from('bangkeros').update({ is_available: isAvailable, updated_at: new Date().toISOString() }).eq('id', uid);
    if (r.error) throw r.error;
  }

  window.bangkagoBangkeros = { listAll, listDeleted, getById, getBangkaForBangkero, getUserForBangkero, enrichBangkeros, updateVerification, softDelete, restore, setAvailability };
})();