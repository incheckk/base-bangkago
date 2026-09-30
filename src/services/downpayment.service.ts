import { createNotification } from './notification.service';
import { supabase } from './supabase';
import type { DownpaymentDoc, DownpaymentStatus } from '../types/models';

// =============================================================
// GCash escrow downpayments (migration 015). The passenger pays 50%
// to the admin's QR outside the app, then files reference + screenshot
// here. The admin approves/refunds — bookkeeping only, nothing is
// gated on it. Deliberately a SEPARATE table from `payments` so the
// Phase 3 stack (maybeSingle lookups, mark_paid, the departure/sailing
// Record collapse) never sees a second row per booking.
// =============================================================

function mapRow(row: any): DownpaymentDoc {
  return {
    downpaymentId: row.id,
    amount: Number(row.amount),
    referenceNum: row.reference_num ?? '',
    proofUrl: row.proof_url ?? '',
    status: row.status,
    bookingId: row.booking_id,
    boatRentalId: row.boat_rental_id,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
  };
}

export interface CreateDownpaymentArgs {
  amount: number;
  referenceNum: string;
  /** Storage path in the `docs` bucket (upload BEFORE calling this). */
  proofUrl: string;
  bookingId?: string;
  boatRentalId?: string;
}

/**
 * Upload the GCash proof screenshot to the `docs` bucket under the
 * payer's own folder (storage policy in 011 keys on folder[1] = auth.uid).
 * Call BEFORE createDownpayment — only the path travels with the row.
 */
export async function uploadDownpaymentProof(localUri: string): Promise<string> {
  const { data: authData } = await supabase.auth.getUser();
  const uid = authData.user?.id;
  if (!uid) throw new Error('You must be signed in to upload proof.');

  const ext = /\.png(\?|$)/i.test(localUri) ? 'png' : 'jpg';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = `${uid}/downpayment-${stamp}.${ext}`;
  const resp = await fetch(localUri);
  const buf = await resp.arrayBuffer();
  const { error } = await supabase.storage
    .from('docs')
    .upload(path, buf, {
      contentType: ext === 'png' ? 'image/png' : 'image/jpeg',
      upsert: false,
    });
  if (error) throw error;
  return path;
}

export async function createDownpayment(args: CreateDownpaymentArgs): Promise<DownpaymentDoc> {
  if (!args.bookingId && !args.boatRentalId) {
    throw new Error('A downpayment needs a booking or a rental.');
  }

  const { data, error } = await supabase
    .from('downpayments')
    .insert({
      amount: args.amount,
      payment_method: 'gcash',
      reference_num: args.referenceNum.trim(),
      proof_url: args.proofUrl,
      booking_id: args.bookingId ?? null,
      boat_rental_id: args.boatRentalId ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return mapRow(data);
}

/** Newest escrow row for a booking — the passenger's booking screen. */
export async function getDownpaymentByBooking(bookingId: string): Promise<DownpaymentDoc | null> {
  const { data, error } = await supabase
    .from('downpayments')
    .select('*')
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data) : null;
}

/** Newest escrow row for a rental request — passenger and bangkero sides. */
export async function getDownpaymentByRental(boatRentalId: string): Promise<DownpaymentDoc | null> {
  const { data, error } = await supabase
    .from('downpayments')
    .select('*')
    .eq('boat_rental_id', boatRentalId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data) : null;
}

/**
 * Escrow rows for a set of bookings at once — the bangkero's sailing
 * payment card, so the crew sees what the admin already holds instead
 * of trying to collect it again. RLS: booking-operator policy (015).
 */
export async function getDownpaymentsForBookings(
  bookingIds: string[]
): Promise<DownpaymentDoc[]> {
  if (bookingIds.length === 0) return [];
  const { data, error } = await supabase
    .from('downpayments')
    .select('*')
    .in('booking_id', bookingIds);

  if (error) throw error;
  return (data ?? []).map(mapRow);
}

/** What the admin's review screen needs to render one escrow row. */
export interface AdminDownpaymentRow extends DownpaymentDoc {
  /** Booking ref, or the rental's event name. */
  label: string;
  /** One-line service summary (route or rental details). */
  serviceLabel: string;
  /** Whom to notify on approve/refund. */
  notifyUserId: string | null;
  /** passenger_name for bookings; resolved via users for rentals. */
  payerName: string | null;
}

function humanDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * All escrow rows, newest first, with enough joined context to review
 * without opening the booking. RLS: admin select policy (015).
 */
export async function listDownpayments(
  status?: DownpaymentStatus
): Promise<AdminDownpaymentRow[]> {
  let query = supabase
    .from('downpayments')
    .select(`
      *,
      booking:bookings(id, ref, passenger_name, user_id, from_port_name, to_port_name, service_type, num_of_passenger),
      rental:boat_rentals(id, event_name, rental_date, hours, total_price, user_id, status, bangka_id)
    `)
    .order('created_at', { ascending: false });

  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as any[];

  // Rentals don't carry a denormalized name — resolve renters in one query.
  const renterIds = [...new Set(
    rows.filter((r) => r.rental?.user_id).map((r) => r.rental.user_id as string)
  )];
  const nameById = new Map<string, string>();
  if (renterIds.length) {
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('id, first_name, last_name')
      .in('id', renterIds);
    if (usersError) throw usersError;
    for (const u of users ?? []) {
      nameById.set(u.id, `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim());
    }
  }

  return rows.map((row) => {
    const base = mapRow(row);
    const booking = row.booking ?? null;
    const rental = row.rental ?? null;

    const label = booking?.ref ?? rental?.event_name ?? 'Boat rental';
    const serviceLabel = booking
      ? `${booking.from_port_name ?? '—'} → ${booking.to_port_name ?? '—'}`
      : rental
        ? `${humanDate(rental.rental_date)} · ${rental.hours}h`
        : '—';

    return {
      ...base,
      label,
      serviceLabel,
      notifyUserId: booking?.user_id ?? rental?.user_id ?? null,
      payerName: booking?.passenger_name
        ?? (rental?.user_id ? nameById.get(rental.user_id) ?? null : null),
    };
  });
}

/**
 * Admin approves the escrow row and tells the payer. One update + one
 * notification — the notification is best-effort (the approval itself
 * must not roll back over a notification hiccup).
 */
export async function approveDownpayment(row: AdminDownpaymentRow): Promise<void> {
  const { error } = await supabase
    .from('downpayments')
    .update({ status: 'approved', reviewed_at: new Date().toISOString() })
    .eq('id', row.downpaymentId);
  if (error) throw error;

  if (row.notifyUserId) {
    await createNotification(
      row.notifyUserId,
      'Downpayment confirmed',
      `Your GCash downpayment of ₱${row.amount} for ${row.label} has been confirmed.`
    ).catch(() => {});
  }
}

/** Admin returns the escrow row as refunded (e.g. cancelled trip). */
export async function refundDownpayment(row: AdminDownpaymentRow): Promise<void> {
  const { error } = await supabase
    .from('downpayments')
    .update({ status: 'refunded', reviewed_at: new Date().toISOString() })
    .eq('id', row.downpaymentId);
  if (error) throw error;

  if (row.notifyUserId) {
    await createNotification(
      row.notifyUserId,
      'Downpayment refunded',
      `Your GCash downpayment of ₱${row.amount} for ${row.label} has been refunded.`
    ).catch(() => {});
  }
}
