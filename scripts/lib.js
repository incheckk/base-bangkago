/**
 * Shared setup + demo data for the seed and reset scripts.
 *
 * These run in Node with the Firebase Admin SDK — never in the app bundle.
 * Plain CommonJS on purpose: no build step to fail the night before a panel.
 * Admin SDK bypasses security rules, which is why piers/routes can be
 * client-read-only and still get written here.
 */

const fs = require('fs');
const path = require('path');
// firebase-admin v13+ dropped the old `admin.credential.cert` / `admin.firestore()`
// namespaces. Everything is modular now.
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

const AUTH_EMAIL_DOMAIN = 'bangkago.app'; // must match src/utils/phone.ts
const DEMO_PASSWORD = 'demo1234';

const KEY_PATH =
  process.env.BANGKAGO_SERVICE_ACCOUNT ||
  path.join(__dirname, '..', 'serviceAccountKey.json');

function init() {
  if (!fs.existsSync(KEY_PATH)) {
    console.error(`
✗ Service account key not found.

  Looked in: ${KEY_PATH}

  Firebase Console → Project settings → Service accounts
    → "Generate new private key" → save as serviceAccountKey.json in the
      project root (already gitignored).

  Or point at it explicitly:
    BANGKAGO_SERVICE_ACCOUNT=/path/to/key.json npm run seed
`);
    process.exit(1);
  }

  initializeApp({ credential: cert(require(KEY_PATH)) });
  return { db: getFirestore(), auth: getAuth() };
}

/** +639171234567 -> 639171234567@bangkago.app (mirrors phoneToAuthEmail) */
const authEmail = (e164) => `${e164.slice(1)}@${AUTH_EMAIL_DOMAIN}`;

// ---------------------------------------------------------------- piers

// mapX/mapY are 0–1, normalized to the SeaMap SVG viewBox: x runs west→east,
// y runs north→south. Mactan on the left, the island ports out to the east.
const PIERS = [
  { pierId: 'mactan-pier-1', name: 'Mactan Pier 1', island: 'Mactan',   mapX: 0.14, mapY: 0.22, sortOrder: 1 },
  { pierId: 'mactan-pier-2', name: 'Mactan Pier 2', island: 'Mactan',   mapX: 0.20, mapY: 0.48, sortOrder: 2 },
  { pierId: 'olango-port',   name: 'Olango Island Port', island: 'Olango',   mapX: 0.55, mapY: 0.35, sortOrder: 3 },
  { pierId: 'caohagan',      name: 'Caohagan Island',    island: 'Caohagan', mapX: 0.66, mapY: 0.70, sortOrder: 4 },
  { pierId: 'nalusuan',      name: 'Nalusuan Island',    island: 'Nalusuan', mapX: 0.80, mapY: 0.58, sortOrder: 5 },
];

const PIER_LABELS = {
  'mactan-pier-1': 'Mactan Pier 1 (Punta Engaño)',
  'mactan-pier-2': 'Mactan Pier 2 (Maribago)',
  'olango-port': 'Olango Island Port (Sta. Rosa)',
  caohagan: 'Caohagan Island',
  nalusuan: 'Nalusuan Island',
};

// ---------------------------------------------------------------- routes

// Six pier pairs, both directions = 12 routes. The two Mactan piers are the
// mainland departure points; there is no Mactan→Mactan boat trip.
const ROUTE_PAIRS = [
  { a: 'mactan-pier-2', b: 'olango-port', fare: 150, estimatedMinutes: 15 },
  { a: 'mactan-pier-1', b: 'olango-port', fare: 180, estimatedMinutes: 20 },
  { a: 'mactan-pier-2', b: 'caohagan',    fare: 280, estimatedMinutes: 35 },
  { a: 'mactan-pier-1', b: 'caohagan',    fare: 320, estimatedMinutes: 40 },
  { a: 'mactan-pier-2', b: 'nalusuan',    fare: 360, estimatedMinutes: 45 },
  { a: 'mactan-pier-1', b: 'nalusuan',    fare: 400, estimatedMinutes: 55 },
];

function buildRoutes() {
  const routes = [];
  for (const { a, b, fare, estimatedMinutes } of ROUTE_PAIRS) {
    for (const [from, to] of [[a, b], [b, a]]) {
      routes.push({
        routeId: `${from}__${to}`,
        fromPierId: from,
        toPierId: to,
        fare,
        estimatedMinutes,
        isActive: true,
      });
    }
  }
  return routes;
}

