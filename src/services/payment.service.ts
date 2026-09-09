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
      payment_status: method === 'cash' ? 'completed' : 'pending',
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

export async function updatePaymentStatus(
  paymentId: string,
  status: 'completed' | 'failed' | 'refunded'
): Promise<void> {
  const { error } = await supabase
    .from('payments')
    .update({ payment_status: status })
    .eq('id', paymentId);

  if (error) throw error;
}
