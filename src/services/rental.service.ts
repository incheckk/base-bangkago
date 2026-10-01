import { createNotification } from './notification.service';
import { supabase } from './supabase';
import type { BoatRentalDoc } from '../types/models';

// =============================================================
// Boat rentals (migration 016). A rental is a charter request against
// one verified operator's boat: pending → confirmed / cancelled,
// then completed when the day is done. Money stays out of `payments`
// entirely — 50% is filed as a downpayments escrow row (015, admin
// QR) and the remainder is collected IN PERSON at completion.
// =============================================================

function mapRentalRow(row: any): BoatRentalDoc {
  return {
    rentalId: row.id,
    eventName: row.event_name,
    rentalDate: row.rental_date,
    hours: Number(row.hours),
    totalPrice: Number(row.total_price),
    status: row.status,
    userId: row.user_id,
    bangkaId: row.bangka_id,
    paymentId: row.payment_id ?? null,
  };
}

// -------------------------------------------------------------
// Catalog — every verified bangkero's boat with its charter rate.
// -------------------------------------------------------------

export interface RentableBangka {
  bangkaId: string;
  bangkaName: string;
  bangkaType: string | null;
  bangkaPhoto: string | null;
  capacity: number;
  hourlyRate: number;
  bangkeroId: string;
  displayName: string;
}

export async function getRentableBangkas(): Promise<RentableBangka[]> {
  const { data, error } = await supabase
    .from('bangkas')
    .select('*, bangkeros!inner(id, display_name, verification_stat)')
    .eq('bangkeros.verification_stat', 'verified')
    .order('hourly_rate');

  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    bangkaId: row.id,
    bangkaName: row.bangka_name,
    bangkaType: row.bangka_type,
    bangkaPhoto: row.bangka_photo ?? null,
    capacity: Number(row.capacity),
    hourlyRate: Number(row.hourly_rate ?? 500),
    bangkeroId: row.bangkero_id,
    displayName: row.bangkeros?.display_name ?? 'Bangkero',
  }));
}

// -------------------------------------------------------------
// Create — rate is re-read server-side so a stale form never bills
// the wrong hourly price.
// -------------------------------------------------------------

export interface CreateRentalArgs {
  userId: string;
  bangkaId: string;
  eventName?: string;
  /** Manually picked YYYY-MM-DD — rides are same-day but rentals are not. */
  rentalDate: string;
  hours: number;
}

export async function createRental(args: CreateRentalArgs): Promise<BoatRentalDoc> {
  if (args.hours < 1) throw new Error('Pick at least one hour.');
  if (!args.rentalDate) throw new Error('Pick a rental date.');

  // Same boat, same day, still live. The passenger only sees their own
  // rows (RLS), so this catches double-submits early; the partial UNIQUE
  // index in 019 is what blocks a second renter racing in.
  const { data: clash, error: clashError } = await supabase
    .from('boat_rentals')
    .select('id')
    .eq('bangka_id', args.bangkaId)
    .eq('rental_date', args.rentalDate)
    .in('status', ['awaiting_payment', 'pending', 'confirmed'])
    .limit(1);
  if (clashError) throw clashError;
  if (clash?.length) {
    throw new Error('This boat is already booked on that date. Pick another day or another boat.');
  }

  const { data: bangka, error: bangkaError } = await supabase
    .from('bangkas')
    .select('hourly_rate')
    .eq('id', args.bangkaId)
    .single();
  if (bangkaError) throw bangkaError;

  const hourly = Number(bangka?.hourly_rate ?? 500);
  const total = Math.round(hourly * args.hours);

  const { data, error } = await supabase
    .from('boat_rentals')
    .insert({
      user_id: args.userId,
      bangka_id: args.bangkaId,
      event_name: args.eventName?.trim() || null,
      rental_date: args.rentalDate,
      hours: args.hours,
      total_price: total,
      // Rental dates start tomorrow (020), so every charter is advance:
      // escrow first, admin flips it to 'pending', then it hits the desk.
      status: 'awaiting_payment',
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new Error('This boat is already booked on that date. Pick another day or another boat.');
    }
    throw error;
  }
  return mapRentalRow(data);
}

// -------------------------------------------------------------
// Lists
// -------------------------------------------------------------

export interface PassengerRentalRow extends BoatRentalDoc {
  boatName: string | null;
  operatorName: string | null;
  operatorId: string | null;
}

/** The passenger's rentals, newest first, with boat + operator names. */
export async function getMyRentals(userId: string): Promise<PassengerRentalRow[]> {
  const { data, error } = await supabase
    .from('boat_rentals')
    .select('*, bangkas(bangka_name, bangkeros(id, display_name))')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    ...mapRentalRow(row),
    boatName: row.bangkas?.bangka_name ?? null,
    operatorName: row.bangkas?.bangkeros?.display_name ?? null,
    operatorId: row.bangkas?.bangkeros?.id ?? null,
  }));
}

