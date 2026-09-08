/**
 * Shared setup + demo data for the seed and reset scripts.
 *
 * These run in Node with the Supabase JS client using the service-role key,
 * which bypasses Row-Level Security. Never import this in the app bundle.
 *
 * Table names follow the ERD: users, bangkeros, bangkas, ports, routes, bookings.
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load .env from project root
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

// Gmail plus-addressing so Supabase accepts it
const AUTH_EMAIL_DOMAIN = 'gmail.com';
const AUTH_EMAIL_PREFIX = 'bangkago+';
const DEMO_PASSWORD = 'demo1234';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error(`
Missing environment variables. Ensure your .env file contains:

  EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
  SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
`);
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

/** +639171234567 -> bangkago+639171234567@gmail.com */
const authEmail = (e164) => `${AUTH_EMAIL_PREFIX}${e164.slice(1)}@${AUTH_EMAIL_DOMAIN}`;

// ---------------------------------------------------------------- ports

const PORTS = [
  { id: 'mactan-pier-1', port_name: 'Mactan Pier 1 (Punta Engaño)', location: 'Mactan, Cebu', latitude: 10.3068, longitude: 124.0120, sort_order: 1, is_active: true },
  { id: 'mactan-pier-2', port_name: 'Mactan Pier 2 (Maribago)', location: 'Mactan, Cebu', latitude: 10.2950, longitude: 124.0050, sort_order: 2, is_active: true },
  { id: 'olango-port', port_name: 'Olango Island Port (Sta. Rosa)', location: 'Olango, Cebu', latitude: 10.3320, longitude: 124.0450, sort_order: 3, is_active: true },
  { id: 'caohagan', port_name: 'Caohagan Island', location: 'Caohagan, Cebu', latitude: 10.2750, longitude: 124.0650, sort_order: 4, is_active: true },
  { id: 'nalusuan', port_name: 'Nalusuan Island', location: 'Nalusuan, Cebu', latitude: 10.2850, longitude: 124.0550, sort_order: 5, is_active: true },
];

// ---------------------------------------------------------------- routes

const ROUTE_PAIRS = [
  { a: 'mactan-pier-2', b: 'olango-port', base_fare: 150, estimated_minutes: 15, distance_km: 5.2 },
  { a: 'mactan-pier-1', b: 'olango-port', base_fare: 180, estimated_minutes: 20, distance_km: 6.8 },
  { a: 'mactan-pier-2', b: 'caohagan', base_fare: 280, estimated_minutes: 35, distance_km: 8.5 },
  { a: 'mactan-pier-1', b: 'caohagan', base_fare: 320, estimated_minutes: 40, distance_km: 9.2 },
  { a: 'mactan-pier-2', b: 'nalusuan', base_fare: 360, estimated_minutes: 45, distance_km: 7.8 },
  { a: 'mactan-pier-1', b: 'nalusuan', base_fare: 400, estimated_minutes: 55, distance_km: 8.9 },
];

function buildRoutes() {
  const routes = [];
  for (const { a, b, base_fare, estimated_minutes, distance_km } of ROUTE_PAIRS) {
    for (const [start, end] of [[a, b], [b, a]]) {
      routes.push({
        id: `${start}__${end}`,
        start_port_id: start,
        end_port_id: end,
        base_fare,
        estimated_minutes,
        distance_km,
        is_active: true,
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

const SEED_BOOKINGS = [
  { daysAgo: 12, from: 'mactan-pier-2', to: 'olango-port', passengerCount: 2, status: 'completed', operator: '+639181234567' },
  { daysAgo: 8,  from: 'mactan-pier-1', to: 'caohagan', passengerCount: 4, status: 'cancelled' },
  { daysAgo: 5,  from: 'mactan-pier-1', to: 'nalusuan', passengerCount: 1, status: 'cancelled' },
  { daysAgo: 2,  from: 'mactan-pier-2', to: 'nalusuan', passengerCount: 3, status: 'completed', operator: '+639191234567' },
];

/** Deletes every booking. */
async function wipeBookings(db) {
  const { count } = await db.from('bookings').select('*', { count: 'exact', head: true });
  if (!count) return 0;
  await db.from('bookings').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  return count;
}

/** Re-creates the historical bookings. */
async function writeSeedBookings(db, people) {
  const passenger = people['+639171234567'];
  const routes = buildRoutes();
  const routeMap = Object.fromEntries(routes.map((r) => [r.id, r]));
  const portName = Object.fromEntries(PORTS.map((p) => [p.id, p.port_name]));

  const bookings = [];
  for (const b of SEED_BOOKINGS) {
    const route = routeMap[`${b.from}__${b.to}`];
    const created = new Date(Date.now() - b.daysAgo * 86400000);
    const op = b.operator ? people[b.operator] : null;

    // id and ref are generated by the set_booking_ref trigger
    bookings.push({
      user_id: passenger.uid,
      passenger_name: `${passenger.firstName} ${passenger.lastName}`,
      passenger_phone: passenger.phone,
      from_port_name: portName[b.from],
      to_port_name: portName[b.to],
      num_of_passenger: b.passengerCount,
      total_price: route.base_fare * b.passengerCount,
      route_id: route.id,
      service_type: 'passenger',
      trip_stat: b.status,
      operator_id: op ? op.uid : null,
      operator_name: op ? `${op.firstName} ${op.lastName}` : null,
      operator_boat_name: op ? op.boatName : null,
      rejected_by: [],
      created_at: created.toISOString(),
      accepted_at: op ? new Date(created.getTime() + 6 * 60000).toISOString() : null,
      completed_at:
        b.status === 'completed'
          ? new Date(created.getTime() + route.estimated_minutes * 60000).toISOString()
          : null,
      cancelled_at:
        b.status === 'cancelled'
          ? new Date(created.getTime() + 3 * 60000).toISOString()
          : null,
    });
  }

  if (bookings.length) {
    const { error } = await db.from('bookings').insert(bookings);
    if (error) throw error;
  }
  return SEED_BOOKINGS.length;
}

module.exports = {
  supabase, authEmail,
  DEMO_PASSWORD, PORTS, ACCOUNTS, SEED_BOOKINGS,
  buildRoutes, wipeBookings, writeSeedBookings,
};
