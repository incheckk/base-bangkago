/**
 * Bangka (vessel) management service for web dashboards.
 * Mirrors mobile bangka operations.
 */
(function() {
  'use strict';
  var svc = window.bangkagoServices;

  function mapRow(row) {
    return {
      bangkaId: row.id,
      bangkaName: row.bangka_name,
      bangkaType: row.bangka_type,
      permitNumber: row.permit_number,
      bangkaPhoto: row.bangka_photo,
      capacity: row.capacity,
      maxLoadKg: row.max_load_kg,
      bangkeroId: row.bangkero_id,
      hourlyRate: row.hourly_rate,
      // joined bangkero fields
      bangkeroName: row.bangkeros?.display_name ?? null,
      bangkeroAvailable: row.bangkeros?.is_available ?? null,
      bangkeroVerification: row.bangkeros?.verification_stat ?? null
      // route fields removed - no direct FK between bangkas and routes
    };
  }

  async function listAll(options) {
    options = options || {};
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var q = c.from('bangkas').select('*, bangkeros(display_name, is_available, verification_stat)');
    if (options.bangkeroId) q = q.eq('bangkero_id', options.bangkeroId);
    if (options.bangkaType) q = q.eq('bangka_type', options.bangkaType);
    var r = await q.order('bangka_name', { ascending: true });
    if (r.error) throw r.error;
    return (r.data || []).map(mapRow);
  }

  async function getById(id) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var r = await c.from('bangkas').select('*, bangkeros(display_name, is_available, verification_stat)').eq('id', id).maybeSingle();
    if (r.error) throw r.error;
    return r.data ? mapRow(r.data) : null;
  }

  async function create(data) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var insertData = {
      bangka_name: data.bangkaName,
      bangka_type: data.bangkaType,
      permit_number: data.permitNumber,
      bangka_photo: data.bangkaPhoto,
      capacity: data.capacity,
      max_load_kg: data.maxLoadKg,
      bangkero_id: data.bangkeroId,
      hourly_rate: data.hourlyRate
    };
    var r = await c.from('bangkas').insert(insertData).select().single();
    if (r.error) throw r.error;
    return mapRow(r.data);
  }

  async function update(id, data) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var updateData = {};
    if (data.bangkaName !== undefined) updateData.bangka_name = data.bangkaName;
    if (data.bangkaType !== undefined) updateData.bangka_type = data.bangkaType;
    if (data.permitNumber !== undefined) updateData.permit_number = data.permitNumber;
    if (data.bangkaPhoto !== undefined) updateData.bangka_photo = data.bangkaPhoto;
    if (data.capacity !== undefined) updateData.capacity = data.capacity;
    if (data.maxLoadKg !== undefined) updateData.max_load_kg = data.maxLoadKg;
    if (data.bangkeroId !== undefined) updateData.bangkero_id = data.bangkeroId;
    if (data.hourlyRate !== undefined) updateData.hourly_rate = data.hourlyRate;
    if (Object.keys(updateData).length === 0) return;
    var r = await c.from('bangkas').update(updateData).eq('id', id);
    if (r.error) throw r.error;
  }

  async function del(id) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    // Check for active trips using this bangka
    var tripCheck = await c.from('bookings').select('id', { count: 'exact', head: true }).eq('bangka_id', id).in('trip_stat', ['open', 'pending', 'accepted']);
    if (tripCheck.error) throw tripCheck.error;
    if (tripCheck.count > 0) {
      throw new Error('Cannot delete: bangka has ' + tripCheck.count + ' active trip(s). Complete or reassign trips first.');
    }
    var r = await c.from('bangkas').delete().eq('id', id);
    if (r.error) throw r.error;
  }

  // setStatus: bangkas table doesn't have a dedicated status column.
  // Status is derived from bangkero verification + availability + active bookings.
  // We can only "deactivate" by unassigning from bangkero (set bangkero_id = null).
  async function setStatus(id, status, notes) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    if (status === 'Deactivated') {
      // Unassign from bangkero
      var r = await c.from('bangkas').update({ bangkero_id: null }).eq('id', id);
      if (r.error) throw r.error;
    } else if (status === 'Available' || status === 'On Trip' || status === 'Offline' || status === 'Unverified') {
      // These are derived states, not directly settable on bangka
      // Could set bangkero.is_available for Offline/Available
      throw new Error('Status "' + status + '" is derived from bangkero availability and active bookings. Use bangkero controls to change.');
    } else if (status === 'Maintenance Due') {
      // Would need a maintenance_due boolean column or separate table
      throw new Error('"Maintenance Due" status requires database schema update (add maintenance_due column to bangkas).');
    } else {
      throw new Error('Unknown status: ' + status);
    }
  }

  window.bangkagoBangkas = { listAll, getById, create, update, delete: del, setStatus };
})();