import { supabase } from './supabase';

export interface TripManifest {
  manifestId: string;
  actualDepartureTime: string | null;
  actualArrivalTime: string | null;
  totalPassengersOnBoard: number;
  totalParcelsOnBoard: number;
  status: 'draft' | 'finalized' | 'completed' | 'cancelled';
  generatedAt: string;
  bangkaId: string;
  bangkeroId: string;
  departurePortId: string;
  arrivalPortId: string;
}

export interface ManifestPassenger {
  manifestPassengerId: string;
  passengerName: string;
  actualWeightKg: number | null;
  boardedAt: string | null;
  manifestId: string;
  bookingId: string;
  passengerId: string | null;
}

export interface ManifestParcel {
  manifestParcelId: string;
  parcelDescription: string;
  weightKg: number | null;
  loadedAt: string | null;
  manifestId: string;
  parcelId: string;
}

function mapManifest(row: any): TripManifest {
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
  };
}

function mapManifestPassenger(row: any): ManifestPassenger {
  return {
    manifestPassengerId: row.id,
    passengerName: row.passenger_name,
    actualWeightKg: row.actual_weight_kg,
    boardedAt: row.boarded_at,
    manifestId: row.manifest_id,
    bookingId: row.booking_id,
    passengerId: row.passenger_id,
  };
}

function mapManifestParcel(row: any): ManifestParcel {
  return {
    manifestParcelId: row.id,
    parcelDescription: row.parcel_description,
    weightKg: row.weight_kg,
    loadedAt: row.loaded_at,
    manifestId: row.manifest_id,
    parcelId: row.parcel_id,
  };
}

export async function createManifest(manifest: {
  bangkaId: string;
  bangkeroId: string;
  departurePortId: string;
  arrivalPortId: string;
}): Promise<TripManifest> {
  const { data, error } = await supabase
    .from('trip_manifest')
    .insert({
      bangka_id: manifest.bangkaId,
      bangkero_id: manifest.bangkeroId,
      departure_port_id: manifest.departurePortId,
      arrival_port_id: manifest.arrivalPortId,
    })
    .select()
    .single();

  if (error) throw error;
  return mapManifest(data);
}

export async function getActiveManifest(
  bangkeroId: string,
  includeCompleted = false
): Promise<TripManifest | null> {
  let q = supabase
    .from('trip_manifest')
    .select('*')
    .eq('bangkero_id', bangkeroId)
    .in('status', includeCompleted ? ['draft', 'finalized', 'completed'] : ['draft', 'finalized']);

  /**
   * Arrival is the terminal signal, not `status`.
   *
   * Arrival is stamped when the Arrived screen opens, but the status only
   * reaches 'completed' when the bangkero taps through it. Backing out in
   * between stranded the manifest as 'finalized' WITH an arrival time — and
   * since this query ranks by generated_at among draft/finalized, that dead
   * row then won forever. En Route reads `departure && !arrival`, so it
   * showed "No trip in progress" on every later sailing, and Departure kept
   * resolving to yesterday's arrived manifest.
   *
   * Filtering on the timestamp means a half-finished arrival can no longer
   * block the next trip, whatever its status says.
   */
  if (!includeCompleted) q = q.is('actual_arrival_time', null);

  const { data, error } = await q
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapManifest(data) : null;
}

export async function finalizeManifest(manifestId: string): Promise<void> {
  const { error } = await supabase
    .from('trip_manifest')
    .update({ status: 'finalized' })
    .eq('id', manifestId);

  if (error) throw error;
}

/** Close out the manifest when the trip arrives (007 allows 'completed';
 *  trip-summary reads with includeCompleted so it still renders). */
export async function completeManifest(manifest: TripManifest): Promise<void> {
  const { error } = await supabase
    .from('trip_manifest')
    .update({ status: 'completed' })
    .eq('id', manifest.manifestId)
    .eq('bangkero_id', manifest.bangkeroId);
  if (error) throw error;
}

/** Archive every live draft/finalized manifest so the next insert is the
 *  only one getActiveManifest will surface. */
export async function cancelActiveManifests(bangkeroId: string): Promise<void> {
  const { error } = await supabase
    .from('trip_manifest')
    .update({ status: 'cancelled' })
    .eq('bangkero_id', bangkeroId)
    .in('status', ['draft', 'finalized']);

  if (error) throw error;
}

