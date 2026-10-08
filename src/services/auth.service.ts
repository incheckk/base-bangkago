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
      ratingPenalty: 0,
      gcashQrUrl: null,
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
    if (bangkeroError) {
      // Never leave a half-made bangkero: the auth account and users row
      // already exist, and a bangkero role with no bangkeros/ row lands on
      // a broken home screen. Downgrade the own users row (users_update_own)
      // and say plainly what happened.
      await supabase
        .from('users')
        .update({ user_role: 'passenger' })
        .eq('id', uid);
      throw new Error(
        'Your account was created as a passenger because bangkero setup failed. Sign in and choose Passenger.'
      );
    }
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
  if (message.includes('timed out')) {
    return 'The request took too long. Check your connection and try again.';
  }
  if (message.includes('Network') || message.includes('fetch')) {
    return 'No connection to the server. Check your network and try again.';
  }
  // No-show ban: keep the sentence verbatim — it carries the minutes left.
  if (message.includes('marked as a no-show')) {
    return message;
  }
  if (message.includes('disabled') || message.includes('banned')) {
    return 'This account has been disabled.';
  }
  if (message.toLowerCase().includes('permission') || message.toLowerCase().includes('policy')) {
    return 'You do not have permission to do that.';
  }
  if (message.includes('already have a pending booking')) {
    return 'You already have a pending booking. Only one active booking at a time.';
  }
  if (message.includes('rating is too low')) {
    return 'Your rating is 3.0★ or below — you can no longer accept bookings until it improves.';
  }
  // Ratings unique index (013): a second submit from a lost race.
  if (message.includes('duplicate key') && message.includes('ratings')) {
    return 'You already rated this trip.';
  }
  if (message.includes('taken by another bangkero')) {
    return 'Another bangkero already took that trip.';
  }
  if (message.includes('confirm passengers on board')) {
    return 'Confirm everyone is on board before completing this trip.';
  }
  if (message.includes('already cancelled or has changed')) {
    return 'This booking was already cancelled or has changed.';
  }
  if (message.includes('staying online')) {
    return message;
  }
  if (message.includes('this trip changed')) {
    return 'This trip changed — pull to refresh.';
  }
  if (message.includes('not your wallet')) {
    return 'You can only top up your own wallet.';
  }
  if (message.includes('no booking with this bangkero')) {
    return 'You have no trip with that bangkero.';
  }
  // ---- Port-queue dispatch (008) — RPC sentences pass through ----
  if (message.includes('not queued at this port')) {
    return 'Park inside the port queue first — your boat is not listed at this port.';
  }
  if (message.includes('still entering the port queue')) {
    return 'Your boat is still entering the port queue — wait out the 5-minute dwell.';
  }
  if (message.includes('offered to another boat')) {
    return 'This request is being offered to another boat right now.';
  }
  if (message.includes('already passed on this request')) {
    return 'You already passed on this request.';
  }
  if (message.includes('accepted trips to another destination')) {
    return 'You have accepted trips to another destination — finish them before accepting this one.';
  }
  if (message.includes('not enough space on your boat')) {
    return 'Not enough space on your boat for this trip.';
  }
  if (message.includes('no recent GPS position')) {
    return 'Your boat has no recent GPS position — keep the app open at the port.';
  }
  if (message.includes('turn on availability')) {
    return 'You are offline — turn on availability to accept.';
  }
  // ---- Bangkero gates (010) — verification + boat + rating floor ----
  if (message.includes('documents are not approved')) {
    return 'Your documents are not approved yet — submit them for review in your profile.';
  }
  if (message.includes('register your boat')) {
    return 'Register your boat first — open Profile, tap Edit Profile and save your boat details.';
  }
  // ---- Island hopping (014) — package itinerary vs seeded routes ----
  if (message.includes('No route runs between those two ports')) {
    return 'That hopping route is not running right now — pick another package.';
  }
  if (message.includes('That route is not running right now')) {
    return 'That route is not running right now.';
  }
  if (message.includes('Pick two different ports')) {
    return 'Pick two different ports.';
  }
  // ---- Whole-day conflict (027) — one committed day per bangkero ----
  if (message.includes('already have a booking or charter scheduled')) {
    return 'You already have a trip or charter on that date — finish or cancel it first.';
  }
  if (message.includes('already booked for this boat')) {
    return 'That date is already booked for this boat — pick another day.';
  }
  if (message.includes('created as a passenger')) {
    return message;
  }
  if (message) return `Something went wrong (${message}).`;
  return 'Something went wrong. Please try again.';
}
