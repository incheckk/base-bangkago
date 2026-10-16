/**
 * Payments & Downpayments service for web dashboards.
 * Mirrors mobile payment operations.
 */
(function() {
  'use strict';
  var svc = window.bangkagoServices;

  function mapPayment(row) {
    return { paymentId: row.id, amount: row.amount, paymentMethod: row.payment_method, paymentStatus: row.payment_status, referenceNum: row.reference_num, createdAt: row.created_at, bookingId: row.booking_id, booking: row.booking ?? null, user: row.booking?.user ?? null };
  }
  function mapDownpayment(row) {
    var booking = row.booking ?? null;
    var rental = row.boatRental ?? null;
    return {
      downpaymentId: row.id,
      amount: row.amount,
      referenceNum: row.reference_num,
      proofUrl: row.proof_url,
      status: row.status,
      bookingId: row.booking_id,
      boatRentalId: row.boat_rental_id,
      createdAt: row.created_at,
      reviewedAt: row.reviewed_at,
      user: booking?.user ?? rental?.user ?? null,
      // Context for the escrow review page (mirrors AdminDownpaymentRow).
      label: booking?.ref ?? rental?.event_name ?? 'Boat rental',
      serviceLabel: booking
        ? `${booking.from_port_name ?? '—'} → ${booking.to_port_name ?? '—'}`
        : rental
          ? `${rental.rental_date ?? ''}${rental.hours ? ' · ' + rental.hours + 'h' : ''}`
          : '—',
      payerName: booking?.passenger_name
        ?? (booking?.user || rental?.user
          ? [booking?.user?.first_name ?? rental?.user?.first_name, booking?.user?.last_name ?? rental?.user?.last_name].filter(Boolean).join(' ')
          : null),
      notifyUserId: booking?.user_id ?? rental?.user_id ?? null,
      rentalBangkeroId: rental?.bangka?.bangkero_id ?? null,
      rentalBoatName: rental?.bangka?.bangka_name ?? null,
    };
  }

  async function listPayments(filters) {
    filters = filters || {};
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var q = c.from('payments').select('*, booking:bookings(ref, passenger_name, total_price, user:users!bookings_user_id_fkey(first_name, last_name))');
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
    var q = c.from('downpayments').select('*, booking:bookings(ref, passenger_name, from_port_name, to_port_name, user_id, user:users!bookings_user_id_fkey(first_name, last_name)), boatRental:boat_rentals(event_name, rental_date, hours, user_id, user:users!boat_rentals_user_id_fkey(first_name, last_name), bangka:bangkas(bangka_name, bangkero_id))');
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
   * Approve escrow (mirrors mobile approveDownpayment): flip the row,
   * then open the gate — advance booking pending → open, rental
   * awaiting_payment → pending (020). Payer and, for rentals, the
   * bangkero are notified; approval must not roll back over a ping.
   */
  async function approveDownpayment(row) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var r = await c.from('downpayments')
      .update({ status: 'approved', reviewed_at: new Date().toISOString() })
      .eq('id', row.downpaymentId);
    if (r.error) throw r.error;

    var g = await c.rpc('review_advance_escrow', {
      p_booking_id: row.bookingId ?? null,
      p_rental_id: row.boatRentalId ?? null,
      p_approve: true,
    });
    if (g.error) throw g.error;

    if (g.data) {
      await notify(row.notifyUserId, 'Downpayment confirmed',
        `Your GCash downpayment of ₱${row.amount} for ${row.label} has been confirmed. It is now visible to bangkeros.`);
      if (row.boatRentalId && row.rentalBangkeroId) {
        await notify(row.rentalBangkeroId, 'New boat rental request',
          `${row.payerName ?? 'A passenger'} wants to rent ${row.rentalBoatName ?? 'your boat'} (${row.serviceLabel}). The downpayment is approved — confirm or decline.`);
      }
    }
  }

  /** Refund escrow (mirrors mobile refundDownpayment): cancels the still-unopened booking/rental alongside. */
  async function refundDownpayment(row) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var r = await c.from('downpayments')
      .update({ status: 'refunded', reviewed_at: new Date().toISOString() })
      .eq('id', row.downpaymentId);
    if (r.error) throw r.error;

    var g = await c.rpc('review_advance_escrow', {
      p_booking_id: row.bookingId ?? null,
      p_rental_id: row.boatRentalId ?? null,
      p_approve: false,
    });
    if (g.error) throw g.error;

    await notify(row.notifyUserId, 'Downpayment refunded',
      `Your GCash downpayment of ₱${row.amount} for ${row.label} has been refunded.`);
  }

  window.bangkagoPayments = { listPayments, listDownpayments, approveDownpayment, refundDownpayment };
})();
