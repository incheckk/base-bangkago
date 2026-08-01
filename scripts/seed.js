#!/usr/bin/env node
/**
 * Seeds the BangkaGo demo database. Safe to re-run — every write is an
 * overwrite by deterministic id, and bookings are wiped before rebuilding.
 *
 *   npm run seed
 */

const {
  FieldValue, init, authEmail,
  DEMO_PASSWORD, PIERS, ACCOUNTS,
  buildRoutes, wipeBookings, writeSeedBookings,
} = require('./lib');

async function seedPiers(db) {
  const batch = db.batch();
  for (const p of PIERS) {
    batch.set(db.collection('piers').doc(p.pierId), { ...p, isActive: true });
  }
  await batch.commit();
  return PIERS.length;
}

async function seedRoutes(db) {
  const routes = buildRoutes();
  const batch = db.batch();
  for (const r of routes) batch.set(db.collection('routes').doc(r.routeId), r);
  await batch.commit();
  return routes.length;
}

/**
 * Creates the auth account if missing, resets the password if it exists.
 * Returns uid-keyed people so bookings can denormalize names.
 */
async function seedAccounts(auth, db) {
  const people = {};

  for (const acct of ACCOUNTS) {
    const email = authEmail(acct.phone);
    let user;

    try {
      user = await auth.getUserByEmail(email);
      await auth.updateUser(user.uid, { password: DEMO_PASSWORD });
    } catch (e) {
      if (e.code !== 'auth/user-not-found') throw e;
      user = await auth.createUser({ email, password: DEMO_PASSWORD });
    }

    await db.collection('users').doc(user.uid).set({
      uid: user.uid,
      phone: acct.phone,
      firstName: acct.firstName,
      lastName: acct.lastName,
      role: acct.role,
      createdAt: FieldValue.serverTimestamp(),
    });

    if (acct.role === 'bangkero') {
      await db.collection('operators').doc(user.uid).set({
        uid: user.uid,
        displayName: `${acct.firstName} ${acct.lastName}`,
        boatName: acct.boatName,
        capacity: acct.capacity,
        isAvailable: true, // both online, so one request lands on two operators
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    people[acct.phone] = { ...acct, uid: user.uid };
  }

  return people;
}

(async () => {
  const { db, auth } = init();

  console.log('\nSeeding BangkaGo demo data…\n');

  const piers = await seedPiers(db);
  console.log(`  piers      ${piers}`);

  const routes = await seedRoutes(db);
  console.log(`  routes     ${routes} (6 pairs, both directions)`);

  const people = await seedAccounts(auth, db);
  console.log(`  accounts   ${Object.keys(people).length} (password: ${DEMO_PASSWORD})`);

  const wiped = await wipeBookings(db);
  const written = await writeSeedBookings(db, people);
  console.log(`  bookings   ${written} historical (${wiped} removed first)`);

  console.log(`
Done. Sign in with any of:

  0917 123 4567   Juan Dela Cruz      passenger
  0918 123 4567   Mang Lito           bangkero · MBCA Sto. Niño · 8 pax
  0919 123 4567   Pedro V.            bangkero · MBCA Bantay Dagat · 10 pax

  password: ${DEMO_PASSWORD}

Both bangkeros start available, and no request is open — so the first booking
you make on stage is the only thing in their lists.
`);

  process.exit(0);
})().catch((e) => {
  console.error('\n✗ Seed failed:', e.message);
  if (e.code) console.error('  code:', e.code);
  process.exit(1);
});
