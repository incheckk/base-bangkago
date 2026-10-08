import type { BangkeroDoc, PortDoc, RouteDoc, UserDoc } from '../types/models';
import { manilaTodayIso } from '../utils/date';
import { friendlyAuthError } from './auth.service';
import { mapRouteRow } from './mappers';
import { createNotification } from './notification.service';
import { getPassengerDetailsByBooking } from './passenger-detail.service';
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

export interface CreateBookingResult {
  bookingId: string;
  ref: string;
}

/**
 * The passenger's live booking, if any. One active trip at a time — screens
 * gate on this before letting the passenger start another request, and
 * createBooking re-checks as the server-side backstop.
 */
export async function getActiveBooking(
  passengerUid: string
): Promise<{ bookingId: string; ref: string } | null> {
  const { data, error } = await supabase
    .from('bookings')
    .select('id, ref')
    .eq('user_id', passengerUid)
    .in('trip_stat', ['pending', 'open', 'accepted'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? { bookingId: data.id, ref: data.ref } : null;
}

export interface BookingBan {
  until: Date;
  minutesLeft: number;
}

const BAN_FIRST_MS = 30 * 60 * 1000;
const BAN_REPEAT_MS = 60 * 60 * 1000;
const BAN_REPEAT_WINDOW_MS = 30 * 86400000;

/**
 * The no-show ban: read the 2 newest no_show_at stamps for this
 * passenger. First offense is 30 minutes; a repeat no-show within 30
 * days of the previous one stretches the ban to 60 minutes. Returns
 * null when no ban is active.
 */
export async function getBookingBan(passengerUid: string): Promise<BookingBan | null> {
  const { data, error } = await supabase
    .from('bookings')
    .select('no_show_at')
    .eq('user_id', passengerUid)
    .not('no_show_at', 'is', null)
    .order('no_show_at', { ascending: false })
    .limit(2);
  if (error) throw error;

  const stamps = (data ?? [])
    .map((r) => new Date(r.no_show_at as string))
    .filter((d) => !Number.isNaN(d.getTime()));
  if (stamps.length === 0) return null;

  const latest = stamps[0].getTime();
  const prior = stamps[1]?.getTime();
  const durationMs =
    prior !== undefined && latest - prior <= BAN_REPEAT_WINDOW_MS
      ? BAN_REPEAT_MS
      : BAN_FIRST_MS;
  const untilMs = latest + durationMs;
  const now = Date.now();
  if (now >= untilMs) return null;
  return {
    until: new Date(untilMs),
    minutesLeft: Math.max(1, Math.ceil((untilMs - now) / 60000)),
  };
}

interface CreateArgs {
  passenger: UserDoc;
  fromPort: Pick<PortDoc, 'portId' | 'portName'>;
  toPort: Pick<PortDoc, 'portId' | 'portName'>;
  passengerCount: number;
  serviceType?: 'passenger' | 'cargo';
  totalFare?: number;
  /** Island-hopping package the booking belongs to (stored for itinerary display). */
  packageId?: string;
  /** Sailing date (YYYY-MM-DD) and slot; future dates escrow first (020). */
  scheduledDate?: string;
  scheduledTime?: string;
}

/** Advance = sailing date after today (Manila). Needs the 50% escrow. */
export function isAdvanceDate(scheduledDate?: string | null): boolean {
  if (!scheduledDate) return false;
  return scheduledDate > manilaTodayIso();
}

/**
 * Creates a booking. id and ref are filled by the set_booking_ref trigger.
 * totalFare (screen-computed, includes discounts/cargo multiplier) is
 * honored after the route is validated. A future sailing date lands the
 * row in 'pending' until the admin clears the escrow (020).
 */
export async function createBooking({
  passenger, fromPort, toPort, passengerCount, serviceType = 'passenger', totalFare, packageId,
  scheduledDate, scheduledTime,
}: CreateArgs): Promise<CreateBookingResult> {
  if (fromPort.portId === toPort.portId) {
    throw new Error('Pick two different ports.');
  }

  const route = await fetchRoute(fromPort.portId, toPort.portId);
  if (!route) throw new Error('No route runs between those two ports.');
  if (!route.isActive) throw new Error('That route is not running right now.');

  const active = await getActiveBooking(passenger.uid);
  if (active) throw new Error('You already have a pending booking.');

  const ban = await getBookingBan(passenger.uid);
  if (ban) {
    throw new Error(
      `You were marked as a no-show. You can book again in ${ban.minutesLeft} minute${ban.minutesLeft === 1 ? '' : 's'}.`
    );
  }

  const totalPrice = totalFare ?? route.baseFare * passengerCount;
  const advance = isAdvanceDate(scheduledDate);
  if (advance && !scheduledTime) {
    throw new Error('Pick a departure time for your sailing date.');
  }

  const { data, error } = await supabase
    .from('bookings')
    .insert({
      user_id: passenger.uid,
      passenger_name: `${passenger.firstName} ${passenger.lastName}`.trim(),
      passenger_phone: passenger.phone,
      from_port_name: fromPort.portName,
      to_port_name: toPort.portName,
      num_of_passenger: passengerCount,
      total_price: totalPrice,
      route_id: route.routeId,
      service_type: serviceType,
      trip_stat: advance ? 'pending' : 'open',
      scheduled_date: scheduledDate ?? null,
      scheduled_time: advance ? scheduledTime : (scheduledTime ?? null),
      ...(packageId ? { package_id: packageId } : {}),
    })
    .select('id, ref')
    .single();

  if (error) throw error;

  // FCFS dispatch: hand the request its first 3-minute hold (008).
  // Skipped for advance rows — no hold exists until the admin flips
  // them open. Result ignored on purpose — pre-migration the RPC is
  // simply missing and the booking itself must still be created.
  if (!advance) {
    await supabase.rpc('assign_next_hold', { p_booking_id: data.id });
  }

  return { bookingId: data.id, ref: data.ref };
}

/**
 * Passenger withdraws — plain cancel, the 10-minute escape, or a dispute.
 * One atomic RPC write: status, timestamp and reason land together, and a
 * row that is already cancelled (double-tap, lost race) raises instead of
 * silently succeeding.
 */
export async function cancelBooking(bookingId: string, reason?: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_own_booking', {
    p_booking_id: bookingId,
    p_reason: reason ?? null,
  });
  if (error) throw error;
}

