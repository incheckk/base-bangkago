/**
 * Trip manifest service for web dashboards.
 * Mirrors mobile manifest operations.
 */
(function() {
  'use strict';
  var svc = window.bangkagoServices;

  function mapManifest(row) {
    return {
      manifestId: row.id,
      actualDepartureTime: row.actual_departure_time,
      actualArrivalTime: row.actual_arrival_time,
      totalPassengersOnBoard: row.total_passengers_on_board,
      totalParcelsOnBoard: row.total_parcels_on_board,
      status: row.status,
      generatedAt: row.generated_at,
      bangkaId: row.bangka_id,
      bangkeroId: row.bangkero_id,
      departurePortId: row.departure_port_id,
      arrivalPortId: row.arrival_port_id,
      // joined fields
      bangkaName: row.bangkas?.bangka_name ?? null,
      bangkeroName: row.bangkeros?.display_name ?? null,
      departurePortName: row.ports_departure?.port_name ?? null,
      arrivalPortName: row.ports_arrival?.port_name ?? null
    };
  }
  function mapPassenger(row) {
    return { manifestPassengerId: row.id, passengerName: row.passenger_name, actualWeightKg: row.actual_weight_kg, boardedAt: row.boarded_at, manifestId: row.manifest_id, bookingId: row.booking_id, passengerId: row.passenger_id };
  }
  function mapParcel(row) {
    return { manifestParcelId: row.id, parcelDescription: row.parcel_description, weightKg: row.weight_kg, loadedAt: row.loaded_at, manifestId: row.manifest_id, parcelId: row.parcel_id };
  }

  async function listAll(filters) {
    filters = filters || {};
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var q = c.from('trip_manifest').select('*, bangkas(bangka_name), bangkeros(display_name), ports!trip_manifest_departure_port_id_fkey(port_name), ports!trip_manifest_arrival_port_id_fkey(port_name)');
    if (filters.bangkeroId) q = q.eq('bangkero_id', filters.bangkeroId);
    if (filters.status) q = q.eq('status', filters.status);
    if (filters.includeCompleted) q = q.in('status', ['draft','finalized','completed']); else q = q.in('status', ['draft','finalized']);
    if (filters.fromDate) q = q.gte('generated_at', filters.fromDate);
    q = q.order('generated_at', { ascending: false });
    if (filters.limit) q = q.limit(filters.limit);
    var r = await q;
    if (r.error) throw r.error;
    return (r.data || []).map(mapManifest);
  }

  async function getById(id) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var r = await c.from('trip_manifest').select('*').eq('id', id).maybeSingle();
    if (r.error) throw r.error;
    return r.data ? mapManifest(r.data) : null;
  }

  async function getPassengers(manifestId) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var r = await c.from('manifest_passengers').select('*').eq('manifest_id', manifestId);
    if (r.error) throw r.error;
    return (r.data || []).map(mapPassenger);
  }

  async function getParcels(manifestId) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var r = await c.from('manifest_parcels').select('*').eq('manifest_id', manifestId);
    if (r.error) throw r.error;
    return (r.data || []).map(mapParcel);
  }

  async function getActiveManifest(bangkeroId, includeCompleted) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var statuses = includeCompleted ? ['draft','finalized','completed'] : ['draft','finalized'];
    var r = await c.from('trip_manifest').select('*').eq('bangkero_id', bangkeroId).in('status', statuses).order('generated_at', { ascending: false }).limit(1).maybeSingle();
    if (r.error) throw r.error;
    return r.data ? mapManifest(r.data) : null;
  }

  window.bangkagoManifests = { listAll, getById, getPassengers, getParcels, getActiveManifest };
})();