#!/usr/bin/env node
/**
 * Resets demo state between runs. Leaves ports, routes, and accounts intact.
 *
 *   npm run reset
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY in .env (see scripts/supabase.js).
 */

const {
  supabase, authEmail, ACCOUNTS,
  wipeBookings, writeSeedBookings,
} = require('./supabase');

const EMPTY = process.argv.includes('--empty');

/** Resolves existing accounts to uids. Does not create anything. */
async function resolvePeople() {
  const people = {};
  for (const acct of ACCOUNTS) {
    const email = authEmail(acct.phone);
    const { data: existingUsers } = await supabase.auth.admin.listUsers();
    const user = existingUsers?.users?.find((u) => u.email === email);
    if (!user) {
      throw new Error(`Account ${acct.phone} does not exist. Run "npm run seed" first.`);
    }
    people[acct.phone] = { ...acct, uid: user.id };
  }
  return people;
}

async function reopenBangkeros() {
  const { count } = await supabase
    .from('bangkeros')
    .select('*', { count: 'exact', head: true });

  const { error } = await supabase
    .from('bangkeros')
    .update({ is_available: true, updated_at: new Date().toISOString() })
    .neq('display_name', '');
  if (error) throw error;
  return count ?? 0;
}

(async () => {
  console.log('\nResetting demo state…\n');

  const wiped = await wipeBookings(supabase);
  console.log(`  bookings removed   ${wiped}`);

  if (EMPTY) {
    console.log('  bookings restored  0 (--empty)');
  } else {
    const people = await resolvePeople();
    const written = await writeSeedBookings(supabase, people);
    console.log(`  bookings restored  ${written} historical`);
  }

  const bangkeros = await reopenBangkeros();
  console.log(`  bangkeros online   ${bangkeros}`);

  console.log('\nPorts, routes, and accounts untouched. Ready for another run.\n');
  process.exit(0);
})().catch((e) => {
  console.error('\n✗ Reset failed:', e.message);
  if (e.code) console.error('  code:', e.code);
  process.exit(1);
});
