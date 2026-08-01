import { doc, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore';

import { db } from './firebase';
import { friendlyAuthError } from './auth.service';

export const friendlyError = friendlyAuthError;

export const MAX_CAPACITY = 50;

interface NameArgs {
  uid: string;
  firstName: string;
  lastName: string;
  isBangkero: boolean;
}

/**
 * Renaming a bangkero has to touch two documents: users/ holds the private
 * record, operators/ holds the public displayName the passenger sees. A batch
 * keeps them from drifting apart if one write fails.
 *
 * Bookings already placed keep the name they were written with — a past trip
 * should read the way it did when it happened, not silently rewrite itself.
 */
export async function updateName({ uid, firstName, lastName, isBangkero }: NameArgs): Promise<void> {
  const first = firstName.trim();
  const last = lastName.trim();
  if (!first || !last) throw new Error('First and last name are required.');

  const batch = writeBatch(db);
  batch.update(doc(db, 'users', uid), { firstName: first, lastName: last });

  if (isBangkero) {
    batch.update(doc(db, 'operators', uid), {
      displayName: `${first} ${last}`.trim(),
      updatedAt: serverTimestamp(),
    });
  }

  await batch.commit();
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

  await updateDoc(doc(db, 'operators', uid), {
    boatName: name || null,
    capacity: parsed,
    updatedAt: serverTimestamp(),
  });
}
