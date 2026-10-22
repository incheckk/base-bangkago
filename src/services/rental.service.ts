import type { BoatRentalDoc } from '../types/models';
import { createNotification } from './notification.service';
import { supabase } from './supabase';

// =============================================================
// Boat rentals (migration 016). A rental is a charter request against
// one verified operator's boat: pending → confirmed / cancelled,
// then completed when the day is done. Money stays out of `payments`
// entirely — 50% is filed as a downpayments escrow row (015, admin
// QR) and the remainder is collected IN PERSON at completion.
//
// Pricing (068): one flat whole-day price per boat, not hourly.
// =============================================================

/** A charter is sold as one whole day. `boat_rentals.hours` is NOT NULL,
 *  so the flat price still records the day it covers. */
export const CHARTER_HOURS = 8;

/** Demo capacity tiers, used until the bangkero saves a price:
 *  under 15 pax ₱3,500, 15+ ₱7,000. */
export function tierStandardPrice(capacity: number): number {
  return capacity >= 15 ? 7000 : 3500;
}

/** Old hourly rows keep their hours; a full charter day reads "Whole day". */
export function rentalDurationLabel(hours: number): string {
  return hours >= CHARTER_HOURS ? 'Whole day' : `${hours}h`;
}

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
// Catalog — every verified bangkero's boat with its whole-day price.
// -------------------------------------------------------------

export interface RentableBangka {
  bangkaId: string;
  bangkaName: string;
  bangkaType: string | null;
  bangkaPhoto: string | null;
  capacity: number;
  standardPrice: number;
  bangkeroId: string;
  displayName: string;
}

export async function getRentableBangkas(): Promise<RentableBangka[]> {
  const { data, error } = await supabase
    .from('bangkas')
    // `*` so a DB without 068 still reads (standard_price is then absent
    // and every boat falls back to its capacity tier).
    .select('*, bangkeros!inner(id, display_name, verification_stat, is_deleted)')
    .eq('bangkeros.verification_stat', 'verified')
    .eq('bangkeros.is_deleted', false)
    // Opt-in catalog: the bangkero lists the boat from their
    // Boat Rentals screen (rental_listed, 027).
    .eq('rental_listed', true)
    .eq('is_active', true)
    .order('capacity');

  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    bangkaId: row.id,
    bangkaName: row.bangka_name,
    bangkaType: row.bangka_type,
    bangkaPhoto: row.bangka_photo ?? null,
    capacity: Number(row.capacity),
    standardPrice: Number(row.standard_price ?? tierStandardPrice(Number(row.capacity))),
    bangkeroId: row.bangkero_id,
    displayName: row.bangkeros?.display_name ?? 'Bangkero',
  }));
}

// -------------------------------------------------------------
// Create — the flat price is re-read server-side so a stale form
// never bills the wrong charter price.
// -------------------------------------------------------------

export interface CreateRentalArgs {
  userId: string;
  bangkaId: string;
  eventName?: string;
  /** Manually picked YYYY-MM-DD — rides are same-day but rentals are not. */
  rentalDate: string;
}

export async function createRental(args: CreateRentalArgs): Promise<BoatRentalDoc> {
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
    .select('*')
    .eq('id', args.bangkaId)
    .single();
  if (bangkaError) throw bangkaError;
  if (!bangka?.is_active) throw new Error('This boat is unavailable. Choose another boat.');

  const total = Number(
    bangka.standard_price ?? tierStandardPrice(Number(bangka.capacity))
  );

  const { data, error } = await supabase
    .from('boat_rentals')
    .insert({
      user_id: args.userId,
      bangka_id: args.bangkaId,
      event_name: args.eventName?.trim() || null,
      rental_date: args.rentalDate,
      hours: CHARTER_HOURS,
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

export interface AdminRentalRow extends BoatRentalDoc {
  boatName: string | null;
  operatorName: string | null;
  renterName: string | null;
}

/** Every rental, newest first — admin view (boat_rentals_select_admin, 016). */
export async function listAllRentals(): Promise<AdminRentalRow[]> {
  const { data, error } = await supabase
    .from('boat_rentals')
    .select('*, bangkas(bangka_name, bangkeros(display_name)), users(first_name, last_name)')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    ...mapRentalRow(row),
    boatName: row.bangkas?.bangka_name ?? null,
    operatorName: row.bangkas?.bangkeros?.display_name ?? null,
    renterName: row.users
      ? `${row.users.first_name ?? ''} ${row.users.last_name ?? ''}`.trim() || null
      : null,
  }));
}

export interface RentalNotifyContext {
  rentalId: string;
  /** Whom to notify — passenger on bangkero actions, bangkero on cancel. */
  notifyUserId: string | null;
  boatName: string;
  rentalDate: string;
  eventName?: string | null;
}

const rentalWhat = (ctx: RentalNotifyContext) =>
  `${ctx.boatName}${ctx.eventName ? ` (${ctx.eventName})` : ''} on ${ctx.rentalDate} (whole day)`;

