import { friendlyAuthError } from './auth.service';
import { addressError } from '../utils/validation';
import { supabase } from './supabase';

export const friendlyError = friendlyAuthError;

export const MAX_CAPACITY = 50;

interface PersonalDetailsArgs {
  uid: string;
  age: number;
  address: string;
  sex: string;
}

const SEX_VALUES = ['male', 'female', 'other'];

/**
 * The main booker's manifest details (079, 101). Companions carry their own
 * details in passenger_details; without these the bangkero sees less than
 * the passenger manifest requires.
 * users_update_own (002) allows the write; 065 only guards is_suspended.
 */
export async function updatePersonalDetails({
  uid, age, address, sex,
}: PersonalDetailsArgs): Promise<void> {
  if (!Number.isInteger(age) || age < 1 || age > 120) {
    throw new Error('Enter an age between 1 and 120.');
  }
  const addrErr = addressError(address);
  if (addrErr) throw new Error(addrErr);
  if (!SEX_VALUES.includes(sex)) {
    throw new Error('Choose a gender.');
  }

  const patch = {
    age,
    address: address.trim(),
    sex,
  };

  const { error } = await supabase
    .from('users')
    .update(patch)
    .eq('id', uid);
  if (error) throw error;
}

/**
 * Gate before any new booking/charter: the operator's manifest needs the
 * booker's age, address and gender, so an incomplete profile cannot book.
 */
export async function requirePersonalDetails(uid: string): Promise<void> {
  const { data, error } = await supabase
    .from('users')
    .select('age, address, sex')
    .eq('id', uid)
    .maybeSingle();
  if (error) throw error;
  if (
    !data ||
    data.age == null ||
    !String(data.address ?? '').trim() ||
    !SEX_VALUES.includes(data.sex)
  ) {
    throw new Error('Add your age, home address, and gender in Profile before booking.');
  }
}

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

  // Upsert the boat. `.limit(1)` matters: duplicate bangkas rows used to
  // make maybeSingle() error, so every save fell into the insert branch
  // and created yet another boat.
  if (name || parsed) {
    const { data: existing } = await supabase
      .from('bangkas')
      .select('id')
      .eq('bangkero_id', uid)
      .is('deleted_at', null)
      .order('id')
      .limit(1)
      .maybeSingle();

    if (existing) {
      // UPDATE sends dirty fields only — the old `|| 'My Bangka' /
      // || 10` fallbacks clobbered the untouched column on every save.
      const patch: { bangka_name?: string; capacity?: number } = {};
      if (name) patch.bangka_name = name;
      if (parsed !== null) patch.capacity = parsed;
      if (Object.keys(patch).length === 0) return;
      const { error } = await supabase
        .from('bangkas')
        .update(patch)
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
