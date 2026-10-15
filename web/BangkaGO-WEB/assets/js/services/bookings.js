/**
 * Booking service for web dashboards.
 * Mirrors mobile admin booking operations (src/services/admin.service.ts).
 * Queries only the bookings table — denormalized fields provide all data needed for admin views.
 */
(function() {
  'use strict';
  var svc = window.bangkagoServices;

  function mapRow(row) {
    return {
      bookingId: row.id,
      ref: row.ref,
      serviceType: row.service_type,
      passengerCount: row.num_of_passenger,
      status: row.trip_stat,
      cancelReason: row.cancel_reason,
      departTime: row.depart_time,
      arrivalTime: row.arrival_time,
      totalPrice: row.total_price,
      createdAt: row.created_at,
      userId: row.user_id,
      bangkaId: row.bangka_id,
      routeId: row.route_id,
      packageId: row.package_id,
      passengerName: row.passenger_name,
      passengerPhone: row.passenger_phone,
      fromPortName: row.from_port_name,
      toPortName: row.to_port_name,
      operatorId: row.operator_id,
      operatorName: row.operator_name,
      operatorBoatName: row.operator_boat_name,
      rejectedBy: row.rejected_by || [],
      heldBy: row.held_by,
      holdExpiresAt: row.hold_expires_at,
      acceptedAt: row.accepted_at,
      onboardedAt: row.onboarded_at,
      disputedAt: row.disputed_at,
      noShowAt: row.no_show_at,
      completedAt: row.completed_at,
      cancelledAt: row.cancelled_at,
      scheduledDate: row.scheduled_date,
      scheduledTime: row.scheduled_time
    };
  }

  async function listAll(filters) {
    filters = filters || {};
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var q = c.from('bookings').select('*');
    if (filters.status) q = q.eq('trip_stat', filters.status);
    if (filters.userId) q = q.eq('user_id', filters.userId);
    if (filters.operatorId) q = q.eq('operator_id', filters.operatorId);
    if (filters.fromDate) q = q.gte('created_at', filters.fromDate);
    if (filters.toDate) q = q.lte('created_at', filters.toDate);
    q = q.order('created_at', { ascending: false });
    if (filters.limit) q = q.limit(filters.limit);
    var r = await q;
    if (r.error) throw r.error;
    return (r.data || []).map(mapRow);
  }

  async function getById(id) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var r = await c.from('bookings').select('*').eq('id', id).maybeSingle();
    if (r.error) throw r.error;
    return r.data ? mapRow(r.data) : null;
  }

  async function getByRef(ref) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var r = await c.from('bookings').select('*').eq('ref', ref).maybeSingle();
    if (r.error) throw r.error;
    return r.data ? mapRow(r.data) : null;
  }

  // Admin: update booking status
  async function updateStatus(bookingId, newStatus, remarks) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var allowed = ['open','pending','accepted','completed','cancelled'];
    if (!allowed.includes(newStatus)) throw new Error('Invalid status');
    var r = await c.from('bookings').update({ trip_stat: newStatus, cancel_reason: remarks || null }).eq('id', bookingId);
    if (r.error) throw r.error;
  }

  async function getStats() {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var [open, accepted, completed, cancelled, pending] = await Promise.all([
      c.from('bookings').select('*', { count: 'exact', head: true }).eq('trip_stat', 'open'),
      c.from('bookings').select('*', { count: 'exact', head: true }).eq('trip_stat', 'accepted'),
      c.from('bookings').select('*', { count: 'exact', head: true }).eq('trip_stat', 'completed'),
      c.from('bookings').select('*', { count: 'exact', head: true }).eq('trip_stat', 'cancelled'),
      c.from('bookings').select('*', { count: 'exact', head: true }).eq('trip_stat', 'pending')
    ]);
    return {
      open: open.count ?? 0,
      accepted: accepted.count ?? 0,
      completed: completed.count ?? 0,
      cancelled: cancelled.count ?? 0,
      pending: pending.count ?? 0
    };
  }

  window.bangkagoBookings = { listAll, getById, getByRef, updateStatus, getStats, mapRow };
})();