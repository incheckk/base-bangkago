import {
  arrayUnion, collection, doc, getDoc, serverTimestamp, setDoc, updateDoc,
  type Timestamp,
} from 'firebase/firestore';

import { db } from './firebase';
import { friendlyAuthError } from './auth.service';
import type { BookingDoc, OperatorDoc, PierDoc, RouteDoc, UserDoc } from '../types/models';

/** Firebase speaks in error codes; screens need sentences. */
export const friendlyError = friendlyAuthError;

export const routeIdFor = (fromPierId: string, toPierId: string) =>
  `${fromPierId}__${toPierId}`;

/** Fare lookup is a constant-time getDoc on a deterministic id, not a query. */
export async function fetchRoute(
  fromPierId: string,
  toPierId: string
): Promise<RouteDoc | null> {
  const snap = await getDoc(doc(db, 'routes', routeIdFor(fromPierId, toPierId)));
  return snap.exists() ? (snap.data() as RouteDoc) : null;
}

interface CreateArgs {
  passenger: UserDoc;
  fromPier: PierDoc;
  toPier: PierDoc;
  passengerCount: number;
}

/**
 * Writes the booking with its id already known, so `ref` can be derived in the
 * same write — a sequential counter would need a transaction and add a live
 * failure point for something cosmetic.
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

  const bookingRef = doc(collection(db, 'bookings'));

  const booking: BookingDoc = {
    bookingId: bookingRef.id,
    ref: `BGO-${bookingRef.id.slice(0, 6).toUpperCase()}`,
    passengerId: passenger.uid,
    passengerName: `${passenger.firstName} ${passenger.lastName}`.trim(),
    passengerPhone: passenger.phone,
    fromPierId: fromPier.pierId,
    fromPierName: fromPier.name,
    toPierId: toPier.pierId,
    toPierName: toPier.name,
    passengerCount,
    fare: route.fare,
    estimatedMinutes: route.estimatedMinutes,
    paymentMethod: 'cash',
    status: 'open',
    operatorId: null,
    operatorName: null,
    operatorBoatName: null,
    rejectedBy: [],
    createdAt: serverTimestamp() as unknown as Timestamp,
    acceptedAt: null,
    completedAt: null,
    cancelledAt: null,
  };

  await setDoc(bookingRef, booking);
  return bookingRef.id;
}

/** Passenger withdraws. Rules only permit this while the booking is still open. */
export async function cancelBooking(bookingId: string): Promise<void> {
  await updateDoc(doc(db, 'bookings', bookingId), {
    status: 'cancelled',
    cancelledAt: serverTimestamp(),
  });
}

/**
 * First accept wins. There is no transaction: a second bangkero tapping Accept
 * hits a booking that is no longer `open`, and the security rule denies it.
 * The race resolves itself in the database rather than in app code.
 */
export async function acceptBooking(
  bookingId: string,
  operator: Pick<OperatorDoc, 'uid' | 'displayName' | 'boatName'>
): Promise<void> {
  await updateDoc(doc(db, 'bookings', bookingId), {
    status: 'accepted',
    operatorId: operator.uid,
    operatorName: operator.displayName,
    operatorBoatName: operator.boatName,
    acceptedAt: serverTimestamp(),
  });
}

/**
 * A decline is recorded against the operator, not the booking — the request
 * stays open for every other bangkero.
 */
export async function rejectBooking(bookingId: string, operatorUid: string): Promise<void> {
  await updateDoc(doc(db, 'bookings', bookingId), {
    rejectedBy: arrayUnion(operatorUid),
  });
}

/** Only the assigned bangkero can complete; the rule checks operatorId. */
export async function completeBooking(bookingId: string): Promise<void> {
  await updateDoc(doc(db, 'bookings', bookingId), {
    status: 'completed',
    completedAt: serverTimestamp(),
  });
}

export async function setAvailability(
  operatorUid: string,
  isAvailable: boolean
): Promise<void> {
  await updateDoc(doc(db, 'operators', operatorUid), {
    isAvailable,
    updatedAt: serverTimestamp(),
  });
}