/**
 * First eligible boat in the port queue wins — the hold check, queue
 * membership, route lock, fit-check and the bangkero gates (documents
 * + rating, 010) all live in the accept_booking_hold RPC. A row that
 * lost any of those races raises a sentence the screen can show
 * instead of a 0-row silence.
 */
export async function acceptBooking(
  bookingId: string,
  bangkero: Pick<BangkeroDoc, 'uid' | 'displayName'>
): Promise<void> {
  // Documents + rating are enforced inside the RPC (010) so the admin
  // gates-bypass switch applies; the sentence arrives mapped through
  // friendlyError ("rating is too low", "documents are not approved").
  const { error } = await supabase.rpc('accept_booking_hold', {
    p_booking_id: bookingId,
    p_operator_name: bangkero.displayName,
  });
  if (error) throw error;
}

/**
 * A decline appends the caller's own uid and cascades the offer to
 * the next boat in line — one RPC (008).
 */
export async function rejectBooking(bookingId: string): Promise<void> {
  const { error } = await supabase.rpc('decline_booking_hold', {
    p_booking_id: bookingId,
  });
  if (error) throw error;
}

/**
 * Only the assigned bangkero can complete — and only once every
 * passenger is confirmed aboard. The complete_trip RPC enforces both
 * (007) and raises a sentence the screen can show.
 */
export async function completeBooking(bookingId: string): Promise<void> {
  const { error } = await supabase.rpc('complete_trip', { p_booking_id: bookingId });
  if (error) throw error;
}

/**
 * Arrival-bypass fallback (026): complete_trip refuses bookings that
 * were never marked onboarded; this RPC skips that one check — but ONLY
 * while the admin's dev_flags.arrival_bypass switch is on, and still
 * only for the assigned bangkero. The RPC raises when the flag is off.
 */
export async function forceCompleteBooking(bookingId: string): Promise<void> {
  const { error } = await supabase.rpc('force_complete_trip', { p_booking_id: bookingId });
  if (error) throw error;
}

/**
 * C8: the operator stamps the actual departure time (the 004 UPDATE
 * policy blocks partial writes on an accepted row, hence the RPC).
 */
export async function stampBookingDepart(bookingId: string): Promise<void> {
  const { error } = await supabase.rpc('stamp_booking_depart', {
    p_booking_id: bookingId,
  });
  if (error) throw error;
}

/**
 * Bangkero confirms (or un-confirms) that the whole party is aboard.
 * Column-scoped RPC — writes ONLY onboarded_at, nothing else.
 */
export async function setOnboarded(bookingId: string, boarded: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_booking_boarded', {
    p_booking_id: bookingId,
    p_boarded: boarded,
  });
  if (error) throw error;
}

/**
 * Bangkero scans a boarding QR ('PAX'+token for a companion, the ref for
 * the booker). The RPC resolves the row, stamps the checklist and returns
 * the passenger's name for the toast; a code from another trip raises.
 */
export async function verifyBoardingQr(token: string): Promise<string> {
  const { data, error } = await supabase.rpc('verify_boarding_qr', {
    p_token: token,
  });
  if (error) throw error;
  return data as string;
}

/** Manual checklist tick for one companion row (or undo with 'pending'). */
export async function setPassengerBoarded(
  detailId: string,
  state: 'boarded' | 'not_boarded' | 'pending'
): Promise<void> {
  const { error } = await supabase.rpc('set_passenger_boarded', {
    p_detail_id: detailId,
    p_state: state,
  });
  if (error) throw error;
}

/**
 * The bangkero's no-show valve: the boat leaves with whoever is aboard.
 * One RPC write stamps cancelled + no_show_at + reason atomically, then
 * the passenger is notified with how long their booking ban lasts.
 * No refund — the fare is collected on board, so nothing was charged.
 */
