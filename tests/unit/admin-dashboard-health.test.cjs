/**
 * System Health card — web/BangkaGO-WEB/admin-dashboard/admin-dashboard.html
 *
 * The card must never claim a state it did not measure. The page's inline
 * script runs here in a vm with a stubbed document/window/supabase client,
 * and every badge is asserted against a known probe result (healthy, error,
 * timeout, no client).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const HTML_PATH = path.join(__dirname, '..', '..', 'web', 'BangkaGO-WEB', 'admin-dashboard', 'admin-dashboard.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');

const INLINE_SCRIPT = (() => {
  const found = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(found.length, 1, 'admin-dashboard.html must keep exactly one inline script');
  return found[0];
})();

/** Chainable query builder that resolves like PostgREST: pick() decides the
 *  result from which builder method was used (limit = row read, eq = open
 *  count, is = port-queue count). */
function makeBuilder(pick) {
  const flags = { limit: false, eq: false, is: false };
  const b = {
    select: () => b,
    order: () => b,
    limit: () => { flags.limit = true; return b; },
    eq: () => { flags.eq = true; return b; },
    is: () => { flags.is = true; return b; },
    then: (ok, err) => pick(flags).then(ok, err),
  };
  return b;
}

function makeClient(overrides = {}) {
  const o = Object.assign({
    getUser: async () => ({ data: { user: { id: 'admin-1' } }, error: null }),
    readBookings: async () => ({ data: [{ id: 7 }], error: null }),
    openCount: async () => ({ count: 0, error: null }),
    boatCount: async () => ({ count: 0, error: null }),
  }, overrides);

  return {
    auth: { getUser: () => o.getUser() },
    from(table) {
      if (table === 'bookings') return makeBuilder((f) => (f.limit ? o.readBookings() : o.openCount()));
      if (table === 'port_queue') return makeBuilder(() => o.boatCount());
      return makeBuilder(() => Promise.resolve({ count: 0, error: null }));
    },
  };
}

function makeEnv({ client, statuses = {}, activeBangkas = [{ id: 'boat-1' }, { id: 'boat-2' }], vesselPositions = [], fastTimeout = false } = {}) {
  const els = {};
  const subscriptions = [];
  const el = (id) => (els[id] ||= { id, textContent: '', className: '', innerHTML: '' });

  const ctx = {
    console,
    setTimeout: fastTimeout ? (fn) => setTimeout(fn, 1) : setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    performance: { now: () => Date.now() },
    document: { getElementById: el },
    window: {
      bangkagoServices: { getClient: () => client },
      bangkagoRealtime: {
        subscribe: (table) => { subscriptions.push(table); return 'stub-key'; },
        getStatuses: () => statuses,
      },
      // Never resolves: the test drives the checks itself instead of racing
      // the parse-time "wait for auth" IIFE.
      bangkagoAuthReady: new Promise(() => {}),
      bangkagoBookings: { getStats: async () => ({ open: 0, accepted: 0, completed: 0, cancelled: 0, pending: 0 }) },
      bangkagoVessels: {
        getAllBangkas: async () => activeBangkas,
        getAllLatestPositions: async () => vesselPositions,
      },
      addEventListener: () => {},
    },
  };
  vm.createContext(ctx);
  vm.runInContext(INLINE_SCRIPT, ctx, { filename: 'admin-dashboard.html<inline>' });
  return { ctx, els, subscriptions };
}

const check = (ctx) => vm.runInContext('checkSystemHealth()', ctx);
const loadDashboard = (ctx) => vm.runInContext('loadDashboardKPIs()', ctx);

test('the three health rows start neutral and no fake health line remains', () => {
  for (const id of ['apiStatus', 'dbStatus', 'queueStatus']) {
    const line = html.split(/\r?\n/).find((l) => l.includes(`id="${id}"`));
    assert.ok(line, `${id} must exist in the markup`);
    assert.ok(line.includes('text-bg-secondary'), `${id} must start neutral, never a hardcoded green`);
  }
  assert.ok(!html.includes('Realtime Feed'), 'the Realtime Feed row must be removed');
  assert.ok(!html.includes('System health check passed'), 'the activity list must not claim a health check that never ran');
});

test('healthy probes report measured values on all three badges', async () => {
  const { ctx, els } = makeEnv({
    client: makeClient({
      openCount: async () => ({ count: 3, error: null }),
      boatCount: async () => ({ count: 2, error: null }),
    }),
  });
  await check(ctx);

  assert.match(els.apiStatus.textContent, /^Healthy · \d+ ms$/);
  assert.equal(els.apiStatus.className, 'badge text-bg-success');
  assert.match(els.dbStatus.textContent, /^Normal · \d+ ms$/);
  assert.equal(els.dbStatus.className, 'badge text-bg-success');
  assert.equal(els.queueStatus.textContent, '3 open · 2 at port');
  assert.equal(els.queueStatus.className, 'badge text-bg-info');
});

