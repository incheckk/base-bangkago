import type { BookingDoc, ParcelDoc, PaymentDoc } from '@/types/models';

// =============================================================
// Manifest = "sailings": the bangkero's bookings grouped by the
// day they SAIL and the route they run (route + sail-day group).
// Advance/slot trips carry scheduledDate — grouping by creation day
// would scatter one sailing across booking days. Same-day trips have
// no scheduled date, so they fall back to their Manila creation day.
// Derived client-side from bookings + parcels + payments — no
// schema change. Shared by the manifest list and sailing detail.
// =============================================================

export interface Sailing {
  /** `${day}|${from}|${to}` — stable identity for navigation. */
  key: string;
  /** Sail day (scheduledDate, else Manila creation day), YYYY-MM-DD. */
  day: string;
  from: string;
  to: string;
  /** Oldest first (boarding order). */
  bookings: BookingDoc[];
  pax: number;
  parcelCount: number;
  /** Bookings whose payment is missing or still pending. */
  unpaidCount: number;
  /** Any booking still accepted → the sailing is happening now. */
  inProgress: boolean;
}

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

/** Manila calendar day (YYYY-MM-DD) for "now" or an instant. Schedules
 *  live in Asia/Manila — device-local days skew Today/Yesterday on
 *  foreign phones. Manila has no DST so this is exact. */
function manilaYmd(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}

export function dayKey(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? localYmd(new Date()) : manilaYmd(d);
}

export function todayKey(): string {
  return manilaYmd(new Date());
}

function offsetDay(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return localYmd(date);
}

/** "Today · Sep 30" / "Yesterday · Sep 29" / "Sep 28, 2026". */
export function sailingDayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = todayKey();
  if (day === today) return `Today · ${date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}`;
  if (day === offsetDay(today, -1)) return `Yesterday · ${date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}`;
  return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Group bookings into sailings (sail day + route), attach parcel counts
 * and payment state, oldest booking first inside each sailing.
 * Cancelled bookings are excluded entirely — they neither sailed nor
 * owe payment, so counting them inflates pax and unpaid badges.
 * The list is sorted newest sailing first.
 */
export function buildSailings(
  trips: BookingDoc[],
  parcels: ParcelDoc[],
  payments: Record<string, PaymentDoc>
): Sailing[] {
  const map = new Map<string, Sailing>();
  const sailingOfBooking = new Map<string, Sailing>();

  for (const t of trips) {
    if (t.status === 'cancelled') continue;
    const from = t.fromPortName ?? 'Unknown port';
    const to = t.toPortName ?? 'Unknown port';
    // Sail day, not booking day: advance/slot trips sail on scheduledDate.
    const day = t.scheduledDate ?? dayKey(t.createdAt);
    // routeId IS start__end, so one route always maps to one from/to pair;
    // the key keeps the day|from|to shape the sailing screen navigates by.
    const key = `${day}|${from}|${to}`;
    let s = map.get(key);
    if (!s) {
      s = {
        key, day, from, to,
        bookings: [], pax: 0, parcelCount: 0, unpaidCount: 0, inProgress: false,
      };
      map.set(key, s);
    }
    s.bookings.push(t);
    s.pax += t.numOfPassenger;
    if (t.status === 'accepted') s.inProgress = true;
    const p = payments[t.bookingId];
    if (!p || p.paymentStatus !== 'completed') s.unpaidCount += 1;
    sailingOfBooking.set(t.bookingId, s);
  }

  for (const parcel of parcels) {
    const s = sailingOfBooking.get(parcel.bookingId);
    if (s) s.parcelCount += 1;
  }

  const list = Array.from(map.values());
  for (const s of list) {
    s.bookings.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  list.sort((a, b) => {
    if (a.day !== b.day) return b.day.localeCompare(a.day);
    const aLast = a.bookings[a.bookings.length - 1]?.createdAt ?? '';
    const bLast = b.bookings[b.bookings.length - 1]?.createdAt ?? '';
    return bLast.localeCompare(aLast);
  });
  return list;
}

/** One booking is "aboard" once confirmed on board, done, or never coming. */
export function bookingAboard(b: BookingDoc): boolean {
  return b.status === 'completed' || b.status === 'cancelled' || !!b.onboardedAt;
}

export function sailingAboard(s: Sailing): boolean {
  return s.bookings.filter((b) => b.status !== 'cancelled').every(bookingAboard);
}
