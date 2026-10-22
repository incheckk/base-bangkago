/**
 * Booking service for web dashboards.
 * Mirrors mobile booking operations.
 */
(function() {
  'use strict';
  var svc = window.bangkagoServices;

  // Joined context the admin console needs: the account name/phone for
  // bookings whose denormalized passenger fields are empty, and any GCash
  // downpayment that must be refunded before the trip can be cancelled.
  var SELECT = '*, passenger:users!bookings_user_id_fkey(first_name,last_name,phone_number), downpayments(id,status,amount,created_at)';

  function fullName(user) {
    return user ? [user.first_name, user.last_name].filter(Boolean).join(' ') : '';
  }

  function mapRow(row) {
    var passenger = row.passenger ?? null;
    var downs = Array.isArray(row.downpayments) ? row.downpayments : [];
    var latestDown = downs.slice().sort(function(a, b) {
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    })[0] ?? null;

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
      customerName: row.passenger_name || fullName(passenger) || null,
      customerPhone: row.passenger_phone || passenger?.phone_number || null,
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
      scheduledTime: row.scheduled_time,
      downpaymentStatus: latestDown?.status ?? null,
      downpaymentAmount: latestDown ? Number(latestDown.amount) : null,
      openDownpayment: downs.some(function(d) {
        return d.status === 'pending' || d.status === 'approved';
      })
    };
  }

  async function listAll(filters) {
    filters = filters || {};
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var q = c.from('bookings').select(SELECT);
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
    var r = await c.from('bookings').select(SELECT).eq('id', id).maybeSingle();
    if (r.error) throw r.error;
    return r.data ? mapRow(r.data) : null;
  }

  async function getByRef(ref) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var r = await c.from('bookings').select(SELECT).eq('ref', ref).maybeSingle();
    if (r.error) throw r.error;
    return r.data ? mapRow(r.data) : null;
  }

  /**
   * Admin cancellation. The database is the authority: it refuses
   * departed/boarded trips and any booking holding a live escrow row,
   * and it notifies the passenger. UI guards are only a convenience.
   */
  async function cancel(bookingId, reason) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var r = await c.rpc('admin_cancel_booking', {
      p_booking_id: bookingId,
      p_reason: reason || null
    });
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

  window.bangkagoBookings = { listAll, getById, getByRef, cancel, getStats, mapRow };
})();
