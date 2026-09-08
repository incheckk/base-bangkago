import type { BangkeroDoc, PortDoc, RouteDoc, UserDoc } from '../types/models';
import { friendlyAuthError } from './auth.service';
import { mapRouteRow } from './mappers';
import { supabase } from './supabase';

/** Supabase speaks in error objects; screens need sentences. */
export const friendlyError = friendlyAuthError;

export const routeIdFor = (startPortId: string, endPortId: string) =>
  `${startPortId}__${endPortId}`;

/** Fare lookup by route ID. */
export async function fetchRoute(
  startPortId: string,
  endPortId: string
): Promise<RouteDoc | null> {
  const { data, error } = await supabase
    .from('routes')
    .select('*')
    .eq('id', routeIdFor(startPortId, endPortId))
    .maybeSingle();

  if (error) throw error;
  return data ? mapRouteRow(data) : null;
}

interface CreateArgs {
  passenger: UserDoc;
  fromPort: PortDoc;
  toPort: PortDoc;
  passengerCount: number;
}

/**
 * Creates a booking. id and ref are filled by the set_booking_ref trigger.
 */
export async function createBooking({
  passenger, fromPort, toPort, passengerCount,
}: CreateArgs): Promise<string> {
  if (fromPort.portId === toPort.portId) {
    throw new Error('Pick two different ports.');
  }

  const route = await fetchRoute(fromPort.portId, toPort.portId);
  if (!route) throw new Error('No route runs between those two ports.');
  if (!route.isActive) throw new Error('That route is not running right now.');

  const { data, error } = await supabase
    .from('bookings')
    .insert({
      user_id: passenger.uid,
      passenger_name: `${passenger.firstName} ${passenger.lastName}`.trim(),
      passenger_phone: passenger.phone,
      from_port_name: fromPort.portName,
      to_port_name: toPort.portName,
      num_of_passenger: passengerCount,
      total_price: route.baseFare * passengerCount,
      route_id: route.routeId,
      service_type: 'passenger',
      trip_stat: 'open',
    })
    .select('id')
    .single();

  if (error) throw error;
  return data.id;
}

/** Passenger withdraws. */
export async function cancelBooking(bookingId: string): Promise<void> {
  const { error } = await supabase
    .from('bookings')
    .update({ trip_stat: 'cancelled', cancelled_at: new Date().toISOString() })
    .eq('id', bookingId);
  if (error) throw error;
}

/**
 * First accept wins. RLS policy denies if booking is no longer 'open'.
 */
export async function acceptBooking(
  bookingId: string,
  bangkero: Pick<BangkeroDoc, 'uid' | 'displayName'>
): Promise<void> {
  const { error } = await supabase
    .from('bookings')
    .update({
      trip_stat: 'accepted',
      operator_id: bangkero.uid,
      operator_name: bangkero.displayName,
      accepted_at: new Date().toISOString(),
    })
    .eq('id', bookingId);
  if (error) throw error;
}

/**
 * A decline appends the bangkero's uid to rejected_by atomically.
 */
export async function rejectBooking(bookingId: string, bangkeroUid: string): Promise<void> {
  const { error } = await supabase.rpc('append_rejected_by', {
    booking_id: bookingId,
    operator_uid: bangkeroUid,
  });
  if (error) throw error;
}

/** Only the assigned bangkero can complete. */
export async function completeBooking(bookingId: string): Promise<void> {
  const { error } = await supabase
    .from('bookings')
    .update({ trip_stat: 'completed', completed_at: new Date().toISOString() })
    .eq('id', bookingId);
  if (error) throw error;
}

export async function setAvailability(
  bangkeroUid: string,
  isAvailable: boolean
): Promise<void> {
  const { error } = await supabase
    .from('bangkeros')
    .update({ is_available: isAvailable, updated_at: new Date().toISOString() })
    .eq('id', bangkeroUid);
  if (error) throw error;
}