export interface BangkeroRentalRow extends BoatRentalDoc {
  boatName: string | null;
  renterName: string | null;
}

/**
 * Incoming + historical requests for this bangkero's own boats.
 * RLS: boat_rentals_select_bangkero (016); the renter name comes from
 * users_select_rental_parties (016) — if that policy is missing the
 * name simply renders as "Passenger".
 */
export async function getRentalsForBangkero(bangkeroUid: string): Promise<BangkeroRentalRow[]> {
  const { data, error } = await supabase
    .from('boat_rentals')
    .select('*, bangkas!inner(bangka_name, bangkero_id), users(id, first_name, last_name)')
    .eq('bangkas.bangkero_id', bangkeroUid)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    ...mapRentalRow(row),
    boatName: row.bangkas?.bangka_name ?? null,
    renterName: row.users
      ? `${row.users.first_name ?? ''} ${row.users.last_name ?? ''}`.trim() || null
      : null,
  }));
}

// -------------------------------------------------------------
// Status flow + counterparty notifications
// -------------------------------------------------------------

export interface RentalNotifyContext {
  rentalId: string;
  /** Whom to notify — passenger on bangkero actions, bangkero on cancel. */
  notifyUserId: string | null;
  boatName: string;
  rentalDate: string;
  hours: number;
  eventName?: string | null;
}

const rentalWhat = (ctx: RentalNotifyContext) =>
  `${ctx.boatName}${ctx.eventName ? ` (${ctx.eventName})` : ''} on ${ctx.rentalDate}, ${ctx.hours}h`;

/** Bangkero accepts the request. */
export async function confirmRental(ctx: RentalNotifyContext): Promise<void> {
  const { error } = await supabase
    .from('boat_rentals')
    .update({ status: 'confirmed' })
    .eq('id', ctx.rentalId);
  if (error) throw error;

  if (ctx.notifyUserId) {
    await createNotification(
      ctx.notifyUserId,
      'Boat rental confirmed',
      `Your rental of ${rentalWhat(ctx)} is confirmed. Pay the 50% downpayment if you have not yet — the rest is collected in person.`
    ).catch(() => {});
  }
}

/** Bangkero turns the request down. */
export async function declineRental(ctx: RentalNotifyContext): Promise<void> {
  const { error } = await supabase
    .from('boat_rentals')
    .update({ status: 'cancelled' })
    .eq('id', ctx.rentalId);
  if (error) throw error;

  if (ctx.notifyUserId) {
    await createNotification(
      ctx.notifyUserId,
      'Boat rental declined',
      `The bangkero declined your rental of ${rentalWhat(ctx)}. If you already filed a downpayment, ask the admin for a refund.`
    ).catch(() => {});
  }
}

/** Bangkero marks the charter finished — remainder collected in person. */
export async function completeRental(ctx: RentalNotifyContext): Promise<void> {
  const { error } = await supabase
    .from('boat_rentals')
    .update({ status: 'completed' })
    .eq('id', ctx.rentalId);
  if (error) throw error;

  if (ctx.notifyUserId) {
    await createNotification(
      ctx.notifyUserId,
      'Boat rental completed',
      `Your rental of ${rentalWhat(ctx)} is done. Thanks for riding with us!`
    ).catch(() => {});
  }
}

/** Passenger withdraws a request they no longer need. */
export async function cancelRental(ctx: RentalNotifyContext): Promise<void> {
  const { error } = await supabase
    .from('boat_rentals')
    .update({ status: 'cancelled' })
    .eq('id', ctx.rentalId);
  if (error) throw error;

  if (ctx.notifyUserId) {
    await createNotification(
      ctx.notifyUserId,
      'Boat rental cancelled',
      `The passenger cancelled the rental of ${rentalWhat(ctx)}.`
    ).catch(() => {});
  }
}

// -------------------------------------------------------------
// Own boats (rate editing — bangkas_update_own, 002)
// -------------------------------------------------------------

export interface OwnBangka {
  bangkaId: string;
  bangkaName: string;
  hourlyRate: number;
}

export async function getOwnBangkas(bangkeroUid: string): Promise<OwnBangka[]> {
  const { data, error } = await supabase
    .from('bangkas')
    .select('id, bangka_name, hourly_rate')
    .eq('bangkero_id', bangkeroUid)
    .order('bangka_name');

  if (error) throw error;
  return (data ?? []).map((row) => ({
    bangkaId: row.id,
    bangkaName: row.bangka_name,
    hourlyRate: Number(row.hourly_rate ?? 500),
  }));
}

export async function setHourlyRate(bangkaId: string, hourlyRate: number): Promise<void> {
  if (!Number.isFinite(hourlyRate) || hourlyRate < 0) {
    throw new Error('Enter a valid hourly rate.');
  }
  const { error } = await supabase
    .from('bangkas')
    .update({ hourly_rate: hourlyRate })
    .eq('id', bangkaId);
  if (error) throw error;
}