export async function noShowPassenger(booking: {
  bookingId: string;
  ref: string;
  userId: string;
  fromPortName: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc('mark_no_show', {
    p_booking_id: booking.bookingId,
    p_reason: 'Passenger(s) did not board — marked no-show by the bangkero.',
  });
  if (error) throw error;

  const ban = await getBookingBan(booking.userId).catch(() => null);
  const mins = ban?.minutesLeft;
  createNotification(
    booking.userId,
    'You were marked as a no-show',
    `The boat for ${booking.ref} left ${booking.fromPortName ?? 'the port'} after you were told to board.` +
      (mins ? ` You can't book again for ${mins} minute${mins === 1 ? '' : 's'}.` : '')
  ).catch(() => {});
}

/**
 * Passenger group dispute (022): the reporter is marked NOT aboard —
 * trip_stat is untouched, so the rest of the party sails and the trip
 * still completes. Solo bookings cancel instead (call site decides).
 */
export async function disputeBoarding(bookingId: string): Promise<void> {
  const { error } = await supabase.rpc('dispute_boarding', {
    p_booking_id: bookingId,
  });
  if (error) throw error;
}

/**
 * Bangkero marks the booker absent while companions sail (022):
 * no_show_at without cancelling — feeds the ban, trip stays accepted.
 */
export async function markBookerAbsent(bookingId: string): Promise<void> {
  const { error } = await supabase.rpc('mark_booker_absent', {
    p_booking_id: bookingId,
  });
  if (error) throw error;
}

/**
 * Group no-show with per-passenger granularity (022):
 *  - NOBODY from the booking sailed → cancel it exactly as before
 *    (mark_no_show: cancelled + no_show_at + ban + notification);
 *  - SOMEONE sailed → keep the booking accepted, mark only the absent
 *    passengers (booker via mark_booker_absent, companions via
 *    set_passenger_boarded('not_boarded')) and tell the booker.
 * Returns which path ran so the call site can latch its UI.
 */
export async function resolveGroupNoShow(booking: {
  bookingId: string;
  ref: string;
  userId: string;
  fromPortName: string | null;
  onboardedAt: string | null;
}): Promise<'cancelled' | 'partial'> {
  const companions = await getPassengerDetailsByBooking(booking.bookingId).catch(
    () => []
  );
  const anyoneSailed = !!booking.onboardedAt || companions.some((c) => !!c.boardedAt);

  if (!anyoneSailed) {
    await noShowPassenger(booking);
    return 'cancelled';
  }

  if (!booking.onboardedAt) await markBookerAbsent(booking.bookingId);
  for (const c of companions) {
    if (!c.boardedAt && !c.noShowAt) {
      await setPassengerBoarded(c.passengerId, 'not_boarded').catch(() => null);
    }
  }

  const ban = await getBookingBan(booking.userId).catch(() => null);
  const mins = ban?.minutesLeft;
  createNotification(
    booking.userId,
    'Some passengers did not board',
    `The boat for ${booking.ref} left ${booking.fromPortName ?? 'the port'} without the passengers who missed boarding — the rest of the booking continues.` +
      (mins ? ` The booker can't book again for ${mins} minute${mins === 1 ? '' : 's'}.` : '')
  ).catch(() => {});
  return 'partial';
}

export async function setAvailability(
  bangkeroUid: string,
  isAvailable: boolean
): Promise<void> {
  // Going offline mid-trip would strand accepted passengers; the UI blocks it
  // too, but this is the backstop if the trip list is stale or out of order.
  if (!isAvailable) {
    const { data, error } = await supabase
      .from('bookings')
      .select('id')
      .eq('operator_id', bangkeroUid)
      .eq('trip_stat', 'accepted')
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data) throw new Error('You have an active trip. You cannot go offline until it completes.');
  }
  const { error } = await supabase
    .from('bangkeros')
    .update({ is_available: isAvailable, updated_at: new Date().toISOString() })
    .eq('id', bangkeroUid);
  if (error) throw error;

  // Offline write landed — re-check for an accept that raced in while it was
  // in flight, and flip back online if one appeared.
  if (!isAvailable) {
    const { data: raced } = await supabase
      .from('bookings')
      .select('id')
      .eq('operator_id', bangkeroUid)
      .eq('trip_stat', 'accepted')
      .limit(1)
      .maybeSingle();
    if (raced) {
      await supabase
        .from('bangkeros')
        .update({ is_available: true, updated_at: new Date().toISOString() })
        .eq('id', bangkeroUid);
      throw new Error('You just accepted a trip — you are staying online.');
    }
  }
}

/** Seats the biggest online boat can take — the booking form's pax ceiling. */
export async function getMaxOnlineBangkaCapacity(): Promise<number | null> {
  const { data, error } = await supabase
    .from('bangkas')
    .select('capacity, bangkeros!inner(is_available)')
    .eq('bangkeros.is_available', true);
  if (error) throw error;
  const caps = (data ?? [])
    .map((row: { capacity: number | null }) => Number(row.capacity))
    .filter((n) => Number.isFinite(n) && n > 1);
  return caps.length ? Math.max(...caps) : null;
}
