import { supabase } from './supabase';
import type { ParcelDoc, ParcelStatus } from '../types/models';

function mapRow(row: any): ParcelDoc {
  return {
    parcelId: row.id,
    receiverName: row.receiver_name,
    receiverContact: row.receiver_contact,
    totalPrice: row.total_price,
    status: row.status,
    createdAt: row.created_at,
    userId: row.user_id,
    bookingId: row.booking_id,
  };
}

export async function createParcel(parcel: {
  receiverName: string;
  receiverContact?: string;
  totalPrice: number;
  userId: string;
  bookingId: string;
  items: Array<{ itemName: string; quantity: number; kilogram: number }>;
}): Promise<ParcelDoc> {
  const { data, error } = await supabase
    .from('parcels')
    .insert({
      receiver_name: parcel.receiverName,
      receiver_contact: parcel.receiverContact ?? null,
      total_price: parcel.totalPrice,
      user_id: parcel.userId,
      booking_id: parcel.bookingId,
    })
    .select()
    .single();

  if (error) throw error;

  if (parcel.items.length > 0) {
    const { error: itemsError } = await supabase
      .from('parcel_items')
      .insert(
        parcel.items.map((item) => ({
          item_name: item.itemName,
          quantity: item.quantity,
          kilogram: item.kilogram,
          parcel_id: data.id,
        }))
      );

    if (itemsError) throw itemsError;
  }

  return mapRow(data);
}

export async function getParcelByBooking(bookingId: string): Promise<ParcelDoc | null> {
  const { data, error } = await supabase
    .from('parcels')
    .select('*')
    .eq('booking_id', bookingId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data) : null;
}

export async function updateParcelStatus(
  parcelId: string,
  status: ParcelStatus
): Promise<void> {
  const { error } = await supabase
    .from('parcels')
    .update({ status })
    .eq('id', parcelId);

  if (error) throw error;
}

export async function getParcelsByUser(userId: string): Promise<ParcelDoc[]> {
  const { data, error } = await supabase
    .from('parcels')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []).map(mapRow);
}
