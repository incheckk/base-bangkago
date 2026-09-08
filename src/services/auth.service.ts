import type { AuthError } from '@supabase/supabase-js';

import type { BangkeroDoc, UserDoc, UserRole } from '../types/models';
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
 * Creates the auth account and its users/ row in that order — and, for
 * bangkeros, the public bangkeros/ row. Boat data is set later from Profile.
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
    firstName: firstName.trim(),
    middleName: null,
    lastName: lastName.trim(),
    email: phoneToAuthEmail(e164),
    phone: e164,
    role,
    profilePhoto: null,
    isVerified: false,
    createdAt: new Date().toISOString(),
  };

  const { error: profileError } = await supabase.from('users').insert({
    id: uid,
    first_name: userDoc.firstName,
    middle_name: null,
    last_name: userDoc.lastName,
    email: userDoc.email,
    phone_number: userDoc.phone,
    user_role: userDoc.role,
    profile_photo: null,
    is_verified: false,
  });
  if (profileError) throw profileError;

  if (role === 'bangkero') {
    const bangkeroDoc: BangkeroDoc = {
      uid,
      govIssuedId: null,
      boatRegistrationCert: null,
      coastalPermit: null,
      brgyClearance: null,
      verificationStat: 'pending',
      permitNumber: null,
      displayName: `${firstName.trim()} ${lastName.trim()}`.trim(),
      isAvailable: false,
      updatedAt: new Date().toISOString(),
    };

    const { error: bangkeroError } = await supabase.from('bangkeros').insert({
      id: uid,
      gov_issued_id: null,
      boat_registration_cert: null,
      coastal_permit: null,
      brgy_clearance: null,
      verification_stat: 'pending',
      permit_number: null,
      display_name: bangkeroDoc.displayName,
      is_available: false,
    });
    if (bangkeroError) throw bangkeroError;
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
    .from('users')
    .select('*')
    .eq('id', uid)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    uid: data.id,
    firstName: data.first_name,
    middleName: data.middle_name,
    lastName: data.last_name,
    email: data.email,
    phone: data.phone_number,
    role: data.user_role,
    profilePhoto: data.profile_photo,
    isVerified: data.is_verified,
    createdAt: data.created_at,
  };
}

/**
 * Supabase speaks in message strings, not error codes; screens need
 * sentences. Matched on message text since AuthError has no stable code enum.
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
