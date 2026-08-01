import { FirebaseError } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
} from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc, type Timestamp } from 'firebase/firestore';

import { auth, db } from './firebase';
import type { OperatorDoc, UserDoc, UserRole } from '../types/models';
import { normalizePhone, phoneToAuthEmail } from '../utils/phone';

export interface SignUpParams {
  phone: string;
  password: string;
  firstName: string;
  lastName: string;
  role: UserRole;
}

/**
 * Creates the auth account and its users/ doc in that order — and, for bangkeros,
 * the public operators/ doc. Boat name and capacity stay null; they're set from
 * Profile so registration stays short.
 */
export async function signUp({
  phone, password, firstName, lastName, role,
}: SignUpParams): Promise<UserDoc> {
  const e164 = normalizePhone(phone);
  if (!e164) throw new Error('Enter a valid Philippine mobile number.');

  const cred = await createUserWithEmailAndPassword(auth, phoneToAuthEmail(e164), password);
  const uid = cred.user.uid;

  const userDoc: UserDoc = {
    uid,
    phone: e164,
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    role,
    // serverTimestamp() resolves on write; the stored value is a Timestamp.
    createdAt: serverTimestamp() as unknown as Timestamp,
  };
  await setDoc(doc(db, 'users', uid), userDoc);

  if (role === 'bangkero') {
    const operatorDoc: OperatorDoc = {
      uid,
      displayName: `${firstName.trim()} ${lastName.trim()}`.trim(),
      boatName: null,
      capacity: null,
      // Off by default — the operator turns themselves on, which is the toggle we demo.
      isAvailable: false,
      updatedAt: serverTimestamp() as unknown as Timestamp,
    };
    await setDoc(doc(db, 'operators', uid), operatorDoc);
  }

  return userDoc;
}

export async function signIn(phone: string, password: string): Promise<void> {
  const e164 = normalizePhone(phone);
  if (!e164) throw new Error('Enter a valid Philippine mobile number.');
  await signInWithEmailAndPassword(auth, phoneToAuthEmail(e164), password);
}

export async function signOut(): Promise<void> {
  await fbSignOut(auth);
}

export async function fetchUserDoc(uid: string): Promise<UserDoc | null> {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? (snap.data() as UserDoc) : null;
}

/**
 * Firebase speaks in email/credential terms; the user only ever typed a phone
 * number. Translate, or the demo shows "invalid email" for a wrong password.
 */
export function friendlyAuthError(e: unknown): string {
  if (e instanceof FirebaseError) {
    switch (e.code) {
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
      case 'auth/user-not-found':
        return 'That mobile number or password is incorrect.';
      case 'auth/email-already-in-use':
        return 'That mobile number is already registered. Try signing in.';
      case 'auth/weak-password':
        return 'Password must be at least 6 characters.';
      case 'auth/invalid-email':
        return 'Enter a valid Philippine mobile number.';
      case 'auth/too-many-requests':
        return 'Too many attempts. Wait a moment and try again.';
      case 'auth/network-request-failed':
        return 'No connection to the server. Check your network and try again.';
      case 'auth/user-disabled':
        return 'This account has been disabled.';
      case 'permission-denied':
        return 'You do not have permission to do that.';
      case 'unavailable':
        return 'Cannot reach the database. Check your network and try again.';
      default:
        return `Something went wrong (${e.code}).`;
    }
  }
  if (e instanceof Error && e.message) return e.message;
  return 'Something went wrong. Please try again.';
}
