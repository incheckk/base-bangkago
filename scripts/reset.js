#!/usr/bin/env node
/**
 * Resets demo state between runs. Leaves piers, routes, and accounts intact.
 *
 *   npm run reset
 *
 * Note: this restores the four historical bookings rather than leaving the
 * collection empty. CLAUDE.md asks for a wipe, but it also requires "Recent
 * trips" to never be empty — a bare wipe would break the passenger home on the
 * second run-through. Pass --empty if you really want zero bookings.
 */

const {
  FieldValue, init, authEmail, ACCOUNTS, wipeBookings, writeSeedBookings,
} = require('./lib');

const EMPTY = process.argv.includes('--empty');

/** Resolves existing accounts to uids. Does not create anything. */
async function resolvePeople(auth) {
  const people = {};
  for (const acct of ACCOUNTS) {
    try {
      const user = await auth.getUserByEmail(authEmail(acct.phone));
      people[acct.phone] = { ...acct, uid: user.uid };
    } catch (e) {
      if (e.code === 'auth/user-not-found') {
        throw new Error(`Account ${acct.phone} does not exist. Run "npm run seed" first.`);
      }
      throw e;
    }
  }
  return people;
}

async function reopenOperators(db) {
  const snap = await db.collection('operators').get();
  if (snap.empty) return 0;

  const batch = db.batch();
  for (const doc of snap.docs) {
    batch.update(doc.ref, {
      isAvailable: true,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  return snap.size;
}

(async () => {
  const { db, auth } = init();

  console.log('\nResetting demo state…\n');

  const wiped = await wipeBookings(db);
  console.log(`  bookings removed   ${wiped}`);

  if (EMPTY) {
    console.log('  bookings restored  0 (--empty)');
  } else {
    const people = await resolvePeople(auth);
    const written = await writeSeedBookings(db, people);
    console.log(`  bookings restored  ${written} historical`);
  }

  const operators = await reopenOperators(db);
  console.log(`  operators online   ${operators}`);

  console.log('\nPiers, routes, and accounts untouched. Ready for another run.\n');
  process.exit(0);
})().catch((e) => {
  console.error('\n✗ Reset failed:', e.message);
  if (e.code) console.error('  code:', e.code);
  process.exit(1);
});
