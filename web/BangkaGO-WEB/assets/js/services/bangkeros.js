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
      gcashQrUrl: row.gcash_qr_url ?? null,
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
    if (options.verificationStat) q = q.eq('verification_stat', options.verificationStat);
    if (options.isAvailable !== undefined) q = q.eq('is_available', options.isAvailable);
    var r = await q.order('updated_at', { ascending: false });
    if (r.error) throw r.error;
    return (r.data || []).map(mapRow);
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

  // Enrich bangkero list with boat and user data (for pages that need it)
  async function enrichBangkeros(bangkeros) {
    var enriched = [];
    for (var i = 0; i < bangkeros.length; i++) {
      var b = bangkeros[i];
      var bangka = await getBangkaForBangkero(b.uid);
      var user = await getUserForBangkero(b.uid);
      enriched.push(Object.assign({}, b, bangka, user));
    }
    return enriched;
  }

  // Admin: approve/reject via RPC (update_bangkero_verification)
  async function updateVerification(uid, status, remarks) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var r = await c.rpc('update_bangkero_verification', { p_bangkero_id: uid, p_status: status, p_remarks: remarks ?? null });
    if (r.error) throw r.error;
  }

  async function setAvailability(uid, isAvailable) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var r = await c.from('bangkeros').update({ is_available: isAvailable, updated_at: new Date().toISOString() }).eq('id', uid);
    if (r.error) throw r.error;
  }

  window.bangkagoBangkeros = { listAll, getById, getBangkaForBangkero, getUserForBangkero, enrichBangkeros, updateVerification, setAvailability };
})();