/**
 * Admin island-hop package and booking operations.
 * Uses the existing island_packages, bookings, bangkas, ports, and routes tables.
 */
(function() {
  'use strict';
  var svc = window.bangkagoServices;
  var PACKAGE_SELECT =
    '*, bangkas!island_packages_bangka_id_fkey(id,bangka_name,capacity,bangkero_id,is_active,is_deleted,deleted_at,bangkeros(display_name,verification_stat,is_deleted,deleted_at))';

  function mapPackage(row) {
    var boat = Array.isArray(row.bangkas) ? row.bangkas[0] : row.bangkas || null;
    var bangkero = boat && Array.isArray(boat.bangkeros) ? boat.bangkeros[0] : boat && boat.bangkeros;
    var assignmentEligible = !!(
      boat &&
      boat.is_active &&
      !boat.is_deleted &&
      !boat.deleted_at &&
      bangkero &&
      bangkero.verification_stat === 'verified' &&
      !bangkero.is_deleted &&
      !bangkero.deleted_at
    );
    return {
      packageId: row.id,
      packageName: row.package_name,
      description: row.description,
      price: Number(row.price),
      maxCapacity: Number(row.max_capacity),
      durationHours: Number(row.duration_hours),
      stops: Array.isArray(row.stops) ? row.stops : [],
      bangkaId: row.bangka_id,
      bangkaName: boat ? boat.bangka_name : null,
      bangkaCapacity: boat ? Number(boat.capacity) : null,
      bangkeroName: bangkero ? bangkero.display_name : null,
      assignmentEligible: assignmentEligible,
      deletedAt: row.deleted_at || null,
      isActive: row.is_active !== false
    };
  }

  function mapBooking(row) {
    var user = row.passenger || null;
    var boat = row.assigned_bangka || null;
    return {
      bookingId: row.id,
      ref: row.ref,
      packageId: row.package_id,
      customerName: row.passenger_name ||
        (user ? [user.first_name, user.last_name].filter(Boolean).join(' ') : '') || 'Unknown',
      customerPhone: row.passenger_phone || (user && user.phone_number) || '',
      passengerCount: Number(row.num_of_passenger),
      status: row.trip_stat,
      scheduledDate: row.scheduled_date,
      scheduledTime: row.scheduled_time,
      totalPrice: Number(row.total_price),
      bangkaName: boat ? boat.bangka_name : null,
      departed: !!row.depart_time,
      boarded: !!row.onboarded_at
    };
  }

  async function listPackages() {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var r = await c.from('island_packages').select(PACKAGE_SELECT)
      .is('deleted_at', null)
      .order('package_name');
    if (r.error) throw r.error;
    return (r.data || []).map(mapPackage);
  }

  async function listDeletedPackages() {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var r = await c.from('island_packages').select(PACKAGE_SELECT)
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false });
    if (r.error) throw r.error;
    return (r.data || []).map(mapPackage);
  }

  async function listPorts() {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var r = await c.from('ports').select('id,port_name,is_active').order('sort_order');
    if (r.error) throw r.error;
    return r.data || [];
  }

  async function listRoutes() {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var r = await c.from('routes').select('id,is_active');
    if (r.error) throw r.error;
    return r.data || [];
  }

  async function listBangkas() {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var r = await c.from('bangkas')
      .select('id,bangka_name,capacity,bangkero_id,bangkeros!inner(display_name,verification_stat,is_deleted,deleted_at)')
      .eq('is_active', true)
      .eq('is_deleted', false)
      .is('deleted_at', null)
      .eq('bangkeros.verification_stat', 'verified')
      .eq('bangkeros.is_deleted', false)
      .is('bangkeros.deleted_at', null)
      .order('bangka_name');
    if (r.error) throw r.error;
    return r.data || [];
  }

  async function savePackage(id, input) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var name = String(input.packageName || '').trim();
    var description = String(input.description || '').trim();
    var stops = Array.isArray(input.stops) ? input.stops : [];
    var price = Number(input.price);
    var capacity = Number(input.maxCapacity);
    var duration = Number(input.durationHours);

    if (name.length < 2 || name.length > 100) throw new Error('Package name must be 2–100 characters.');
    if (!Number.isFinite(price) || price <= 0) throw new Error('Price must be greater than zero.');
    if (!Number.isFinite(duration) || duration <= 0 || duration > 24) {
      throw new Error('Duration must be greater than zero and no more than 24 hours.');
    }
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 200) {
      throw new Error('Passenger capacity must be a whole number between 1 and 200.');
    }
    if (stops.length < 2 || new Set(stops).size !== stops.length) {
      throw new Error('Choose at least two unique destinations in itinerary order.');
    }
    if (!input.bangkaId) throw new Error('Assign an active Bangka to this package.');

    var [ports, routes, eligibleBangkas] = await Promise.all([listPorts(), listRoutes(), listBangkas()]);
    var assignedBangka = eligibleBangkas.find(function(b) { return b.id === input.bangkaId; });
    if (!assignedBangka) {
      throw new Error('The selected Bangka is no longer active or its Bangkero is not verified. Refresh and choose an eligible Bangka.');
    }
    var capacity = Number(assignedBangka.capacity);
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 200) {
      throw new Error('The selected Bangka must have a valid capacity between 1 and 200 passengers.');
    }
    if (Number(input.maxCapacity) > capacity) {
      throw new Error('Package passenger capacity cannot exceed the assigned Bangka capacity.');
    }
    var activePorts = new Set(ports.filter(function(p) { return p.is_active; }).map(function(p) { return p.id; }));
    if (stops.some(function(id) { return !activePorts.has(id); })) {
      throw new Error('Every destination must be an active port.');
    }
    var routeId = stops[0] + '__' + stops[stops.length - 1];
    if (!routes.some(function(r) { return r.id === routeId && r.is_active; })) {
      throw new Error('No active route connects the first and last destinations.');
    }

    var data = {
      package_name: name,
      description: description || null,
      price: price,
      max_capacity: Number(input.maxCapacity),
      duration_hours: duration,
      stops: stops,
      bangka_id: assignedBangka.id,
      is_active: input.isActive === true
    };
    var result = id
      ? await c.from('island_packages').update(data).eq('id', id).select('id').maybeSingle()
      : await c.from('island_packages').insert(data).select('id').single();
    if (result.error) throw result.error;
    if (!result.data) throw new Error('Package was not saved. Check your admin access and retry.');
  }

  async function deletePackage(id) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var r = await c.rpc('admin_delete_island_package', { p_package_id: id });
    if (r.error) throw r.error;
  }

  async function restorePackage(id) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var r = await c.rpc('admin_restore_island_package', { p_package_id: id });
    if (r.error) throw r.error;
  }

  async function listBookings() {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var r = await c.from('bookings')
      .select('id,ref,package_id,passenger_name,passenger_phone,num_of_passenger,trip_stat,scheduled_date,scheduled_time,total_price,depart_time,onboarded_at,passenger:users!bookings_user_id_fkey(first_name,last_name,phone_number),assigned_bangka:bangkas!bookings_bangka_id_fkey(bangka_name)')
      .not('package_id', 'is', null)
      .order('scheduled_date', { ascending: false })
      .limit(500);
    if (r.error) throw r.error;
    return (r.data || []).map(mapBooking);
  }

  function cancelBooking(id, reason) {
    if (!window.bangkagoBookings || typeof window.bangkagoBookings.cancel !== 'function') {
      throw new Error('Booking cancellation service is unavailable.');
    }
    return window.bangkagoBookings.cancel(id, reason);
  }

  async function rescheduleBooking(id, date, time) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var result = await c.rpc('admin_reschedule_island_booking', {
      p_booking_id: id,
      p_scheduled_date: date,
      p_scheduled_time: time || null
    });
    if (result.error) throw result.error;
  }

  window.bangkagoIslandPackages = {
    listPackages: listPackages,
    listDeletedPackages: listDeletedPackages,
    listPorts: listPorts,
    listRoutes: listRoutes,
    listBangkas: listBangkas,
    savePackage: savePackage,
    deletePackage: deletePackage,
    restorePackage: restorePackage,
    listBookings: listBookings,
    rescheduleBooking: rescheduleBooking,
    cancelBooking: cancelBooking
  };
})();