export interface BoardedBooking {
  bookingId: string;
  passengerName: string | null;
  numOfPassenger: number;
  serviceType: string;
  cargoMode?: 'accompanied' | 'piggyback' | 'batched' | 'solo' | null;
}

/**
 * Writes the boarded passengers and parcels into the manifest children and
 * stamps departure — the data Trip Summary reports from. Insert-only and
 * idempotent: a rerun tops up missing seats instead of duplicating them.
 *
 * `stampDeparture: false` lets the Finalize action snapshot the children
 * without recording an actual departure time (handleDepart stamps it).
 */
export async function populateManifestDeparture(
  manifest: TripManifest,
  boarded: BoardedBooking[],
  opts: { stampDeparture?: boolean } = {},
): Promise<void> {
  const [existingPax, existingParcels] = await Promise.all([
    getManifestPassengers(manifest.manifestId),
    getManifestParcels(manifest.manifestId),
  ]);

  const now = new Date().toISOString();
  const uniqueBoarding = [...new Map(boarded.map((b) => [b.bookingId, b])).values()];
  const seatedByBooking = new Map<string, number>();
  for (const p of existingPax) {
    seatedByBooking.set(p.bookingId, (seatedByBooking.get(p.bookingId) ?? 0) + 1);
  }
  const paxRows: Record<string, unknown>[] = [];
  for (const b of uniqueBoarding) {
    // Stub cargo (piggyback/batched/solo) has nobody aboard; an accompanied
    // sender rides with the parcel, so it counts as one passenger.
    if (b.serviceType === 'cargo' && b.cargoMode !== 'accompanied') continue;
    const missing = b.numOfPassenger - (seatedByBooking.get(b.bookingId) ?? 0);
    for (let i = 0; i < missing; i++) {
      paxRows.push({
        passenger_name: b.passengerName?.trim() || 'Passengers',
        manifest_id: manifest.manifestId,
        booking_id: b.bookingId,
        boarded_at: now,
      });
    }
  }

  const loadedParcelIds = new Set(existingParcels.map((p) => p.parcelId));
  const bookingIds = uniqueBoarding.map((b) => b.bookingId);

  // Option B: parcels can reach this sailing three ways — their own cargo
  // booking (accompanied), a carrier link (batched / solo), or the ride they
  // piggyback on. Merge them so every mode is counted exactly once.
  type ParcelRow = { id: string; receiver_name: string; total_weight_kg: number | null };
  const parcelById = new Map<string, ParcelRow>();
  const addParcelRows = (rows: ParcelRow[] | null) => {
    for (const row of rows ?? []) parcelById.set(row.id, row);
  };

  if (bookingIds.length) {
    if (__DEV__) console.log('[manifest] parcel lookup bookingIds:', bookingIds);

    const { data, error } = await supabase
      .from('parcels')
      .select('id, receiver_name, total_weight_kg')
      .in('booking_id', bookingIds)
      .or('delivery_type.eq.accompanied,delivery_type.is.null');
    if (__DEV__) {
      console.log('[manifest] parcels by booking_id:', data?.length ?? 0, error?.message);
    }
    if (error) throw error;
    addParcelRows(data);

    // carrier_booking_id arrives with migration 050 — a pre-050 schema has
    // no such column, so skip this leg instead of failing the departure.
    const { data: carried, error: carrierErr } = await supabase
      .from('parcels')
      .select('id, receiver_name, total_weight_kg')
      .in('carrier_booking_id', bookingIds);
    if (__DEV__) {
      console.log('[manifest] parcels by carrier_booking_id:', carried?.length ?? 0, carrierErr?.message);
    }
    if (carrierErr) {
      if (__DEV__) console.warn('[manifest] carrier parcel query skipped:', carrierErr.message);
    } else {
      addParcelRows(carried);
    }

    const { data: piggy, error: piggyErr } = await supabase
      .from('parcels')
      .select('id, receiver_name, total_weight_kg')
      .in('piggyback_booking_id', bookingIds);
    if (__DEV__) {
      console.log('[manifest] parcels by piggyback_booking_id:', piggy?.length ?? 0, piggyErr?.message);
    }
    if (piggyErr) {
      if (__DEV__) console.warn('[manifest] piggyback parcel query skipped:', piggyErr.message);
    } else {
      addParcelRows(piggy);
    }
  }

  const parcelInserts = [...parcelById.values()]
    .filter((r) => !loadedParcelIds.has(r.id))
    .map((r) => ({
      parcel_description: r.receiver_name,
      weight_kg: r.total_weight_kg ?? null,
      manifest_id: manifest.manifestId,
      parcel_id: r.id,
      loaded_at: now,
    }));

  if (paxRows.length) {
    const { error } = await supabase.from('manifest_passengers').insert(paxRows);
    if (error) throw error;
  }
  if (parcelInserts.length) {
    // 060 adds UNIQUE(manifest_id, parcel_id): a double-tap or two
    // overlapping populates can no longer record the same parcel twice.
    // Pre-060 the constraint is missing — fall back to a plain insert.
    const { error } = await supabase
      .from('manifest_parcels')
      .upsert(parcelInserts, { onConflict: 'manifest_id,parcel_id', ignoreDuplicates: true });
    if (error) {
      if (__DEV__) console.warn('[manifest] parcel upsert fell back to insert:', error.message);
      const { error: insertErr } = await supabase
        .from('manifest_parcels')
        .insert(parcelInserts);
      if (insertErr) throw insertErr;
    }
  }

  const patch: Record<string, unknown> = {
    total_passengers_on_board: existingPax.length + paxRows.length,
    // Distinct parcel ids only — duplicate manifest_parcels rows (pre-060
    // or a stale row) must never inflate the "items" count again.
    total_parcels_on_board: loadedParcelIds.size + parcelInserts.length,
  };
  if (opts.stampDeparture !== false && !manifest.actualDepartureTime) {
    patch.actual_departure_time = now;
  }
  const { error: updErr } = await supabase
    .from('trip_manifest')
    .update(patch)
    .eq('id', manifest.manifestId)
    .eq('bangkero_id', manifest.bangkeroId);
  if (updErr) throw updErr;
}

