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
    return { downpaymentId: row.id, amount: row.amount, referenceNum: row.reference_num, proofUrl: row.proof_url, status: row.status, bookingId: row.booking_id, boatRentalId: row.boat_rental_id, createdAt: row.created_at, reviewedAt: row.reviewed_at, user: row.booking?.user ?? row.boatRental?.user ?? null };
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
    var q = c.from('downpayments').select('*, booking:bookings(ref, passenger_name, user:users!bookings_user_id_fkey(first_name, last_name)), boatRental:boat_rentals(event_name, rental_date, user:users!boat_rentals_user_id_fkey(first_name, last_name))');
    if (filters.status) q = q.eq('status', filters.status);
    q = q.order('created_at', { ascending: false });
    if (filters.limit) q = q.limit(filters.limit);
    var r = await q; if (r.error) throw r.error;
    return (r.data || []).map(mapDownpayment);
  }

  async function approveDownpayment(id) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var r = await c.rpc('approve_downpayment', { p_downpayment_id: id });
    if (r.error) throw r.error;
  }
  async function rejectDownpayment(id, remarks) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var r = await c.rpc('reject_downpayment', { p_downpayment_id: id, p_remarks: remarks });
    if (r.error) throw r.error;
  }

  window.bangkagoPayments = { listPayments, listDownpayments, approveDownpayment, rejectDownpayment };
})();