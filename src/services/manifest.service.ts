import { supabase } from './supabase';

export interface TripManifest {
  manifestId: string;
  actualDepartureTime: string | null;
  actualArrivalTime: string | null;
  totalPassengersOnBoard: number;
  totalParcelsOnBoard: number;
  status: 'draft' | 'finalized' | 'cancelled';
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

export async function getActiveManifest(bangkeroId: string): Promise<TripManifest | null> {
  const { data, error } = await supabase
    .from('trip_manifest')
    .select('*')
    .eq('bangkero_id', bangkeroId)
    .eq('status', 'draft')
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
  return (data ?? []).map(mapManifestParcel);
}