/** Stamp arrival once; the realtime subscription on trip_manifest refreshes
 *  every screen listening to this manifest. */
export async function stampManifestArrival(manifest: TripManifest): Promise<void> {
  if (manifest.actualArrivalTime) return;
  const { error } = await supabase
    .from('trip_manifest')
    .update({ actual_arrival_time: new Date().toISOString() })
    .eq('id', manifest.manifestId)
    .eq('bangkero_id', manifest.bangkeroId);
  if (error) throw error;
}

export async function addManifestPassenger(passenger: {
  passengerName: string;
  actualWeightKg?: number;
  manifestId: string;
  bookingId: string;
  passengerId?: string;
}): Promise<ManifestPassenger> {
  const { data, error } = await supabase
    .from('manifest_passengers')
    .insert({
      passenger_name: passenger.passengerName,
      actual_weight_kg: passenger.actualWeightKg ?? null,
      manifest_id: passenger.manifestId,
      booking_id: passenger.bookingId,
      passenger_id: passenger.passengerId ?? null,
      boarded_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw error;
  return mapManifestPassenger(data);
}

export async function addManifestParcel(parcel: {
  parcelDescription: string;
  weightKg?: number;
  manifestId: string;
  parcelId: string;
}): Promise<ManifestParcel> {
  const { data, error } = await supabase
    .from('manifest_parcels')
    .insert({
      parcel_description: parcel.parcelDescription,
      weight_kg: parcel.weightKg ?? null,
      manifest_id: parcel.manifestId,
      parcel_id: parcel.parcelId,
      loaded_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw error;
  return mapManifestParcel(data);
}

export async function getManifestPassengers(
  manifestId: string
): Promise<ManifestPassenger[]> {
  const { data, error } = await supabase
    .from('manifest_passengers')
    .select('*')
    .eq('manifest_id', manifestId);

  if (error) throw error;
  return (data ?? []).map(mapManifestPassenger);
}

export async function getManifestParcels(
  manifestId: string
): Promise<ManifestParcel[]> {
  const { data, error } = await supabase
    .from('manifest_parcels')
    .select('*')
    .eq('manifest_id', manifestId);

  if (error) throw error;
  // Defensive: a pre-060 database can still hold duplicate
  // (manifest_id, parcel_id) rows — report each parcel once.
  const seen = new Set<string>();
  return (data ?? [])
    .map(mapManifestParcel)
    .filter((p) => {
      if (seen.has(p.parcelId)) return false;
      seen.add(p.parcelId);
      return true;
    });
}
