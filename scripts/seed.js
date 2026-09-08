#!/usr/bin/env node
/**
 * Seeds the BangkaGo demo database. Safe to re-run — every write is an
 * overwrite by deterministic id, and bookings are wiped before rebuilding.
 *
 *   npm run seed
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY in .env (see scripts/supabase.js).
 */

const {
  supabase, authEmail,
  DEMO_PASSWORD, PORTS, ACCOUNTS,
  buildRoutes, wipeBookings, writeSeedBookings,
} = require('./supabase');

async function seedPorts() {
  const { error } = await supabase.from('ports').upsert(PORTS, { onConflict: 'id' });
  if (error) throw error;
  return PORTS.length;
}

async function seedRoutes() {
  const routes = buildRoutes();
  await supabase.from('routes').delete().neq('id', '');
  const { error } = await supabase.from('routes').insert(routes);
  if (error) throw error;
  return routes.length;
}

/**
 * Creates the auth account if missing, resets the password if it exists.
 * Returns uid-keyed people so bookings can denormalize names.
 */
async function seedAccounts() {
  const people = {};

  for (const acct of ACCOUNTS) {
    const email = authEmail(acct.phone);
    let uid;

    // Check if user already exists
    const { data: existingUsers } = await supabase.auth.admin.listUsers();
    const existing = existingUsers?.users?.find((u) => u.email === email);

    if (existing) {
      uid = existing.id;
      await supabase.auth.admin.updateUserById(uid, { password: DEMO_PASSWORD });
    } else {
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password: DEMO_PASSWORD,
        email_confirm: true,
      });
      if (error) throw error;
      uid = data.user.id;
    }

    // Upsert users row
    const { error: userError } = await supabase.from('users').upsert({
      id: uid,
      first_name: acct.firstName,
      last_name: acct.lastName,
      email: email,
      phone_number: acct.phone,
      user_role: acct.role,
      is_verified: true,
    }, { onConflict: 'id' });
    if (userError) throw userError;

    // Upsert bangkeros row for bangkeros
    if (acct.role === 'bangkero') {
      const { error: bangkeroError } = await supabase.from('bangkeros').upsert({
        id: uid,
        display_name: `${acct.firstName} ${acct.lastName}`,
        verification_stat: 'verified',
        is_available: true,
      }, { onConflict: 'id' });
      if (bangkeroError) throw bangkeroError;

      // Create bangka record
      const { data: existingBangka } = await supabase
        .from('bangkas')
        .select('id')
        .eq('bangkero_id', uid)
        .maybeSingle();

      if (!existingBangka) {
        const { error: bangkaError } = await supabase.from('bangkas').insert({
          bangka_name: acct.boatName,
          bangka_type: 'pump_boat',
          capacity: acct.capacity,
          bangkero_id: uid,
        });
        if (bangkaError) throw bangkaError;
      }
    }

    people[acct.phone] = { ...acct, uid };
  }

  return people;
}

(async () => {
  console.log('\nSeeding BangkaGo demo data…\n');

  const ports = await seedPorts();
  console.log(`  ports       ${ports}`);

  const routes = await seedRoutes();
  console.log(`  routes      ${routes} (6 pairs, both directions)`);

  const people = await seedAccounts();
  console.log(`  accounts    ${Object.keys(people).length} (password: ${DEMO_PASSWORD})`);

  const wiped = await wipeBookings(supabase);
  const written = await writeSeedBookings(supabase, people);
  console.log(`  bookings    ${written} historical (${wiped} removed first)`);

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
