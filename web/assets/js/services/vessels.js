/**
 * Vessel tracking service for web dashboards.
 * Mirrors mobile vessel tracking operations.
 */
(function() {
  'use strict';
  var svc = window.bangkagoServices;

  function mapTracking(row) {
    return { trackId: row.id, latitude: row.latitude, longitude: row.longitude, speed: row.speed, recordedAt: row.recorded_at, bangkaId: row.bangka_id };
  }

  function mapBangka(row) {
    return { bangkaId: row.id, bangkaName: row.bangka_name, bangkaType: row.bangka_type, capacity: row.capacity, maxLoadKg: row.max_load_kg, permitNumber: row.permit_number, bangkaPhoto: row.bangka_photo, bangkeroId: row.bangkero_id, hourlyRate: row.hourly_rate };
  }

  async function getAllBangkas() {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var r = await c.from('bangkas').select('*, bangkeros(display_name, is_available, verification_stat)');
    if (r.error) throw r.error;
    return (r.data || []).map(mapBangka);
  }

  async function getAllLatestPositions() {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    // vessel_tracking is an append-only GPS log that grows forever —
    // never dump it. The last 1000 fixes (≈ hours of a full fleet
    // pinging every 10s) always cover each boat's newest position.
    var r = await c.from('vessel_tracking').select('*')
      .order('recorded_at', { ascending: false })
      .limit(1000);
    if (r.error) throw r.error;
    var seen = new Set(), latest = [];
    for (var row of r.data || []) {
      if (!seen.has(row.bangka_id)) { seen.add(row.bangka_id); latest.push(mapTracking(row)); }
    }
    return latest;
  }

  async function getPositionsForBangkas(bangkaIds) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    if (!bangkaIds?.length) return [];
    var r = await c.from('vessel_tracking').select('*').in('bangka_id', bangkaIds)
      .order('recorded_at', { ascending: false })
      .limit(500);
    if (r.error) throw r.error;
    var seen = new Set(), latest = [];
    for (var row of r.data || []) {
      if (!seen.has(row.bangka_id)) { seen.add(row.bangka_id); latest.push(mapTracking(row)); }
    }
    return latest;
  }

  async function getBangkaForBangkero(bangkeroId) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var r = await c.from('bangkas').select('id').eq('bangkero_id', bangkeroId).order('bangka_name').limit(1).maybeSingle();
    if (r.error) throw r.error;
    return r.data?.id ?? null;
  }

  async function getTrackingForBangka(bangkaId, limit) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var r = await c.from('vessel_tracking').select('*').eq('bangka_id', bangkaId).order('recorded_at', { ascending: false }).limit(limit || 50);
    if (r.error) throw r.error;
    return (r.data || []).map(mapTracking);
  }

  window.bangkagoVessels = { getAllBangkas, getAllLatestPositions, getPositionsForBangkas, getBangkaForBangkero, getTrackingForBangka };
})();