import { supabase } from './supabase';
import type { ParcelDoc, ParcelStatus } from '../types/models';

export function mapRow(row: any): ParcelDoc {
  return {
    parcelId: row.id,
    receiverName: row.receiver_name,
    receiverContact: row.receiver_contact,
    totalPrice: row.total_price,
    status: row.status,
    createdAt: row.created_at,
    userId: row.user_id,
    bookingId: row.booking_id,
    carrierBookingId: row.carrier_booking_id ?? null,
    deliveryType: row.delivery_type ?? null,
    piggybackBookingId: row.piggyback_booking_id ?? null,
    approvalStatus: row.approval_status ?? null,
    approvalDeadlineAt: row.approval_deadline_at ?? null,
    totalWeightKg: row.total_weight_kg ?? null,
    originIsland: row.origin_island ?? null,
    destinationIsland: row.destination_island ?? null,
    quotedFare: row.quoted_fare ?? null,
    finalFare: row.final_fare ?? null,
    baseFee: row.base_fee ?? null,
    excessKgFee: row.excess_kg_fee ?? null,
    soloSurcharge: row.solo_surcharge ?? null,
    batchingStatus: row.batching_status ?? null,
    batchingStartedAt: row.batching_started_at ?? null,
    batchingDeadlineAt: row.batching_deadline_at ?? null,
    batchingCycleCount: row.batching_cycle_count ?? null,
    batchingRouteKey: row.batching_route_key ?? null,
    batchedCountAtSail: row.batched_count_at_sail ?? null,
    scheduledDepartureAt: row.scheduled_departure_at ?? null,
    estimatedArrivalAt: row.estimated_arrival_at ?? null,
    actualArrivalAt: row.actual_arrival_at ?? null,
  };
}

export async function createParcel(parcel: {
  receiverName: string;
  receiverContact?: string;
  totalPrice: number;
  userId: string;
  bookingId: string;
  items: { itemName: string; quantity: number; kilogram: number }[];
  deliveryType?: 'accompanied' | 'piggyback' | 'batched' | 'solo';
  piggybackBookingId?: string | null;
  totalWeightKg?: number | null;
  originIsland?: string | null;
  destinationIsland?: string | null;
  quotedFare?: number | null;
  batchedDeadlineAt?: string | null;
  batchingRouteKey?: string | null;
}): Promise<ParcelDoc> {
  const { data, error } = await supabase
    .from('parcels')
    .insert({
      receiver_name: parcel.receiverName,
      receiver_contact: parcel.receiverContact ?? null,
      total_price: parcel.totalPrice,
      user_id: parcel.userId,
      booking_id: parcel.bookingId,
      delivery_type: parcel.deliveryType ?? 'accompanied',
      piggyback_booking_id: parcel.piggybackBookingId ?? null,
      approval_status: parcel.deliveryType === 'piggyback' ? 'pending' : null,
      approval_deadline_at: parcel.deliveryType === 'piggyback'
        ? new Date(Date.now() + 15 * 60_000).toISOString()
        : null,
      total_weight_kg: parcel.totalWeightKg ?? null,
      origin_island: parcel.originIsland ?? null,
      destination_island: parcel.destinationIsland ?? null,
      quoted_fare: parcel.quotedFare ?? null,
      batching_status: parcel.deliveryType === 'batched' ? 'pending_batch' : null,
      batching_deadline_at: parcel.batchedDeadlineAt ?? null,
      batching_route_key: parcel.batchingRouteKey ?? null,
      batching_started_at: parcel.deliveryType === 'batched' ? new Date().toISOString() : null,
    })
    .select()
    .single();

  if (error) throw error;

  if (parcel.items.length > 0) {
    const { error: itemsError } = await supabase
      .from('parcel_items')
      .insert(
        parcel.items.map((item) => ({
          item_name: item.itemName,
          quantity: item.quantity,
          kilogram: item.kilogram,
          parcel_id: data.id,
        }))
      );

    if (itemsError) throw itemsError;
  }

  return mapRow(data);
}

export async function getParcelByBooking(bookingId: string): Promise<ParcelDoc | null> {
  const { data, error } = await supabase
    .from('parcels')
    .select('*')
    .eq('booking_id', bookingId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data) : null;
}

export async function updateParcelStatus(
  parcelId: string,
  status: ParcelStatus
): Promise<void> {
  const { error } = await supabase
    .from('parcels')
    .update({ status })
    .eq('id', parcelId);

  if (error) throw error;
}

export async function getParcelsByUser(userId: string): Promise<ParcelDoc[]> {
  const { data, error } = await supabase
    .from('parcels')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []).map(mapRow);
}

/** Parcels on bookings assigned to this bangkero (RLS also scopes rows). */
export async function getParcelsForBangkero(bangkeroUid: string): Promise<ParcelDoc[]> {
  const { data: bookings, error: bErr } = await supabase
    .from('bookings')
    .select('id')
    .eq('operator_id', bangkeroUid);

  if (bErr) throw bErr;
  const ids = (bookings ?? []).map((b) => b.id);
  if (ids.length === 0) return [];

  const seen = new Set<string>();
  const results: ParcelDoc[] = [];
  const addRows = (rows: any[] | null) => {
    for (const row of rows ?? []) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        results.push(mapRow(row));
      }
    }
  };

  // 1. Direct parcels on the bangkero's own bookings (accompanied cargo).
  const { data: direct, error: dErr } = await supabase
    .from('parcels')
    .select('*')
    .in('booking_id', ids)
    .order('created_at', { ascending: false });
  if (dErr) throw dErr;
  addRows(direct);

  // 2. Piggyback parcels riding one of the bangkero's passenger rides:
  //    their booking_id points at a stub with operator_id = NULL.
  const { data: piggy, error: pErr } = await supabase
    .from('parcels')
    .select('*')
    .eq('delivery_type', 'piggyback')
    .in('piggyback_booking_id', ids)
    .order('created_at', { ascending: false });
  if (pErr) throw pErr;
  addRows(piggy);

  // 3. Option B (045): any parcel whose carrier booking is ours. A
  //    pre-045 schema has no carrier_booking_id column — skip on error.
  const { data: carried, error: cErr } = await supabase
    .from('parcels')
    .select('*')
    .not('carrier_booking_id', 'is', null)
    .in('carrier_booking_id', ids)
    .order('created_at', { ascending: false });
  if (cErr) {
    if (__DEV__) console.warn('[parcel] carrier query skipped:', cErr.message);
  } else {
    addRows(carried);
  }

  results.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return results;
}
