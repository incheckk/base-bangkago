import { supabase } from './supabase';
import type { PaymentDoc, PaymentMethod } from '../types/models';

function mapPaymentRow(row: any): PaymentDoc {
  return {
    paymentId: row.id,
    amount: row.amount,
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    referenceNum: row.reference_num,
    createdAt: row.created_at,
    bookingId: row.booking_id,
  };
}

/**
 * Recorded at booking time — ALWAYS 'pending' now, for cash and GCash
 * alike: the fare is collected on board, where the bangkero marks it
 * paid (mark_paid RPC, migration 012). A 'completed' here would have
 * claimed payment before anyone boarded.
 */
export async function createPayment(
  bookingId: string,
  amount: number,
  method: PaymentMethod
): Promise<PaymentDoc> {
  const { data, error } = await supabase
    .from('payments')
    .insert({
      booking_id: bookingId,
      amount,
      payment_method: method,
      payment_status: 'pending',
    })
    .select()
    .single();

  if (error) throw error;
  return mapPaymentRow(data);
}

export async function getPaymentByBooking(bookingId: string): Promise<PaymentDoc | null> {
  const { data, error } = await supabase
    .from('payments')
    .select('*')
    .eq('booking_id', bookingId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapPaymentRow(data) : null;
}

/**
 * Every payment for a set of bookings at once — the departure and
 * manifest payment checklists. RLS: readable as the trip's operator
 * (policy added in 012) or as the booking's passenger.
 */
export async function getPaymentsForBookings(bookingIds: string[]): Promise<PaymentDoc[]> {
  if (bookingIds.length === 0) return [];
  const { data, error } = await supabase
    .from('payments')
    .select('*')
    .in('booking_id', bookingIds);

  if (error) throw error;
  return (data ?? []).map(mapPaymentRow);
}

/**
 * Bangkero side of pay-on-board: flips the row to 'completed' with an
 * optional reference (GCash ref / receipt no). Enforced inside the
 * RPC — only the trip's operator may call it.
 */
export async function markBookingPaid(
  bookingId: string,
  reference?: string
): Promise<void> {
  const { error } = await supabase.rpc('mark_paid', {
    p_booking_id: bookingId,
    p_reference: reference ?? null,
  });
  if (error) throw error;
}
