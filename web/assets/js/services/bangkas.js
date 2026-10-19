/**
 * Bangka (vessel) management service for web dashboards.
 * Mirrors mobile bangka operations.
 */
(function() {
  'use strict';
  var svc = window.bangkagoServices;

  function mapRow(row, usage) {
    var bangkero = row.bangkeros || null;
    var status = usage ? 'Unavailable'
      : row.is_active === false || !row.bangkero_id || bangkero?.verification_stat !== 'verified' ? 'Unverified'
        : bangkero?.is_available ? 'Available' : 'Offline';
    return {
      bangkaId: row.id,
      bangkaName: row.bangka_name,
      bangkaType: row.bangka_type,
      permitNumber: row.permit_number,
      bangkaPhoto: row.bangka_photo,
      capacity: row.capacity,
      maxLoadKg: row.max_load_kg,
      bangkeroId: row.bangkero_id,
      isActive: row.is_active !== false,
      isDeleted: row.is_deleted === true,
      deletedAt: row.deleted_at ?? null,
      hourlyRate: row.hourly_rate,
      // joined bangkero fields
      bangkeroName: bangkero?.display_name ?? null,
      bangkeroAvailable: bangkero?.is_available ?? null,
      bangkeroVerification: bangkero?.verification_stat ?? null,
      activeBookingRef: usage?.booking?.ref ?? null,
      activeUseLabel: usage?.rental ? `Rental ${usage.rental.event_name || ''}`.trim() : null,
      activeRoute: usage?.booking
        ? [usage.booking.from_port_name, usage.booking.to_port_name].filter(Boolean).join(' → ')
        : null,
      status
    };
  }

  async function listAll(options) {
    options = options || {};
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var q = c.from('bangkas').select('*, bangkeros(display_name, is_available, verification_stat)');
    q = options.deleted === true ? q.eq('is_deleted', true) : q.eq('is_deleted', false);
    if (options.bangkeroId) q = q.eq('bangkero_id', options.bangkeroId);
    if (options.bangkaType) q = q.eq('bangka_type', options.bangkaType);
    if (options.assignment === 'active') q = q.eq('is_active', true);
    if (options.assignment === 'deactivated') q = q.eq('is_active', false);
    var r = await q.order('bangka_name', { ascending: true });
    if (r.error) throw r.error;

    var activeByBangka = {};
    if (options.includeActivity && r.data?.length) {
      var ids = r.data.map(function(row) { return row.id; });
      var results = await Promise.all([
        c.from('bookings')
          .select('bangka_id, ref, trip_stat, from_port_name, to_port_name, created_at')
          .in('bangka_id', ids)
          .in('trip_stat', ['open', 'pending', 'accepted'])
          .order('created_at', { ascending: false }),
        c.from('boat_rentals')
          .select('bangka_id, event_name, status, created_at')
          .in('bangka_id', ids)
          .in('status', ['awaiting_payment', 'pending', 'confirmed'])
          .order('created_at', { ascending: false }),
      ]);
      if (results[0].error) throw results[0].error;
      if (results[1].error) throw results[1].error;
      (results[0].data || []).forEach(function(booking) {
        if (booking.bangka_id && !activeByBangka[booking.bangka_id]) activeByBangka[booking.bangka_id] = {};
        if (booking.bangka_id && !activeByBangka[booking.bangka_id].booking) {
          activeByBangka[booking.bangka_id].booking = booking;
        }
      });
      (results[1].data || []).forEach(function(rental) {
        if (rental.bangka_id && !activeByBangka[rental.bangka_id]) activeByBangka[rental.bangka_id] = {};
        if (rental.bangka_id && !activeByBangka[rental.bangka_id].rental) {
          activeByBangka[rental.bangka_id].rental = rental;
        }
      });
    }
    return (r.data || []).map(function(row) { return mapRow(row, activeByBangka[row.id]); });
  }

  function listDeleted(options) {
    options = Object.assign({}, options, { deleted: true });
    return listAll(options);
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
      hourly_rate: data.hourlyRate,
      is_active: true,
      is_deleted: false
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
    var r = await c.rpc('admin_delete_bangka', { p_bangka_id: id });
    if (r.error) throw r.error;
  }

  async function restore(id) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var r = await c.rpc('admin_restore_bangka', { p_bangka_id: id });
    if (r.error) throw r.error;
  }

  // Vessel status is derived; activation assigns a verified owner and deactivation unassigns it.
  async function setStatus(id, status, bangkeroId) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var ownerId = null;
    if (status !== 'Activate' && status !== 'Deactivate') {
      throw new Error('Choose Activate or Deactivate.');
    }

    var activeTrips = await c.from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('bangka_id', id)
      .in('trip_stat', ['open', 'pending', 'accepted']);
    if (activeTrips.error) throw activeTrips.error;
    var activeRentals = await c.from('boat_rentals')
      .select('id', { count: 'exact', head: true })
      .eq('bangka_id', id)
      .in('status', ['awaiting_payment', 'pending', 'confirmed']);
    if (activeRentals.error) throw activeRentals.error;
    if (activeTrips.count > 0 || activeRentals.count > 0) {
      throw new Error('This vessel is currently in use. Complete or cancel its active bookings or rentals before changing its status.');
    }

    if (status === 'Activate') {
      ownerId = String(bangkeroId || '').trim();
      if (!ownerId) throw new Error('Choose a verified bangkero to activate this vessel.');
      var owner = await c.from('bangkeros')
        .select('id, verification_stat, is_deleted')
        .eq('id', ownerId)
        .maybeSingle();
      if (owner.error) throw owner.error;
      if (!owner.data || owner.data.is_deleted || owner.data.verification_stat !== 'verified') {
        throw new Error('Only a currently verified bangkero can be assigned. Refresh the page and choose another owner.');
      }
    }

    var changes = status === 'Activate'
      ? { is_active: true, bangkero_id: ownerId }
      : { is_active: false };
    var r = await c.from('bangkas')
      .update(changes)
      .eq('id', id)
      .select('id')
      .maybeSingle();
    if (r.error) throw r.error;
    if (!r.data) throw new Error('No vessel was updated. Confirm migration 045 is applied and that you are signed in as an admin.');
    return r.data.id;
  }

  window.bangkagoBangkas = { listAll, listDeleted, getById, create, update, delete: del, restore, setStatus };
})();