test('active vessel KPI counts Bangkas, not only vessels with GPS positions', async () => {
  const { ctx, els, subscriptions } = makeEnv({
    client: makeClient(),
    activeBangkas: [{ id: 'boat-1' }, { id: 'boat-2' }],
    vesselPositions: [{ bangkaId: 'boat-1' }],
  });
  await loadDashboard(ctx);

  assert.equal(els.kpiActiveVessels.textContent, 2);
  assert.match(els.opsSnapshotBody.innerHTML, /1 bangka tracked/);
  assert.ok(subscriptions.includes('bangkas'), 'the page must subscribe to Bangka changes');
});

test('gateway errors are labelled from the auth status code', async () => {
  const cases = [
    { res: { data: { user: null }, error: { status: 401, message: 'JWT expired' } }, text: 'Session expired' },
    { res: { data: { user: null }, error: { status: 400, message: 'Auth session missing!' } }, text: 'No session' },
    { res: { data: { user: null }, error: { status: 503, message: 'service unavailable' } }, text: 'Unreachable' },
    { res: { data: { user: null }, error: { message: 'TypeError: Failed to fetch' } }, text: 'Unreachable' },
    { res: { data: { user: null }, error: null }, text: 'No session' },
  ];
  for (const c of cases) {
    const { ctx, els } = makeEnv({
      client: makeClient({ getUser: async () => c.res }),
    });
    await check(ctx);
    assert.equal(els.apiStatus.textContent, c.text, JSON.stringify(c.res.error));
    assert.equal(els.apiStatus.className, 'badge text-bg-danger', JSON.stringify(c.res.error));
    // The database row keeps reporting — one dead layer must not hide the rest.
    assert.match(els.dbStatus.textContent, /^Normal · /);
    assert.equal(els.queueStatus.textContent, 'Clear');
  }
});

test('database read failures are labelled from the real failure, not a guess', async () => {
  const rejected = makeEnv({
    client: makeClient({ readBookings: async () => { throw new Error('fetch failed'); } }),
  });
  await check(rejected.ctx);
  assert.equal(rejected.els.dbStatus.textContent, 'No response');
  assert.equal(rejected.els.dbStatus.className, 'badge text-bg-danger');
  assert.match(rejected.els.apiStatus.textContent, /^Healthy · /);

  const errored = makeEnv({
    client: makeClient({ readBookings: async () => ({ data: null, error: { message: 'permission denied' } }) }),
  });
  await check(errored.ctx);
  assert.equal(errored.els.dbStatus.textContent, 'Read failed');
  assert.equal(errored.els.dbStatus.className, 'badge text-bg-danger');
});

test('queue depth drives Clear / info / warning at the >20 threshold', async () => {
  const cases = [
    { open: 0, boats: 4, text: 'Clear', cls: 'badge text-bg-success' },
    { open: 5, boats: 2, text: '5 open · 2 at port', cls: 'badge text-bg-info' },
    { open: 20, boats: 2, text: '20 open · 2 at port', cls: 'badge text-bg-info' },
    { open: 25, boats: 1, text: '25 open · 1 at port', cls: 'badge text-bg-warning' },
  ];
  for (const c of cases) {
    const { ctx, els } = makeEnv({
      client: makeClient({
        openCount: async () => ({ count: c.open, error: null }),
        boatCount: async () => ({ count: c.boats, error: null }),
      }),
    });
    await check(ctx);
    assert.equal(els.queueStatus.textContent, c.text);
    assert.equal(els.queueStatus.className, c.cls, `open=${c.open}`);
  }
});

test('a failing queue probe reads Unavailable, never a false Clear', async () => {
  const { ctx, els } = makeEnv({
    client: makeClient({ openCount: async () => { throw new Error('network down'); } }),
  });
  await check(ctx);
  assert.equal(els.queueStatus.textContent, 'Unavailable');
  assert.equal(els.queueStatus.className, 'badge text-bg-danger');
  assert.match(els.dbStatus.textContent, /^Normal · /);
});

test('a probe that never answers times out instead of hanging on Checking...', async () => {
  const hang = () => new Promise(() => {});
  const { ctx, els } = makeEnv({
    client: makeClient({ getUser: hang, readBookings: hang, openCount: hang, boatCount: hang }),
    fastTimeout: true,
  });
  await check(ctx);
  assert.equal(els.apiStatus.textContent, 'Timed out');
  assert.equal(els.dbStatus.textContent, 'Timed out');
  assert.equal(els.queueStatus.textContent, 'Timed out');
  for (const id of ['apiStatus', 'dbStatus', 'queueStatus']) {
    assert.equal(els[id].className, 'badge text-bg-danger', id);
  }
});

test('without a client every row waits instead of guessing', async () => {
  const { ctx, els } = makeEnv({ client: null });
  await check(ctx);
  for (const id of ['apiStatus', 'dbStatus', 'queueStatus']) {
    assert.equal(els[id].textContent, 'Waiting...', id);
    assert.equal(els[id].className, 'badge text-bg-secondary', id);
  }
});