// ---------------------------------------------------------------- accounts

const ACCOUNTS = [
  {
    phone: '+639171234567',
    role: 'passenger',
    firstName: 'Juan',
    lastName: 'Dela Cruz',
  },
  {
    phone: '+639181234567',
    role: 'bangkero',
    firstName: 'Mang',
    lastName: 'Lito',
    boatName: 'MBCA Sto. Niño',
    capacity: 8,
  },
  {
    phone: '+639191234567',
    role: 'bangkero',
    firstName: 'Pedro',
    lastName: 'V.',
    boatName: 'MBCA Bantay Dagat',
    capacity: 10,
  },
];

// ---------------------------------------------------------------- bookings

/**
 * Historical bookings so "Recent trips" is never empty on first open —
 * a blank list reads as broken.
 *
 * Deliberately no `open` or `accepted` rows: those are what the live demo
 * creates. Starting with an empty bangkero request list is correct, and it
 * means the request that lands on stage is unmistakably the one just made.
 */
const SEED_BOOKINGS = [
  { daysAgo: 12, from: 'mactan-pier-2', to: 'olango-port', passengerCount: 2, status: 'completed', operator: '+639181234567' },
  { daysAgo: 8,  from: 'mactan-pier-1', to: 'caohagan',    passengerCount: 4, status: 'cancelled' },
  { daysAgo: 5,  from: 'mactan-pier-1', to: 'nalusuan',    passengerCount: 1, status: 'cancelled' },
  { daysAgo: 2,  from: 'mactan-pier-2', to: 'nalusuan',    passengerCount: 3, status: 'completed', operator: '+639191234567' },
];

/** Booking ref = BGO- + 6 chars of the doc id, same rule the app uses. */
const refFromId = (id) => `BGO-${id.slice(0, 6).toUpperCase()}`;

/** Deletes every booking, in batches. Firestore caps a batch at 500 writes. */
async function wipeBookings(db) {
  const snap = await db.collection('bookings').get();
  if (snap.empty) return 0;

  let removed = 0;
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = db.batch();
    for (const doc of snap.docs.slice(i, i + 400)) batch.delete(doc.ref);
    await batch.commit();
    removed += Math.min(400, snap.docs.length - i);
  }
  return removed;
}

/** Re-creates the historical bookings. Needs uid + name lookups from seeding. */
async function writeSeedBookings(db, people) {
  const passenger = people['+639171234567'];
  const routes = Object.fromEntries(buildRoutes().map((r) => [r.routeId, r]));
  const pierName = Object.fromEntries(PIERS.map((p) => [p.pierId, p.name]));

  for (const b of SEED_BOOKINGS) {
    const route = routes[`${b.from}__${b.to}`];
    const created = new Date(Date.now() - b.daysAgo * 86400000);
    const ref = db.collection('bookings').doc();
    const op = b.operator ? people[b.operator] : null;

    await ref.set({
      bookingId: ref.id,
      ref: refFromId(ref.id),
      passengerId: passenger.uid,
      passengerName: `${passenger.firstName} ${passenger.lastName}`,
      passengerPhone: passenger.phone,
      fromPierId: b.from,
      fromPierName: pierName[b.from],
      toPierId: b.to,
      toPierName: pierName[b.to],
      passengerCount: b.passengerCount,
      fare: route.fare,
      estimatedMinutes: route.estimatedMinutes,
      paymentMethod: 'cash',
      status: b.status,
      operatorId: op ? op.uid : null,
      operatorName: op ? `${op.firstName} ${op.lastName}` : null,
      operatorBoatName: op ? op.boatName : null,
      rejectedBy: [],
      createdAt: Timestamp.fromDate(created),
      acceptedAt: op ? Timestamp.fromDate(new Date(created.getTime() + 6 * 60000)) : null,
      completedAt:
        b.status === 'completed'
          ? Timestamp.fromDate(new Date(created.getTime() + route.estimatedMinutes * 60000))
          : null,
      cancelledAt:
        b.status === 'cancelled'
          ? Timestamp.fromDate(new Date(created.getTime() + 3 * 60000))
          : null,
    });
  }
  return SEED_BOOKINGS.length;
}

module.exports = {
  FieldValue, Timestamp, init, authEmail,
  DEMO_PASSWORD, PIERS, PIER_LABELS, ACCOUNTS, SEED_BOOKINGS,
  buildRoutes, wipeBookings, writeSeedBookings,
};
