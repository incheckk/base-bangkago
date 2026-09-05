import type { AuthError } from '@supabase/supabase-js';

import type { OperatorDoc, UserDoc, UserRole } from '../types/models';
import { normalizePhone, phoneToAuthEmail } from '../utils/phone';
import { supabase } from './supabase';

export interface SignUpParams {
  phone: string;
  password: string;
  firstName: string;
  lastName: string;
  role: UserRole;
}

/**
 * Creates the auth account and its profiles/ row in that order — and, for
 * bangkeros, the public operators/ row. Boat name and capacity stay null;
 * they're set from Profile so registration stays short. Same shape as the
 * Firebase version, just against Supabase tables instead of Firestore docs.
 *
 * NOTE: these inserts will fail with a permission/RLS error until Stage 5
 * adds policies to profiles/operators. That's expected right now, not a bug.
 */
export async function signUp({
  phone, password, firstName, lastName, role,
}: SignUpParams): Promise<UserDoc> {
  const e164 = normalizePhone(phone);
  if (!e164) throw new Error('Enter a valid Philippine mobile number.');

  const { data, error } = await supabase.auth.signUp({
    email: phoneToAuthEmail(e164),
    password,
  });
  if (error) throw error;
  if (!data.user) throw new Error('Sign up did not return a user. Please try again.');

  const uid = data.user.id;

  const userDoc: UserDoc = {
    uid,
    phone: e164,
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    role,
    createdAt: new Date().toISOString(),
  };

  const { error: profileError } = await supabase.from('profiles').insert({
    id: uid,
    phone: userDoc.phone,
    first_name: userDoc.firstName,
    last_name: userDoc.lastName,
    role: userDoc.role,
  });
  if (profileError) throw profileError;

  if (role === 'bangkero') {
    const operatorDoc: OperatorDoc = {
      uid,
      displayName: `${firstName.trim()} ${lastName.trim()}`.trim(),
      boatName: null,
      capacity: null,
      isAvailable: false, // off by default — the operator turns themselves on
      updatedAt: new Date().toISOString(),
    };

    const { error: operatorError } = await supabase.from('operators').insert({
      id: uid,
      display_name: operatorDoc.displayName,
      boat_name: operatorDoc.boatName,
      capacity: operatorDoc.capacity,
      is_available: operatorDoc.isAvailable,
    });
    if (operatorError) throw operatorError;
  }

  return userDoc;
}

export async function signIn(phone: string, password: string): Promise<void> {
  const e164 = normalizePhone(phone);
  if (!e164) throw new Error('Enter a valid Philippine mobile number.');

  const { error } = await supabase.auth.signInWithPassword({
    email: phoneToAuthEmail(e164),
    password,
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function fetchUserDoc(uid: string): Promise<UserDoc | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, phone, first_name, last_name, role, created_at')
    .eq('id', uid)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    uid: data.id,
    phone: data.phone,
    firstName: data.first_name,
    lastName: data.last_name,
    role: data.role,
    createdAt: data.created_at,
  };
}

/**
 * Supabase speaks in message strings, not error codes; screens need
 * sentences. Same job as the Firebase version — matched on message text
 * since AuthError has no stable code enum the way FirebaseError.code did.
 */
export function friendlyAuthError(e: unknown): string {
  const err = e as AuthError | Error | undefined;
  const message = err?.message ?? '';

  if (message.includes('Invalid login credentials')) {
    return 'That mobile number or password is incorrect.';
  }
  if (message.includes('User already registered')) {
    return 'That mobile number is already registered. Try signing in.';
  }
  if (message.includes('Password should be at least')) {
    return 'Password must be at least 6 characters.';
  }
  if (message.includes('Unable to validate email') || message.includes('invalid format')) {
    return 'Enter a valid Philippine mobile number.';
  }
  if (message.includes('Email not confirmed')) {
    return 'This account needs confirmation. Contact support.';
  }
  if (message.toLowerCase().includes('rate limit') || message.includes('Too many requests')) {
    return 'Too many attempts. Wait a moment and try again.';
  }
  if (message.includes('Network') || message.includes('fetch')) {
    return 'No connection to the server. Check your network and try again.';
  }
  if (message.includes('disabled') || message.includes('banned')) {
    return 'This account has been disabled.';
  }
  if (message.toLowerCase().includes('permission') || message.toLowerCase().includes('policy')) {
    return 'You do not have permission to do that.';
  }
  if (message) return `Something went wrong (${message}).`;
  return 'Something went wrong. Please try again.';
}