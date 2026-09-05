import { friendlyAuthError } from './auth.service';
import { supabase } from './supabase';

export const friendlyError = friendlyAuthError;

export const MAX_CAPACITY = 50;

interface NameArgs {
  uid: string;
  firstName: string;
  lastName: string;
  isBangkero: boolean;
}

/**
 * Renaming a bangkero has to touch two tables: profiles holds the private
 * record, operators holds the public display_name the passenger sees. This
 * calls a Postgres function (update_display_name) so both writes commit in
 * one transaction — the same guarantee writeBatch gave in Firestore, since
 * a single Postgres function call is atomic by default.
 *
 * Bookings already placed keep the name they were written with — a past
 * trip should read the way it did when it happened, not silently rewrite.
 */
export async function updateName({ uid, firstName, lastName, isBangkero }: NameArgs): Promise<void> {
  const first = firstName.trim();
  const last = lastName.trim();
  if (!first || !last) throw new Error('First and last name are required.');

  const { error } = await supabase.rpc('update_display_name', {
    p_uid: uid,
    p_first_name: first,
    p_last_name: last,
    p_is_bangkero: isBangkero,
  });
  if (error) throw error;
}

interface BoatArgs {
  uid: string;
  boatName: string;
  capacity: string;
}

/** Capacity is display-only in this build, but it still has to be a real number. */
export async function updateBoat({ uid, boatName, capacity }: BoatArgs): Promise<void> {
  const name = boatName.trim();

  let parsed: number | null = null;
  if (capacity.trim()) {
    parsed = Number(capacity.trim());
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_CAPACITY) {
      throw new Error(`Capacity must be a whole number between 1 and ${MAX_CAPACITY}.`);
    }
  }

  const { error } = await supabase
    .from('operators')
    .update({
      boat_name: name || null,
      capacity: parsed,
      updated_at: new Date().toISOString(),
    })
    .eq('id', uid);
  if (error) throw error;
}