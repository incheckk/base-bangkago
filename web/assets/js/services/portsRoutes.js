/**
 * Ports & Routes reference data service for web dashboards.
 * Mirrors the mobile admin screens (src/services/route.service.ts).
 *
 * Columns: 002 (base), 008 (geofence_radius_m), 034 (island_group/island_name),
 * 063 (real coordinates + two renames). Port ids are TEXT slugs and are
 * referenced by routes, route_stops, port_queue, manifests, schedules,
 * weather and demand rows - callers must never rewrite an existing id.
 */
(function() {
  'use strict';
  var svc = window.bangkagoServices;

  function mapPort(row) {
    return {
      portId: row.id,
      portName: row.port_name,
      location: row.location,
      latitude: row.latitude,
      longitude: row.longitude,
      sortOrder: row.sort_order,
      isActive: row.is_active,
      islandGroup: row.island_group ?? 'mactan',
      islandName: row.island_name ?? 'Mactan',
      geofenceRadiusM: row.geofence_radius_m ?? 300
    };
  }

  function mapRoute(row) {
    return {
      routeId: row.id,
      startPortId: row.start_port_id,
      endPortId: row.end_port_id,
      baseFare: row.base_fare,
      estimatedMinutes: row.estimated_minutes,
      distanceKm: row.distance_km,
      isActive: row.is_active
    };
  }

  function mapRouteStop(row) {
    return {
      stopId: row.id,
      routeId: row.route_id,
      portId: row.port_id,
      stopOrder: row.stop_order,
      portName: row.ports?.port_name ?? null
    };
  }

  function isForeignKeyError(err) {
    return err && (err.code === '23503' || /foreign key/i.test(err.message || ''));
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
    // Port names are resolved from listPorts() by the page; the two
    // aliased embeds this used to carry were never read.
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
    var id = (port.portId || '').trim();
    var name = (port.portName || '').trim();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
      throw new Error('Port id must be a lowercase slug (letters, digits and hyphens).');
    }
    if (name.length < 2) throw new Error('Port name must be at least 2 characters.');
    var lat = Number(port.latitude);
    var lng = Number(port.longitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      throw new Error('Latitude must be a number between -90 and 90.');
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      throw new Error('Longitude must be a number between -180 and 180.');
    }
    var radius = port.geofenceRadiusM === null || port.geofenceRadiusM === undefined
      ? 300
      : Number(port.geofenceRadiusM);
    if (!Number.isInteger(radius) || radius < 50 || radius > 5000) {
      throw new Error('Queue radius must be a whole number between 50 and 5000 metres.');
    }

    var r = await c.from('ports').upsert({
      id: id,
      port_name: name,
      location: (port.location || '').trim() || null,
      latitude: lat,
      longitude: lng,
      sort_order: Number.isInteger(port.sortOrder) ? port.sortOrder : 0,
      is_active: port.isActive !== false,
      island_group: port.islandGroup === 'olango' ? 'olango' : 'mactan',
      island_name: (port.islandName || '').trim() || (port.islandGroup === 'olango' ? 'Olango' : 'Mactan'),
      geofence_radius_m: radius
    });
    if (r.error) throw r.error;
  }

  async function upsertRoute(route) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    if (!route.startPortId || !route.endPortId) {
      throw new Error('Choose both a start port and an end port.');
    }
    if (route.startPortId === route.endPortId) {
      throw new Error('A route cannot start and end at the same port.');
    }
    var fare = Number(route.baseFare);
    if (!Number.isFinite(fare) || fare < 0) {
      throw new Error('Base fare must be zero or more.');
    }
    var minutes = Number(route.estimatedMinutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 600) {
      throw new Error('Estimated minutes must be a whole number between 1 and 600.');
    }
    var distance = route.distanceKm === null || route.distanceKm === undefined || route.distanceKm === ''
      ? null
      : Number(route.distanceKm);
    if (distance !== null && (!Number.isFinite(distance) || distance < 0)) {
      throw new Error('Distance must be zero or more kilometres.');
    }

    var id = route.startPortId + '__' + route.endPortId;
    var r = await c.from('routes').upsert({
      id: id,
      start_port_id: route.startPortId,
      end_port_id: route.endPortId,
      base_fare: fare,
      estimated_minutes: minutes,
      distance_km: distance,
      is_active: route.isActive !== false
    });
    if (r.error) throw r.error;
  }

  async function deletePort(portId) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var routeCheck = await c.from('routes').select('id', { count: 'exact', head: true })
      .or('start_port_id.eq.' + portId + ',end_port_id.eq.' + portId);
    if (routeCheck.error) throw routeCheck.error;
    if (routeCheck.count > 0) {
      throw new Error('Cannot delete: ' + routeCheck.count + ' route(s) still use this port. Delete those routes first, or mark the port inactive.');
    }
    var stopCheck = await c.from('route_stops').select('id', { count: 'exact', head: true }).eq('port_id', portId);
    if (stopCheck.error) throw stopCheck.error;
    if (stopCheck.count > 0) {
      throw new Error('Cannot delete: this port is a stop on ' + stopCheck.count + ' route(s). Remove those stops first.');
    }

    var r = await c.from('ports').delete().eq('id', portId);
    if (r.error) {
      if (isForeignKeyError(r.error)) {
        throw new Error('This port still has linked records (queues, manifests, alerts, weather or schedules). Mark it inactive instead of deleting it.');
      }
      throw r.error;
    }
  }

  async function deleteRoute(routeId) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var bookingCheck = await c.from('bookings').select('id', { count: 'exact', head: true })
      .eq('route_id', routeId)
      .in('trip_stat', ['open', 'pending', 'accepted']);
    if (bookingCheck.error) throw bookingCheck.error;
    if (bookingCheck.count > 0) {
      throw new Error('Cannot delete: this route has ' + bookingCheck.count + ' active booking(s).');
    }

    // route_stops cascades from routes (002), so a failed delete no longer
    // leaves the stops already removed.
    var r = await c.from('routes').delete().eq('id', routeId);
    if (r.error) {
      if (isForeignKeyError(r.error)) {
        throw new Error('This route has trip history in bookings, weather data or crossing schedules. Set it inactive instead of deleting it.');
      }
      throw r.error;
    }
  }

  async function getRouteStops(routeId) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var r = await c.from('route_stops').select('*, ports(port_name)').eq('route_id', routeId).order('stop_order');
    if (r.error) throw r.error;
    return (r.data || []).map(mapRouteStop);
  }

  async function addRouteStop(routeId, portId, stopOrder) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var order = Number(stopOrder);
    if (!Number.isInteger(order) || order < 1) {
      throw new Error('Stop order must be a whole number of 1 or more.');
    }
    var dup = await c.from('route_stops').select('id').eq('route_id', routeId).eq('port_id', portId).maybeSingle();
    if (dup.error) throw dup.error;
    if (dup.data) throw new Error('That port is already a stop on this route.');

    var existing = await c.from('route_stops').select('id').eq('route_id', routeId).eq('stop_order', order).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) throw new Error('Stop order ' + order + ' already exists for this route.');

    var r = await c.from('route_stops').insert({ route_id: routeId, port_id: portId, stop_order: order }).select().single();
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
