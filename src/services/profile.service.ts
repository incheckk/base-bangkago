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
 * Renaming a bangkero touches two tables: users holds the private record,
 * bangkeros holds the public display_name the passenger sees. This calls
 * a Postgres function (update_display_name) so both writes commit atomically.
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

/**
 * Updates bangkero display name and creates/updates their primary bangka.
 * For now we create a single bangka entry if one doesn't exist.
 */
export async function updateBoat({ uid, boatName, capacity }: BoatArgs): Promise<void> {
  const name = boatName.trim();

  let parsed: number | null = null;
  if (capacity.trim()) {
    parsed = Number(capacity.trim());
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_CAPACITY) {
      throw new Error(`Capacity must be a whole number between 1 and ${MAX_CAPACITY}.`);
    }
  }

  // Update bangkeros display name
  const { error: bangkeroError } = await supabase
    .from('bangkeros')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', uid);
  if (bangkeroError) throw bangkeroError;

  // Upsert bangka record (one per bangkero for now)
  if (name || parsed) {
    const { data: existing } = await supabase
      .from('bangkas')
      .select('id')
      .eq('bangkero_id', uid)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from('bangkas')
        .update({
          bangka_name: name || 'My Bangka',
          capacity: parsed || 10,
        })
        .eq('id', existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('bangkas')
        .insert({
          bangka_name: name || 'My Bangka',
          bangka_type: 'pump_boat',
          capacity: parsed || 10,
          bangkero_id: uid,
        });
      if (error) throw error;
    }
  }
}
