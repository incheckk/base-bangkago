import type { OperatorDoc, PierDoc, RouteDoc, UserDoc } from '../types/models';
import { friendlyAuthError } from './auth.service';
import { mapRouteRow } from './mappers';
import { supabase } from './supabase';

/** Supabase speaks in error objects; screens need sentences. */
export const friendlyError = friendlyAuthError;

export const routeIdFor = (fromPierId: string, toPierId: string) =>
  `${fromPierId}__${toPierId}`;

/** Fare lookup is a single indexed read on the generated id column, not a query. */
export async function fetchRoute(
  fromPierId: string,
  toPierId: string
): Promise<RouteDoc | null> {
  const { data, error } = await supabase
    .from('routes')
    .select('*')
    .eq('id', routeIdFor(fromPierId, toPierId))
    .maybeSingle();

  if (error) throw error;
  return data ? mapRouteRow(data) : null;
}

interface CreateArgs {
  passenger: UserDoc;
  fromPier: PierDoc;
  toPier: PierDoc;
  passengerCount: number;
}

/**
 * id and ref are filled by the set_booking_ref trigger in Postgres, so this
 * insert doesn't need to invent them client-side the way the Firestore
 * version did with doc(collection(db, 'bookings')).
 */
export async function createBooking({
  passenger, fromPier, toPier, passengerCount,
}: CreateArgs): Promise<string> {
  if (fromPier.pierId === toPier.pierId) {
    throw new Error('Pick two different piers.');
  }

  const route = await fetchRoute(fromPier.pierId, toPier.pierId);
  if (!route) throw new Error('No route runs between those two piers.');
  if (!route.isActive) throw new Error('That route is not running right now.');

  const { data, error } = await supabase
    .from('bookings')
    .insert({
      passenger_id: passenger.uid,
      passenger_name: `${passenger.firstName} ${passenger.lastName}`.trim(),
      passenger_phone: passenger.phone,
      from_pier_id: fromPier.pierId,
      from_pier_name: fromPier.name,
      to_pier_id: toPier.pierId,
      to_pier_name: toPier.name,
      passenger_count: passengerCount,
      fare: route.fare,
      estimated_minutes: route.estimatedMinutes,
      payment_method: 'cash',
      status: 'open',
    })
    .select('id')
    .single();

  if (error) throw error;
  return data.id;
}

/** Passenger withdraws. Stage 5's RLS policy only permits this while still open. */
export async function cancelBooking(bookingId: string): Promise<void> {
  const { error } = await supabase
    .from('bookings')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
    .eq('id', bookingId);
  if (error) throw error;
}

/**
 * First accept wins. There is no transaction here, same as the Firestore
 * version: a second bangkero tapping Accept hits a booking that is no
 * longer 'open', and Stage 5's RLS policy denies it. The race resolves in
 * the database, not in app code.
 */
export async function acceptBooking(
  bookingId: string,
  operator: Pick<OperatorDoc, 'uid' | 'displayName' | 'boatName'>
): Promise<void> {
  const { error } = await supabase
    .from('bookings')
    .update({
      status: 'accepted',
      operator_id: operator.uid,
      operator_name: operator.displayName,
      operator_boat_name: operator.boatName,
      accepted_at: new Date().toISOString(),
    })
    .eq('id', bookingId);
  if (error) throw error;
}

/**
 * A decline is recorded against the operator, not the booking — the request
 * stays open for everyone else. This calls a Postgres function
 * (append_rejected_by) rather than reading the array and writing it back,
 * because that read-modify-write would lose a concurrent decline from
 * another bangkero. The function does array_append in one atomic statement
 * — the same guarantee Firestore's arrayUnion() gave for free.
 */
export async function rejectBooking(bookingId: string, operatorUid: string): Promise<void> {
  const { error } = await supabase.rpc('append_rejected_by', {
    booking_id: bookingId,
    operator_uid: operatorUid,
  });
  if (error) throw error;
}

/** Only the assigned bangkero can complete; Stage 5's policy checks operator_id. */
export async function completeBooking(bookingId: string): Promise<void> {
  const { error } = await supabase
    .from('bookings')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', bookingId);
  if (error) throw error;
}

export async function setAvailability(
  operatorUid: string,
  isAvailable: boolean
): Promise<void> {
  const { error } = await supabase
    .from('operators')
    .update({ is_available: isAvailable, updated_at: new Date().toISOString() })
    .eq('id', operatorUid);
  if (error) throw error;
}