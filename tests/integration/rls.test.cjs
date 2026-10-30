const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function loadEnv() {
  const raw = fs.readFileSync(path.join(__dirname, '..', '..', '.env'), 'utf8');
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_0-9]+)\s*=\s*(.*)\s*$/);
    if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

const env = loadEnv();
const baseUrl = env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const headers = { apikey: anonKey, Authorization: `Bearer ${anonKey}` };
const writable = { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' };

async function select(table, query) {
  return fetch(`${baseUrl}/rest/v1/${table}?${query}`, { headers });
}

test('anonymous clients can read the public ports catalogue', async () => {
  const response = await select('ports', 'select=id,port_name&limit=1');
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(body));
  assert.ok(body.length >= 1);
});

test('RLS hides user profile rows from anonymous clients', async () => {
  const response = await select('users', 'select=id&limit=1');
  const body = await response.json();
  if (response.status === 200) {
    assert.ok(Array.isArray(body));
    assert.equal(body.length, 0);
  } else {
    assert.ok([401, 403].includes(response.status), `unexpected status ${response.status}`);
  }
});

test('RLS hides booking rows from anonymous clients', async () => {
  const response = await select('bookings', 'select=id&limit=1');
  const body = await response.json();
  if (response.status === 200) {
    assert.ok(Array.isArray(body));
    assert.equal(body.length, 0);
  } else {
    assert.ok([401, 403].includes(response.status), `unexpected status ${response.status}`);
  }
});

test('RLS refuses anonymous updates to a user row', async () => {
  const response = await fetch(`${baseUrl}/rest/v1/users?id=eq.00000000-0000-0000-0000-000000000000`, {
    method: 'PATCH',
    headers: writable,
    body: JSON.stringify({ first_name: 'RLS Probe' }),
  });
  if ([200, 204].includes(response.status)) {
    const body = await response.json().catch(() => []);
    assert.equal(Array.isArray(body) ? body.length : 0, 0);
  } else {
    assert.ok([401, 403].includes(response.status), `unexpected status ${response.status}`);
  }
});
