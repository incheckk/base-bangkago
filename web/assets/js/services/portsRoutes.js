/**
 * Ports & Routes reference data service for web dashboards.
 * Mirrors mobile ports/routes operations.
 */
(function() {
  'use strict';
  var svc = window.bangkagoServices;

  function mapPort(row) {
    return { portId: row.id, portName: row.port_name, location: row.location, latitude: row.latitude, longitude: row.longitude, sortOrder: row.sort_order, isActive: row.is_active, geofenceRadiusM: row.geofence_radius_m };
  }
  function mapRoute(row) {
    return { routeId: row.id, startPortId: row.start_port_id, endPortId: row.end_port_id, baseFare: row.base_fare, estimatedMinutes: row.estimated_minutes, distanceKm: row.distance_km, isActive: row.is_active };
  }
  function mapRouteStop(row) {
    return { stopId: row.id, routeId: row.route_id, portId: row.port_id, stopOrder: row.stop_order, portName: row.ports?.port_name ?? null };
  }

  async function listPorts(activeOnly) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var q = c.from('ports').select('*');
    if (activeOnly) q = q.eq('is_active', true);
    q = q.order('sort_order');
    var r = await q; if (r.error) throw r.error;
    return (r.data || []).map(mapPort);
  }

  async function listRoutes(activeOnly) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var q = c.from('routes').select('*');
    if (activeOnly) q = q.eq('is_active', true);
    q = q.order('id');
    var r = await q; if (r.error) throw r.error;
    return (r.data || []).map(mapRoute);
  }

  async function getRoute(startId, endId) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var id = startId + '__' + endId;
    var r = await c.from('routes').select('*').eq('id', id).maybeSingle();
    if (r.error) throw r.error;
    return r.data ? mapRoute(r.data) : null;
  }

  async function upsertPort(port) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var r = await c.from('ports').upsert({ id: port.portId, port_name: port.portName, location: port.location, latitude: port.latitude, longitude: port.longitude, sort_order: port.sortOrder, is_active: port.isActive, geofence_radius_m: port.geofenceRadiusM ?? 300 });
    if (r.error) throw r.error;
  }

  async function upsertRoute(route) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var id = route.startPortId + '__' + route.endPortId;
    var r = await c.from('routes').upsert({ id: id, start_port_id: route.startPortId, end_port_id: route.endPortId, base_fare: route.baseFare, estimated_minutes: route.estimatedMinutes, distance_km: route.distanceKm, is_active: route.isActive });
    if (r.error) throw r.error;
  }

  // --- New functions for admin management ---

  async function deletePort(portId) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    // Check if port is used in any routes
    var routeCheck = await c.from('routes').select('id', { count: 'exact', head: true }).or('start_port_id.eq.' + portId + ',end_port_id.eq.' + portId);
    if (routeCheck.error) throw routeCheck.error;
    if (routeCheck.count > 0) {
      throw new Error('Cannot delete: port is used in ' + routeCheck.count + ' route(s). Remove routes first.');
    }
    // Check if port is used in route_stops
    var stopCheck = await c.from('route_stops').select('id', { count: 'exact', head: true }).eq('port_id', portId);
    if (stopCheck.error) throw stopCheck.error;
    if (stopCheck.count > 0) {
      throw new Error('Cannot delete: port is used in ' + stopCheck.count + ' route stop(s). Remove stops first.');
    }
    var r = await c.from('ports').delete().eq('id', portId);
    if (r.error) throw r.error;
  }

  async function deleteRoute(routeId) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    // Check if route has active bookings
    var bookingCheck = await c.from('bookings').select('id', { count: 'exact', head: true }).eq('route_id', routeId).in('trip_stat', ['open', 'pending', 'accepted']);
    if (bookingCheck.error) throw bookingCheck.error;
    if (bookingCheck.count > 0) {
      throw new Error('Cannot delete: route has ' + bookingCheck.count + ' active booking(s).');
    }
    // Delete route_stops first (cascade should handle, but explicit is safer)
    await c.from('route_stops').delete().eq('route_id', routeId);
    var r = await c.from('routes').delete().eq('id', routeId);
    if (r.error) throw r.error;
  }

  async function getRouteStops(routeId) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var r = await c.from('route_stops').select('*, ports(port_name)').eq('route_id', routeId).order('stop_order');
    if (r.error) throw r.error;
    return (r.data || []).map(mapRouteStop);
  }

  async function addRouteStop(routeId, portId, stopOrder) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    // Check if stop_order already exists for this route
    var existing = await c.from('route_stops').select('id').eq('route_id', routeId).eq('stop_order', stopOrder).maybeSingle();
    if (existing.data) {
      throw new Error('Stop order ' + stopOrder + ' already exists for this route.');
    }
    var r = await c.from('route_stops').insert({ route_id: routeId, port_id: portId, stop_order: stopOrder }).select().single();
    if (r.error) throw r.error;
    return mapRouteStop(r.data);
  }

  async function deleteRouteStop(stopId) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var r = await c.from('route_stops').delete().eq('id', stopId);
    if (r.error) throw r.error;
  }

  async function reorderRouteStops(routeId, stopIds) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    // Batch update stop_order for each stopId
    // Supabase doesn't support batch update directly, so we do sequential updates
    for (var i = 0; i < stopIds.length; i++) {
      var r = await c.from('route_stops').update({ stop_order: i + 1 }).eq('id', stopIds[i]).eq('route_id', routeId);
      if (r.error) throw r.error;
    }
  }

  window.bangkagoPortsRoutes = { 
    listPorts, listRoutes, getRoute, upsertPort, upsertRoute, mapPort, mapRoute,
    deletePort, deleteRoute, getRouteStops, addRouteStop, deleteRouteStop, reorderRouteStops
  };
})();