/**
 * Guarded status transition: the UPDATE only lands when the row is still
 * in an expected state (plus `.eq('id')`, with RLS scoping to the caller's
 * own boats for ownership). A 0-row write means the row raced (status
 * moved, row gone, or another owner's boat, which RLS hides) — refetch
 * and report what happened instead of failing silently or clobbering.
 */
async function transitionRental(
  rentalId: string,
  expectedFrom: string[],
  to: string
): Promise<void> {
  const { data, error } = await supabase
    .from('boat_rentals')
    .update({ status: to })
    .eq('id', rentalId)
    .in('status', expectedFrom)
    .select('id');
  if (error) throw error;
  if ((data ?? []).length > 0) return;

  const { data: row } = await supabase
    .from('boat_rentals')
    .select('status')
    .eq('id', rentalId)
    .maybeSingle();
  if (!row) {
    throw new Error('That rental was already handled or is unavailable — the list was refreshed.');
  }
  throw new Error(`That rental is already ${row.status} — the list was refreshed.`);
}

/** Bangkero accepts the request (escrow-approved `pending` only). */
export async function confirmRental(ctx: RentalNotifyContext): Promise<void> {
  await transitionRental(ctx.rentalId, ['pending'], 'confirmed');

  if (ctx.notifyUserId) {
    await createNotification(
      ctx.notifyUserId,
      'Boat rental confirmed',
      `Your rental of ${rentalWhat(ctx)} is confirmed. Pay the 50% downpayment if you have not yet — the rest is collected in person.`
    ).catch(() => {});
  }
}

/** Bangkero turns the request down (before or after escrow approval). */
export async function declineRental(ctx: RentalNotifyContext): Promise<void> {
  await transitionRental(ctx.rentalId, ['pending', 'awaiting_payment'], 'cancelled');

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
  await transitionRental(ctx.rentalId, ['confirmed'], 'completed');

  if (ctx.notifyUserId) {
    await createNotification(
      ctx.notifyUserId,
      'Boat rental completed',
      `Your rental of ${rentalWhat(ctx)} is done. Thanks for riding with us!`
    ).catch(() => {});
  }
}

/** Passenger withdraws a request they no longer need (any live state). */
export async function cancelRental(ctx: RentalNotifyContext): Promise<void> {
  await transitionRental(
    ctx.rentalId,
    ['awaiting_payment', 'pending', 'confirmed'],
    'cancelled'
  );

  if (ctx.notifyUserId) {
    await createNotification(
      ctx.notifyUserId,
      'Boat rental cancelled',
      `The passenger cancelled the rental of ${rentalWhat(ctx)}.`
    ).catch(() => {});
  }
}

// -------------------------------------------------------------
// Own boats (price editing — bangkas_update_own, 002)
// -------------------------------------------------------------

export interface OwnBangka {
  bangkaId: string;
  bangkaName: string;
  capacity: number;
  standardPrice: number;
  rentalListed: boolean;
}

export async function getOwnBangkas(bangkeroUid: string): Promise<OwnBangka[]> {
  const { data, error } = await supabase
    .from('bangkas')
    // `*` keeps this working before 068 (standard_price reads absent).
    .select('*')
    .eq('bangkero_id', bangkeroUid)
    .order('bangka_name');

  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    bangkaId: row.id,
    bangkaName: row.bangka_name,
    capacity: Number(row.capacity),
    standardPrice: Number(row.standard_price ?? tierStandardPrice(Number(row.capacity))),
    rentalListed: !!row.rental_listed,
  }));
}

export async function setStandardPrice(bangkaId: string, standardPrice: number): Promise<void> {
  // Blank inputs arrive as Number('') === 0 — reject those alongside
  // negatives, NaN and infinities before anything reaches the DB.
  if (!Number.isFinite(standardPrice) || standardPrice <= 0) {
    throw new Error('Enter a standard price above ₱0.');
  }
  const { error } = await supabase
    .from('bangkas')
    .update({ standard_price: standardPrice })
    .eq('id', bangkaId);
  if (error) throw error;
}

/** Show/hide the boat in the passenger rental catalog (027). */
export async function setRentalListed(bangkaId: string, listed: boolean): Promise<void> {
  const { error } = await supabase
    .from('bangkas')
    .update({ rental_listed: listed })
    .eq('id', bangkaId);
  if (error) throw error;
}

/**
 * Dates this boat cannot be chartered: its own live rentals plus days
 * the operator already committed to (accepted trips). SECURITY DEFINER
 * RPC (027) — RLS would hide other renters' rows from the browser.
 */
export async function getBangkaBlockedDates(bangkaId: string): Promise<string[]> {
  const { data, error } = await supabase.rpc('bangka_blocked_dates', {
    p_bangka_id: bangkaId,
  });
  if (error) throw error;
  return (data ?? []).map((row: { blocked_date: string }) => row.blocked_date);
}
