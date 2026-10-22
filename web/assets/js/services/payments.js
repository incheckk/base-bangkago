/**
 * Payments & Downpayments service for web dashboards.
 * Mirrors mobile payment operations.
 */
(function() {
  'use strict';
  var svc = window.bangkagoServices;

  function fullName(user) {
    return user ? [user.first_name, user.last_name].filter(Boolean).join(' ') : '';
  }

  function mapPayment(row) {
    var booking = row.booking ?? null;
    return {
      paymentId: row.id,
      type: 'fare',
      amount: Number(row.amount),
      paymentMethod: row.payment_method,
      paymentStatus: row.payment_status,
      referenceNum: row.reference_num ?? '',
      createdAt: row.created_at,
      bookingId: row.booking_id,
      bookingRef: booking?.ref ?? null,
      targetStatus: booking?.trip_stat ?? null,
      serviceLabel: booking
        ? `${booking.from_port_name ?? '—'} → ${booking.to_port_name ?? '—'}`
        : null,
      payerName: booking?.passenger_name || fullName(booking?.user) || 'Unknown',
      user: booking?.user ?? null
    };
  }

  function mapDownpayment(row) {
    var booking = row.booking ?? null;
    var rental = row.boatRental ?? null;
    var rentalFallback = rental?.id ? 'Charter ' + String(rental.id).slice(0, 6).toUpperCase() : 'Boat rental';
    return {
      downpaymentId: row.id,
      type: 'downpayment',
      amount: Number(row.amount),
      paymentMethod: row.payment_method ?? 'gcash',
      paymentStatus: row.status,
      referenceNum: row.reference_num ?? '',
      proofUrl: row.proof_url,
      status: row.status,
      bookingId: row.booking_id,
      boatRentalId: row.boat_rental_id,
      createdAt: row.created_at,
      reviewedAt: row.reviewed_at,
      user: booking?.user ?? rental?.user ?? null,
      // Context for the escrow review page (mirrors AdminDownpaymentRow).
      label: booking?.ref ?? rental?.event_name ?? rentalFallback,
      bookingRef: booking?.ref ?? null,
      serviceLabel: booking
        ? `${booking.from_port_name ?? '—'} → ${booking.to_port_name ?? '—'}`
        : rental
          ? `${rental.rental_date ?? ''}${rental.hours ? ' · ' + rental.hours + 'h' : ''}`
          : '—',
      payerName: booking?.passenger_name || fullName(booking?.user ?? rental?.user) || 'Unknown',
      notifyUserId: booking?.user_id ?? rental?.user_id ?? null,
      rentalBangkeroId: rental?.bangka?.bangkero_id ?? null,
      rentalBoatName: rental?.bangka?.bangka_name ?? null,
      targetStatus: booking?.trip_stat ?? rental?.status ?? null
    };
  }

  async function listPayments(filters) {
    filters = filters || {};
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var q = c.from('payments').select('*, booking:bookings(ref, passenger_name, total_price, trip_stat, from_port_name, to_port_name, user:users!bookings_user_id_fkey(first_name, last_name))');
    if (filters.status) q = q.eq('payment_status', filters.status);
    if (filters.bookingId) q = q.eq('booking_id', filters.bookingId);
    q = q.order('created_at', { ascending: false });
    if (filters.limit) q = q.limit(filters.limit);
    var r = await q; if (r.error) throw r.error;
    return (r.data || []).map(mapPayment);
  }

  async function listDownpayments(filters) {
    filters = filters || {};
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var q = c.from('downpayments').select('*, booking:bookings(ref, passenger_name, from_port_name, to_port_name, user_id, trip_stat, user:users!bookings_user_id_fkey(first_name, last_name)), boatRental:boat_rentals(id, event_name, rental_date, hours, status, user_id, user:users!boat_rentals_user_id_fkey(first_name, last_name), bangka:bangkas(bangka_name, bangkero_id))');
    if (filters.status) q = q.eq('status', filters.status);
    q = q.order('created_at', { ascending: false });
    if (filters.limit) q = q.limit(filters.limit);
    var r = await q; if (r.error) throw r.error;
    return (r.data || []).map(mapDownpayment);
  }

  /** Best-effort — a bell ping must never fail the money action. */
  async function notify(userId, title, message) {
    if (!userId) return;
    var c = svc.getClient(); if (!c) return;
    try {
      await c.from('notifications').insert({ user_id: userId, title: title, message: message, is_read: false });
    } catch (e) { /* realtime refresh covers the demo */ }
  }

  /**
   * Approve escrow: only a still-pending row moves, so a double-click
   * cannot approve twice. If the gate RPC fails, the row is restored
   * before the error surfaces.
   */
  async function approveDownpayment(row) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    if (row.targetStatus === 'cancelled') {
      throw new Error('This trip is already cancelled. Refund the downpayment instead of approving it.');
    }

    var r = await c.from('downpayments')
      .update({ status: 'approved', reviewed_at: new Date().toISOString() })
      .eq('id', row.downpaymentId)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();
    if (r.error) throw r.error;
    if (!r.data) throw new Error('This downpayment was already reviewed. Refresh the page.');

    var g = await c.rpc('review_advance_escrow', {
      p_booking_id: row.bookingId ?? null,
      p_rental_id: row.boatRentalId ?? null,
      p_approve: true,
    });
    if (g.error) {
      await c.from('downpayments')
        .update({ status: 'pending', reviewed_at: null })
        .eq('id', row.downpaymentId)
        .eq('status', 'approved');
      throw g.error;
    }

    if (g.data) {
      await notify(row.notifyUserId, 'Downpayment confirmed',
        `Your GCash downpayment of ₱${row.amount} for ${row.label} has been confirmed. It is now visible to bangkeros.`);
      if (row.boatRentalId && row.rentalBangkeroId) {
        await notify(row.rentalBangkeroId, 'New boat rental request',
          `${row.payerName ?? 'A passenger'} wants to rent ${row.rentalBoatName ?? 'your boat'} (${row.serviceLabel}). The downpayment is approved — confirm or decline.`);
      }
    }
  }

  /**
   * Refund escrow. Pending and approved rows can be refunded once;
   * an approved row whose trip already left review only flips the
   * escrow record (the booking itself is cancelled separately).
   */
  async function refundDownpayment(row) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    if (row.status !== 'pending' && row.status !== 'approved') {
      throw new Error('This downpayment is already refunded.');
    }
    var previousStatus = row.status;
    var previousReviewedAt = row.reviewedAt ?? null;

    var r = await c.from('downpayments')
      .update({ status: 'refunded', reviewed_at: new Date().toISOString() })
      .eq('id', row.downpaymentId)
      .in('status', ['pending', 'approved'])
      .select('id')
      .maybeSingle();
    if (r.error) throw r.error;
    if (!r.data) throw new Error('This downpayment was already refunded or changed. Refresh the page.');

    var g = await c.rpc('review_advance_escrow', {
      p_booking_id: row.bookingId ?? null,
      p_rental_id: row.boatRentalId ?? null,
      p_approve: false,
    });
    if (g.error) {
      await c.from('downpayments')
        .update({ status: previousStatus, reviewed_at: previousReviewedAt })
        .eq('id', row.downpaymentId)
        .eq('status', 'refunded');
      throw g.error;
    }

    await notify(row.notifyUserId, 'Downpayment refunded',
      `Your GCash downpayment of ₱${row.amount} for ${row.label} has been refunded.`);
  }

  window.bangkagoPayments = { listPayments, listDownpayments, approveDownpayment, refundDownpayment };
})();
