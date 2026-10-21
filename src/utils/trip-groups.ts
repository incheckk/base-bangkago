import type { BookingDoc, ParcelDoc } from '@/types/models';

export interface ActiveTripGroup {
  key: string;
  passenger: BookingDoc | null;
  cargo: BookingDoc[];
  bookings: BookingDoc[];
  pax: number;
  cargoCount: number;
  totalFare: number;
  totalWeightKg: number;
}

function cargoModeOf(
  booking: BookingDoc,
  parcelsByBookingId: Map<string, ParcelDoc>,
  parcels: ParcelDoc[],
): string | null {
  if (booking.cargoMode) return booking.cargoMode;
  const direct = parcelsByBookingId.get(booking.bookingId)?.deliveryType;
  if (direct) return direct;
  return parcels.find((p) => p.carrierBookingId === booking.bookingId)?.deliveryType ?? null;
}

function isMergeableCargo(
  booking: BookingDoc,
  parcelsByBookingId: Map<string, ParcelDoc>,
  parcels: ParcelDoc[],
): boolean {
  if (booking.serviceType !== 'cargo') return false;
  const mode = cargoModeOf(booking, parcelsByBookingId, parcels);
  return mode === 'solo' || mode === 'batched';
}

export function tripGroupKey(booking: BookingDoc): string {
  return [booking.operatorId ?? '', booking.routeId].join('|');
}

function groupWeight(bookings: BookingDoc[], parcels: ParcelDoc[]): number {
  const bookingIds = new Set(bookings.map((b) => b.bookingId));
  const parcelIds = new Set<string>();
  let total = 0;
  for (const parcel of parcels) {
    const belongs =
      bookingIds.has(parcel.bookingId) ||
      (!!parcel.carrierBookingId && bookingIds.has(parcel.carrierBookingId));
    if (!belongs || parcelIds.has(parcel.parcelId)) continue;
    parcelIds.add(parcel.parcelId);
    total += parcel.totalWeightKg ?? 0;
  }
  return total;
}

function makeGroup(
  passenger: BookingDoc | null,
  cargo: BookingDoc[],
  parcels: ParcelDoc[],
): ActiveTripGroup {
  const bookings = passenger ? [passenger, ...cargo] : [...cargo];
  const base = passenger ?? cargo[0];
  return {
    key: tripGroupKey(base),
    passenger,
    cargo,
    bookings,
    pax: passenger?.numOfPassenger ?? 0,
    cargoCount: cargo.length,
    totalFare: bookings.reduce((sum, b) => sum + b.totalPrice, 0),
    totalWeightKg: groupWeight(bookings, parcels),
  };
}

export function groupActiveTrips(
  trips: BookingDoc[],
  parcels: ParcelDoc[],
): ActiveTripGroup[] {
  const parcelsByBookingId = new Map<string, ParcelDoc>();
  for (const parcel of parcels) {
    if (parcel.bookingId) parcelsByBookingId.set(parcel.bookingId, parcel);
  }

  const primaryByKey = new Map<string, BookingDoc>();
  for (const booking of trips) {
    if (booking.serviceType !== 'passenger') continue;
    const key = tripGroupKey(booking);
    if (!primaryByKey.has(key)) primaryByKey.set(key, booking);
  }

  const groups: ActiveTripGroup[] = [];
  const primaryGroups = new Map<string, ActiveTripGroup>();
  const cargoByKey = new Map<string, BookingDoc[]>();

  for (const booking of trips) {
    const key = tripGroupKey(booking);
    if (booking.serviceType === 'passenger') {
      const group = makeGroup(booking, [], parcels);
      groups.push(group);
      if (primaryByKey.get(key) === booking) primaryGroups.set(key, group);
      continue;
    }

    if (isMergeableCargo(booking, parcelsByBookingId, parcels) && primaryByKey.has(key)) {
      const list = cargoByKey.get(key);
      if (list) list.push(booking);
      else cargoByKey.set(key, [booking]);
      continue;
    }

    groups.push(makeGroup(null, [booking], parcels));
  }

  for (const [key, cargo] of cargoByKey) {
    const group = primaryGroups.get(key);
    if (group) {
      group.cargo.push(...cargo);
      continue;
    }
    for (const booking of cargo) groups.push(makeGroup(null, [booking], parcels));
  }

  for (const group of groups) {
    group.cargo.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    group.bookings = group.passenger ? [group.passenger, ...group.cargo] : [...group.cargo];
    group.pax = group.passenger?.numOfPassenger ?? 0;
    group.cargoCount = group.cargo.length;
    group.totalFare = group.bookings.reduce((sum, b) => sum + b.totalPrice, 0);
    group.totalWeightKg = groupWeight(group.bookings, parcels);
  }

  return groups;
}
