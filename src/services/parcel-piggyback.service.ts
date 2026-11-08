/**
 * Parcel Padala — Piggyback service (Phase 1, Mode 2).
 *
 * Finds passenger bookings that can carry a parcel to the same
 * destination. The parcel rides with the passenger's trip at the
 * piggyback rate (₱120 base — same as accompanied).
 *
 * Flow:
 *   1. Sender books piggyback → findEligiblePiggybackBooking()
 *   2. Parcel linked via piggyback_booking_id
 *   3. Bangkero approves/rejects within 15 min
 *   4. If rejected/timed out → sender falls back to batched/solo
 */
import type { ParcelDoc, PiggybackCandidate } from '../types/models';
import { routeIdFor } from './booking.service';
import { createNotification } from './notification.service';
import { mapRow } from './parcel.service';
import { supabase } from './supabase';

export async function findEligiblePiggybackBooking(params: {
  fromPortId: string;
  toPortId: string;
  scheduledDate?: string;
}): Promise<PiggybackCandidate | null> {
  const routeId = routeIdFor(params.fromPortId, params.toPortId);
  const today = new Date().toISOString().slice(0, 10);
  const minDate = params.scheduledDate ?? today;

  // Query 1: find candidate passenger bookings (no join)
  const { data: candidates, error } = await supabase
    .from('bookings')
    .select('id, operator_id, route_id, scheduled_date, scheduled_time, trip_stat')
    .eq('route_id', routeId)
    .eq('service_type', 'passenger')
    .in('trip_stat', ['open', 'accepted'])
    .gte('scheduled_date', minDate)
    .not('operator_id', 'is', null)
    .order('scheduled_date', { ascending: true })
    .order('scheduled_time', { ascending: true })
    .limit(10);

  if (error || !candidates || candidates.length === 0) return null;

  // Query 2: filter to bangkeros with piggyback_opt_in = true
  const operatorIds = [...new Set(candidates.map((c) => c.operator_id))];

  const { data: optedInBangkeros } = await supabase
    .from('bangkeros')
    .select('id')
    .in('id', operatorIds)
    .eq('piggyback_opt_in', true)
    .eq('is_deleted', false);

  const optedInIds = new Set((optedInBangkeros ?? []).map((b) => b.id));

  // Return the first candidate whose bangkero has opted in
  const match = candidates.find((c) => optedInIds.has(c.operator_id));
  if (!match) return null;

  return {
    bookingId: match.id,
    operatorId: match.operator_id,
    routeId: match.route_id,
    scheduledDate: match.scheduled_date ?? null,
    scheduledTime: match.scheduled_time ?? null,
    status: match.trip_stat,
  };
}

/**
 * Accept a pending piggyback request.
 *
 * One SECURITY DEFINER RPC (072) does the whole write atomically: approves
 * the parcel, links it to the carrier ride, accepts the sender's cargo stub
 * and merges that stub into the carrier trip's group_booking_id using the
 * same group rule as 071. The stub is non-dispatchable, so accept_booking_hold
 * would refuse it — this is the only correct accept path.
 */
export async function acceptPiggybackRequest(parcelId: string): Promise<void> {
  const { error } = await supabase.rpc('accept_piggyback_request', {
    p_parcel_id: parcelId,
  });

  if (error) throw new Error(`Failed to accept piggyback: ${error.message}`);

  await notifySender(
    parcelId,
    'Piggyback approved',
    (receiverName) =>
      `Your parcel for ${receiverName} will ride with a passenger trip.`
  );
}

/** Back-compat alias for the retired cube-icon screen. */
export async function approvePiggyback(parcelId: string): Promise<void> {
  await acceptPiggybackRequest(parcelId);
}

export async function rejectPiggyback(parcelId: string): Promise<void> {
  const { error } = await supabase
    .from('parcels')
    .update({ approval_status: 'rejected' })
    .eq('id', parcelId);

  if (error) throw new Error(`Failed to reject piggyback: ${error.message}`);

  await notifySender(
    parcelId,
    'Piggyback declined',
    () => 'No passenger trip accepted your parcel. Open Track Delivery to choose another option.'
  );
}

export async function timeoutPiggyback(parcelId: string): Promise<void> {
  const { error } = await supabase
    .from('parcels')
    .update({ approval_status: 'timeout' })
    .eq('id', parcelId);

  if (error) throw new Error(`Failed to timeout piggyback: ${error.message}`);

  await notifySender(
    parcelId,
    'Piggyback timed out',
    () => 'The bangkero did not respond in time. Open Track Delivery to choose another option.'
  );
}

/**
 * Best-effort sender notification — never fails the approval action
 * itself (the status UPDATE above already succeeded by this point).
 */
async function notifySender(
  parcelId: string,
  title: string,
  messageFor: (receiverName: string) => string
): Promise<void> {
  try {
    const { data: parcel } = await supabase
      .from('parcels')
      .select('user_id, receiver_name')
      .eq('id', parcelId)
      .maybeSingle();

    if (parcel?.user_id) {
      await createNotification(
        parcel.user_id,
        title,
        messageFor(parcel.receiver_name ?? 'your parcel')
      );
    }
  } catch {
    // notification failed — the approval outcome still stands
  }
}

/**
 * List pending piggyback requests for a bangkero.
 * Returns parcels where:
 *   - delivery_type = 'piggyback'
 *   - approval_status = 'pending'
 *   - the linked passenger booking is operated by this bangkero
 */
export async function listPendingPiggybackRequests(
  operatorId: string
): Promise<ParcelDoc[]> {
  // 1. Get all pending piggyback parcels
  const { data: parcels, error } = await supabase
    .from('parcels')
    .select('*')
    .eq('delivery_type', 'piggyback')
    .eq('approval_status', 'pending')
    .order('approval_deadline_at', { ascending: true });

  if (error || !parcels || parcels.length === 0) return [];

  // 2. Filter to those whose piggyback_booking_id belongs to this operator
  const bookingIds = parcels
    .map((p) => p.piggyback_booking_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);

  if (bookingIds.length === 0) return [];

  const { data: bookings } = await supabase
    .from('bookings')
    .select('id, operator_id')
    .in('id', bookingIds)
    .eq('operator_id', operatorId);

  const validBookingIds = new Set((bookings ?? []).map((b) => b.id));

  return parcels
    .filter((p) =>
      p.piggyback_booking_id && validBookingIds.has(p.piggyback_booking_id)
    )
    .map(mapRow);
}
