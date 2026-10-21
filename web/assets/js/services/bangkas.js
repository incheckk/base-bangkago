/**
 * Bangka (vessel) management service for web dashboards.
 *
 * Columns/functions used here come from the schema the app already runs:
 *   045  admin insert/update/delete policies + nullable bangkero_id
 *   047  bangkas.is_active (admin-controlled availability)
 *   048  soft-delete bookkeeping (deleted_was_active)
 *   049  admin_delete_bangka / admin_restore_bangka RPCs
 *   027  bangkas.rental_listed
 *
 * Status is DERIVED from real rows (owner verification, is_active, today's
 * accepted bookings, today's live rentals) - there is no status column.
 */
(function() {
  'use strict';
  var svc = window.bangkagoServices;

  // Philippine calendar day: bookings.scheduled_date and rentals.rental_date
  // are DATE values written in Manila time.
  function manilaTodayIso() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  }

  function uniq(values) {
    var seen = {};
    return values.filter(function(v) { if (!v || seen[v]) return false; seen[v] = true; return true; });
  }

  // "Santa Rosa Port, Olango Island" -> "Santa Rosa" (keeps the table readable)
  function shortPort(name) {
    if (!name) return '?';
    return String(name).split(',')[0].replace(/\s+Port$/i, '').trim() || name;
  }

  function deriveStatus(v) {
    var ownerOk = !!v.bangkeroId && v.bangkeroVerification === 'verified' && !v.bangkeroDeleted;
    if (!ownerOk) return 'Unverified';
    if (!v.isActive) return 'Unavailable';
    if (v.activityKind === 'trip') return 'On Trip';
    if (v.activityKind === 'rental') return 'On Rental';
    if (!v.bangkeroAvailable) return 'Offline';
    return 'Available';
  }

  function mapRow(row) {
    var v = {
      bangkaId: row.id,
      bangkaName: row.bangka_name,
      bangkaType: row.bangka_type,
      permitNumber: row.permit_number,
      bangkaPhoto: row.bangka_photo,
      capacity: row.capacity,
      maxLoadKg: row.max_load_kg,
      bangkeroId: row.bangkero_id,
      hourlyRate: row.hourly_rate,
      isActive: row.is_active !== false,
      rentalListed: row.rental_listed === true,
      isDeleted: row.is_deleted === true,
      deletedAt: row.deleted_at ?? null,
      // joined bangkero fields
      bangkeroName: row.bangkeros?.display_name ?? null,
      bangkeroAvailable: row.bangkeros?.is_available ?? null,
      bangkeroVerification: row.bangkeros?.verification_stat ?? null,
      bangkeroDeleted: row.bangkeros?.is_deleted === true,
      // derived
      activityKind: null,
      inUse: false,
      blockedDelete: false,
      status: 'Unverified',
      currentUse: null,
      activeRoute: null,
      activeBookingRef: null
    };
    v.status = deriveStatus(v);
    return v;
  }

  var SELECT = '*, bangkeros(display_name, is_available, verification_stat, is_deleted)';

  /**
   * Attach today's real activity to every vessel.
   *
   * Accepted passenger bookings carry operator_id, never bangka_id, so a
   * trip belongs to the owner's boat - the app itself assumes one boat per
   * bangkero (departure.tsx uses maybeSingle). When an owner somehow has
   * more, only the lowest id (the app's own order('id') pick) carries it.
   */
  async function attachActivity(c, rows) {
    var today = manilaTodayIso();
    var owners = uniq(rows.map(function(v) { return v.bangkeroId; }));
    var boatIds = rows.map(function(v) { return v.bangkaId; });

    var primaryBoat = {};
    rows
      .filter(function(v) { return v.bangkeroId; })
      .sort(function(a, b) {
        // active boat first, then lowest id (V4 UUID text compare is stable)
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
        return String(a.bangkaId).localeCompare(String(b.bangkaId));
      })
      .forEach(function(v) {
        if (!primaryBoat[v.bangkeroId]) primaryBoat[v.bangkeroId] = v.bangkaId;
      });

    var trips = [];
    if (owners.length) {
      // All accepted trips, not just today: a future accepted booking also
      // has to block deleting the vessel (departure looks the boat up by
      // owner when the date arrives).
      var tr = await c.from('bookings')
        .select('id, ref, operator_id, route_id, num_of_passenger, scheduled_date, depart_time')
        .in('operator_id', owners)
        .eq('trip_stat', 'accepted');
      if (tr.error) throw tr.error;
      trips = tr.data || [];
    }

    var rentals = [];
    if (boatIds.length) {
      var rr = await c.from('boat_rentals')
        .select('id, bangka_id, rental_date, hours, status')
        .in('bangka_id', boatIds)
        .in('status', ['awaiting_payment', 'pending', 'confirmed'])
        .eq('rental_date', today);
      if (rr.error) throw rr.error;
      rentals = rr.data || [];
    }

    var routeIds = uniq(trips.map(function(t) { return t.route_id; }));
    var routesById = {};
    if (routeIds.length) {
      var rt = await c.from('routes').select('id, start_port_id, end_port_id').in('id', routeIds);
      if (rt.error) throw rt.error;
      (rt.data || []).forEach(function(r) { routesById[r.id] = r; });
    }

    var portIds = uniq(Object.keys(routesById).reduce(function(acc, id) {
      var r = routesById[id];
      acc.push(r.start_port_id, r.end_port_id);
      return acc;
    }, []));
    var portsById = {};
    if (portIds.length) {
      var pr = await c.from('ports').select('id, port_name').in('id', portIds);
      if (pr.error) throw pr.error;
      (pr.data || []).forEach(function(p) { portsById[p.id] = p.port_name; });
    }

    var tripsByOwner = {};
    trips.forEach(function(t) {
      (tripsByOwner[t.operator_id] = tripsByOwner[t.operator_id] || []).push(t);
    });
    var rentalByBoat = {};
    rentals.forEach(function(r) {
      if (!rentalByBoat[r.bangka_id]) rentalByBoat[r.bangka_id] = r;
    });

    rows.forEach(function(v) {
      var ownerTripsAll = v.bangkeroId && primaryBoat[v.bangkeroId] === v.bangkaId
        ? (tripsByOwner[v.bangkeroId] || [])
        : [];
      // Today's accepted trips drive the live status; any accepted trip
      // (today or upcoming) blocks deletion.
      var ownerTrips = ownerTripsAll.filter(function(t) {
        return !t.scheduled_date || t.scheduled_date === today;
      });
      var rental = rentalByBoat[v.bangkaId];

      v.blockedDelete = ownerTripsAll.length > 0;
      v.activityKind = null;
      v.inUse = false;
      v.currentUse = null;
      v.activeRoute = null;
      v.activeBookingRef = null;

      if (ownerTrips.length) {
        var pax = ownerTrips.reduce(function(n, t) { return n + (t.num_of_passenger || 0); }, 0);
        v.activityKind = 'trip';
        v.inUse = true;
        if (ownerTrips.length === 1) {
          var t = ownerTrips[0];
          var route = routesById[t.route_id];
          var path = route
            ? shortPort(portsById[route.start_port_id]) + ' → ' + shortPort(portsById[route.end_port_id])
            : null;
          v.activeRoute = path;
          v.activeBookingRef = t.ref || null;
          v.currentUse = (t.ref ? t.ref + ' · ' : '') + pax + ' pax' + (path ? ' · ' + path : '');
        } else {
          v.currentUse = ownerTrips.length + ' trips · ' + pax + ' pax';
        }
      } else if (rental) {
        v.activityKind = 'rental';
        v.inUse = true;
        v.currentUse = 'Rental · ' + Number(rental.hours) + 'h · ' + rental.status;
      }

      v.status = deriveStatus(v);
    });
  }

  async function listAll(options) {
    options = options || {};
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var q = c.from('bangkas').select(SELECT).eq('is_deleted', false);
    if (options.bangkeroId) q = q.eq('bangkero_id', options.bangkeroId);
    if (options.bangkaType) q = q.eq('bangka_type', options.bangkaType);
    var r = await q.order('bangka_name', { ascending: true });
    if (r.error) throw r.error;

    var rows = (r.data || []).map(mapRow);
    // Activity costs extra queries and is only needed by Manage Bangka;
    // the coastguard/alerts pickers just need names.
    if (options.includeActivity === true) await attachActivity(c, rows);

    // Filter client-side so activity is always attributed against the FULL
    // fleet: filtering first would hand an owner's trip to a deactivated boat.
    if (options.assignment && options.assignment !== 'all') {
      var wantActive = options.assignment === 'active';
      rows = rows.filter(function(v) { return v.isActive === wantActive; });
    }
    return rows;
  }

  async function listDeleted() {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var r = await c.from('bangkas')
      .select(SELECT)
      .eq('is_deleted', true)
      .order('deleted_at', { ascending: false });
    if (r.error) throw r.error;
    return (r.data || []).map(mapRow);
  }

  async function getById(id) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var r = await c.from('bangkas').select(SELECT).eq('id', id).maybeSingle();
    if (r.error) throw r.error;
    return r.data ? mapRow(r.data) : null;
  }

  async function assertVerifiedOwner(c, bangkeroId, excludeBangkaId) {
    if (!bangkeroId) throw new Error('Choose the verified bangkero who owns this vessel.');
    var r = await c.from('bangkeros')
      .select('id, verification_stat, is_deleted')
      .eq('id', bangkeroId)
      .maybeSingle();
    if (r.error) throw r.error;
    if (!r.data) throw new Error('Bangkero not found.');
    if (r.data.is_deleted) throw new Error('That bangkero account is deleted.');
    if (r.data.verification_stat !== 'verified') {
      throw new Error('That bangkero has not passed document verification yet.');
    }

    // The app reads a bangkero's boat with maybeSingle() (departure.tsx), so a
    // second active vessel would break their sailing screen.
    var q = c.from('bangkas')
      .select('id', { count: 'exact', head: true })
      .eq('bangkero_id', bangkeroId)
      .eq('is_deleted', false);
    if (excludeBangkaId) q = q.neq('id', excludeBangkaId);
    var owned = await q;
    if (owned.error) throw owned.error;
    if ((owned.count || 0) > 0) {
      throw new Error('That bangkero already owns a vessel. BangkaGo supports one boat per bangkero.');
    }
  }

  async function create(data) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var name = (data.bangkaName || '').trim();
    if (name.length < 2) throw new Error('Vessel name must be at least 2 characters.');
    var capacity = Number(data.capacity);
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 200) {
      throw new Error('Capacity must be a whole number between 1 and 200.');
    }
    if (data.maxLoadKg !== null && data.maxLoadKg !== undefined && !(Number(data.maxLoadKg) >= 0)) {
      throw new Error('Max load must be zero or more kilograms.');
    }
    if (data.hourlyRate !== null && data.hourlyRate !== undefined && !(Number(data.hourlyRate) >= 0)) {
      throw new Error('Hourly rate must be zero or more.');
    }
    await assertVerifiedOwner(c, data.bangkeroId);

    var r = await c.from('bangkas').insert({
      bangka_name: name,
      bangka_type: data.bangkaType || null,
      permit_number: data.permitNumber || null,
      bangka_photo: data.bangkaPhoto || null,
      capacity: capacity,
      max_load_kg: data.maxLoadKg === null || data.maxLoadKg === undefined ? null : Number(data.maxLoadKg),
      bangkero_id: data.bangkeroId,
      hourly_rate: data.hourlyRate === null || data.hourlyRate === undefined ? 500 : Number(data.hourlyRate),
      is_active: true
    }).select(SELECT).single();
    if (r.error) throw r.error;
    return mapRow(r.data);
  }

  async function update(id, data) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var updateData = {};
    if (data.bangkaName !== undefined) {
      var name = (data.bangkaName || '').trim();
      if (name.length < 2) throw new Error('Vessel name must be at least 2 characters.');
      updateData.bangka_name = name;
    }
    if (data.bangkaType !== undefined) updateData.bangka_type = data.bangkaType || null;
    if (data.permitNumber !== undefined) updateData.permit_number = data.permitNumber || null;
    if (data.bangkaPhoto !== undefined) updateData.bangka_photo = data.bangkaPhoto || null;
    if (data.capacity !== undefined) {
      var capacity = Number(data.capacity);
      if (!Number.isInteger(capacity) || capacity < 1 || capacity > 200) {
        throw new Error('Capacity must be a whole number between 1 and 200.');
      }
      updateData.capacity = capacity;
    }
    if (data.maxLoadKg !== undefined) {
      if (data.maxLoadKg !== null && !(Number(data.maxLoadKg) >= 0)) {
        throw new Error('Max load must be zero or more kilograms.');
      }
      updateData.max_load_kg = data.maxLoadKg === null ? null : Number(data.maxLoadKg);
    }
    if (data.hourlyRate !== undefined) {
      if (data.hourlyRate !== null && !(Number(data.hourlyRate) >= 0)) {
        throw new Error('Hourly rate must be zero or more.');
      }
      updateData.hourly_rate = data.hourlyRate === null ? 500 : Number(data.hourlyRate);
    }
    if (data.bangkeroId !== undefined) {
      await assertVerifiedOwner(c, data.bangkeroId, id);
      updateData.bangkero_id = data.bangkeroId;
    }
    if (Object.keys(updateData).length === 0) return;
    var r = await c.from('bangkas').update(updateData).eq('id', id);
    if (r.error) throw r.error;
  }

  /**
   * Activate / deactivate. Activate requires a verified owner; Deactivate
   * keeps the owner (the page's own copy) and only takes the vessel off
   * dispatch + the rental catalog.
   */
  async function setStatus(id, status, bangkeroId) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    if (status === 'Activate') {
      await assertVerifiedOwner(c, bangkeroId, id);
      var r = await c.from('bangkas')
        .update({ is_active: true, bangkero_id: bangkeroId })
        .eq('id', id);
      if (r.error) throw r.error;
      return;
    }
    if (status === 'Deactivate') {
      var d = await c.from('bangkas')
        .update({ is_active: false, rental_listed: false })
        .eq('id', id);
      if (d.error) throw d.error;
      return;
    }
    throw new Error('Unknown status action: ' + status);
  }

  async function del(id) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    // 049's RPC only checks bookings.bangka_id, which accepted passenger
    // bookings never set (they carry operator_id). Close that gap here so a
    // vessel with a live or upcoming accepted trip can never be deleted.
    var boat = await getById(id);
    if (boat && boat.bangkeroId) {
      var trips = await c.from('bookings')
        .select('id', { count: 'exact', head: true })
        .eq('operator_id', boat.bangkeroId)
        .eq('trip_stat', 'accepted');
      if (trips.error) throw trips.error;
      if ((trips.count || 0) > 0) {
        throw new Error('This vessel has an accepted booking (today or upcoming). Complete or cancel it before deleting the vessel.');
      }
    }
    var r = await c.rpc('admin_delete_bangka', { p_bangka_id: id });
    if (r.error) throw r.error;
  }

  async function restore(id) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var r = await c.rpc('admin_restore_bangka', { p_bangka_id: id });
    if (r.error) throw r.error;
  }

  window.bangkagoBangkas = {
    listAll: listAll,
    listDeleted: listDeleted,
    getById: getById,
    create: create,
    update: update,
    delete: del,
    setStatus: setStatus,
    restore: restore,
    deriveStatus: deriveStatus
  };
})();
