/**
 * Boat rentals service for web dashboards (admin read-only).
 * Mirrors mobile rental.service.ts listAllRentals()
 */
(function() {
  'use strict';
  var svc = window.bangkagoServices;

  function mapRow(row) {
    return {
      rentalId: row.id,
      eventName: row.event_name,
      rentalDate: row.rental_date,
      hours: row.hours,
      totalPrice: row.total_price,
      status: row.status,
      userId: row.user_id,
      bangkaId: row.bangka_id,
      paymentId: row.payment_id,
      createdAt: row.created_at,
      // joined fields
      bangkaName: row.bangkas?.bangka_name ?? null,
      bangkeroId: row.bangkas?.bangkero_id ?? null,
      renterName: row.users ? (row.users.first_name + ' ' + row.users.last_name).trim() : null,
      renterEmail: row.users?.email ?? null,
      renterPhone: row.users?.phone_number ?? null
    };
  }

  async function listAll(filters) {
    filters = filters || {};
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var q = c.from('boat_rentals').select('*, bangkas(bangka_name, bangkero_id), users(first_name, last_name, email, phone_number)');
    if (filters.status) q = q.eq('status', filters.status);
    if (filters.renterId) q = q.eq('user_id', filters.renterId);
    if (filters.bangkaId) q = q.eq('bangka_id', filters.bangkaId);
    if (filters.dateFrom) q = q.gte('rental_date', filters.dateFrom);
    if (filters.dateTo) q = q.lte('rental_date', filters.dateTo);
    q = q.order('created_at', { ascending: false });
    if (filters.limit) q = q.limit(filters.limit);
    var r = await q;
    if (r.error) throw r.error;
    return (r.data || []).map(mapRow);
  }

  async function getById(id) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var r = await c.from('boat_rentals').select('*, bangkas(bangka_name, bangkero_id), users(first_name, last_name, email, phone_number)').eq('id', id).maybeSingle();
    if (r.error) throw r.error;
    return r.data ? mapRow(r.data) : null;
  }

  window.bangkagoRentals = { listAll, getById };
})();