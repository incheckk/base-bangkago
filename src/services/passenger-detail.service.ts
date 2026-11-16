import { supabase } from './supabase';
import type { PassengerDetailDoc, PassengerType } from '../types/models';

function mapRow(row: any): PassengerDetailDoc {
  return {
    passengerId: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    age: row.age,
    sex: row.sex,
    contactNumber: row.contact_number,
    passengerType: row.passenger_type,
    declaredWeightKg: row.declared_weight_kg,
    bookingId: row.booking_id,
    boatRentalId: row.boat_rental_id,
    // ?? '' keeps this working before migration 020 adds the columns
    qrToken: row.qr_token ?? '',
    boardedAt: row.boarded_at ?? null,
    noShowAt: row.no_show_at ?? null,
    address: row.address ?? null,
  };
}

export async function createPassengerDetail(detail: {
  firstName: string;
  lastName: string;
  age?: number;
  sex?: string;
  contactNumber?: string;
  /** Manifest home address (028); optional at the type level for legacy callers. */
  address?: string;
  passengerType: PassengerType;
  declaredWeightKg?: number;
  /** Exactly one of bookingId / boatRentalId — the other stays null (026). */
  bookingId?: string;
  boatRentalId?: string;
}): Promise<PassengerDetailDoc> {
  const { data, error } = await supabase
    .from('passenger_details')
    .insert({
      first_name: detail.firstName,
      last_name: detail.lastName,
      age: detail.age ?? null,
      sex: detail.sex ?? null,
      contact_number: detail.contactNumber ?? null,
      address: detail.address ?? null,
      passenger_type: detail.passengerType,
      declared_weight_kg: detail.declaredWeightKg ?? null,
      booking_id: detail.bookingId ?? null,
      boat_rental_id: detail.boatRentalId ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return mapRow(data);
}

export async function getPassengerDetailsByBooking(
  bookingId: string
): Promise<PassengerDetailDoc[]> {
  const { data, error } = await supabase
    .from('passenger_details')
    .select('*')
    .eq('booking_id', bookingId);

  if (error) throw error;
  return (data ?? []).map(mapRow);
}

/** Companion list for a batch of charter rentals (one query). */
export async function getPassengerDetailsByRentals(
  rentalIds: string[]
): Promise<PassengerDetailDoc[]> {
  if (rentalIds.length === 0) return [];
  const { data, error } = await supabase
    .from('passenger_details')
    .select('*')
    .in('boat_rental_id', rentalIds);

  if (error) throw error;
  return (data ?? []).map(mapRow);
}

export type PassengerDetailUpdate = {
  firstName?: string;
  lastName?: string;
  age?: number | null;
  sex?: string | null;
  contactNumber?: string | null;
  address?: string | null;
  passengerType?: PassengerType;
  declaredWeightKg?: number | null;
};

export async function updatePassengerDetail(
  id: string,
  detail: PassengerDetailUpdate
): Promise<void> {
  // Only write what the caller owns. The edit sheet dropped weight and
  // passenger type, so sending them as null would have wiped real values.
  const patch: Record<string, unknown> = {};
  if (detail.firstName !== undefined) patch.first_name = detail.firstName;
  if (detail.lastName !== undefined) patch.last_name = detail.lastName;
  if (detail.age !== undefined) patch.age = detail.age;
  if (detail.sex !== undefined) patch.sex = detail.sex;
  if (detail.contactNumber !== undefined) patch.contact_number = detail.contactNumber;
  if (detail.address !== undefined) patch.address = detail.address;
  if (detail.passengerType !== undefined) patch.passenger_type = detail.passengerType;
  if (detail.declaredWeightKg !== undefined) patch.declared_weight_kg = detail.declaredWeightKg;
  if (Object.keys(patch).length === 0) return;

  const { error } = await supabase
    .from('passenger_details')
    .update(patch)
    .eq('id', id);

  if (error) throw error;
}

/**
 * Removing a companion is an atomic RPC: the row, the booking pax count,
 * and the fare move together, and boarded/paid lists are refused. Raw DELETE
 * has no policy on purpose.
 */
export async function deletePassengerDetail(id: string): Promise<void> {
  const { error } = await supabase.rpc('remove_passenger_detail', {
    p_passenger_id: id,
  });

  if (error) throw error;
}

/**
 * Charter boarding tick (081). passenger_details has no UPDATE policy, so
 * this goes through the owner-checked RPC.
 */
export async function setRentalRiderBoarded(
  rentalId: string,
  passengerId: string,
  boarded: boolean
): Promise<void> {
  const { error } = await supabase.rpc('set_rental_rider_boarded', {
    p_rental_id: rentalId,
    p_passenger_id: passengerId,
    p_boarded: boarded,
  });
  if (error) throw error;
}
