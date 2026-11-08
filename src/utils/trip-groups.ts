import type { BookingDoc } from '@/types/models';

export interface TripGroup {
  key: string;
  groupBookingId: string | null;
  bookings: BookingDoc[];
  pax: number;
  cargoCount: number;
  totalPrice: number;
  refs: string[];
}

/**
 * 071: accepted bookings share a group id when they sail on the same boat,
 * route and sailing day/slot. Single bookings have no id, so each one is
 * its own group. The bangkero home renders one card per group.
 */
export function groupAcceptedBookings(trips: BookingDoc[]): TripGroup[] {
  const map = new Map<string, TripGroup>();

  for (const b of trips) {
    const key = b.groupBookingId ?? `single:${b.bookingId}`;
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        groupBookingId: b.groupBookingId ?? null,
        bookings: [],
        pax: 0,
        cargoCount: 0,
        totalPrice: 0,
        refs: [],
      };
      map.set(key, g);
    }
    g.bookings.push(b);
    // Cargo stubs carry a synthetic 1 pax; only people count as seats.
    g.pax += b.serviceType === 'cargo' ? 0 : b.numOfPassenger;
    if (b.serviceType === 'cargo') g.cargoCount += 1;
    g.totalPrice += b.totalPrice;
    g.refs.push(b.ref);
  }

  const list = [...map.values()];
  for (const g of list) {
    g.bookings.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    g.refs = g.bookings.map((b) => b.ref);
  }
  list.sort((a, b) => {
    const aLast = a.bookings[a.bookings.length - 1]?.createdAt ?? '';
    const bLast = b.bookings[b.bookings.length - 1]?.createdAt ?? '';
    return bLast.localeCompare(aLast);
  });
  return list;
}
