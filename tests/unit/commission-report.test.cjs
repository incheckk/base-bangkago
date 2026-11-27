/**
 * Commission report — web/assets/js/services/stats.js
 *
 * The money split shown on Admin → View Reports must be the same rule the
 * payout rails apply (096/097): commission is a share of the WHOLE fare,
 * held out of the downpayment, and a released row keeps its snapshot.
 * stats.js runs here in a vm against a stubbed PostgREST client.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SERVICE_PATH = path.join(__dirname, '..', '..', 'web', 'assets', 'js', 'services', 'stats.js');
const source = fs.readFileSync(SERVICE_PATH, 'utf8');

const twoDaysAgo = (() => {
  const d = new Date(Date.now() - 2 * 86400000);
  return d.toISOString();
})();

function booking(fields) {
  return Object.assign({
    id: 'b-' + Math.random().toString(16).slice(2),
    ref: 'BGO-TEST',
    trip_stat: 'completed',
    total_price: 1000,
    created_at: twoDaysAgo,
    completed_at: twoDaysAgo,
    from_port_name: 'Marigondon',
    to_port_name: 'Caohagan',
    downpayments: null,
  }, fields);
}

function makeEnv({ rows = [], storedRate = '0.0700', rpc } = {}) {
  const calls = { rpc: [] };

  function builder(table) {
    const b = {
      select: () => b,
      order: () => b,
      or: () => b,
      gte: () => b,
      lt: () => b,
      eq: () => b,
      range: () => b,
      maybeSingle: () => resolve(table),
      then: (ok, err) => Promise.resolve(resolve(table)).then(ok, err),
    };
    return b;
  }

  function resolve(table) {
    if (table === 'bookings') return { data: rows, error: null };
    if (table === 'app_settings') return { data: { value: storedRate }, error: null };
    return { count: 0, error: null };
  }

  const client = {
    from: (table) => builder(table),
    rpc: async (name, args) => {
      calls.rpc.push({ name, args });
      return rpc ? rpc(name, args) : { error: null };
    },
  };

  const ctx = {
    console,
    Promise,
    Date,
    Number,
    Math,
    Array,
    Map,
    Object,
    String,
    window: { bangkagoServices: { getClient: () => client } },
  };
  vm.createContext(ctx);
  vm.runInContext(source, ctx, { filename: 'stats.js' });
  return { stats: ctx.window.bangkagoStats, calls };
}

test('released downpayment reports its snapshot, not a re-computation', async () => {
  const { stats } = makeEnv({
    storedRate: '0.0800',
    rows: [booking({
      total_price: 1000,
      downpayments: { amount: 500, status: 'approved', commission_amount: 70, commission_rate: 0.07, released_at: twoDaysAgo },
    })],
  });

  const data = await stats.getReportData('7d');
  const c = data.commission;
  assert.equal(c.platform, 70, 'the frozen 7% amount wins over the current 8%');
  assert.equal(c.bangkero, 930);
  assert.equal(c.gross, 1000);
  assert.equal(c.collected, 500);
  assert.equal(c.withheld, 70);
  assert.equal(c.reserved, 0);
  assert.equal(c.notWithheld, 0);
  assert.equal(c.rows[0].rate, 0.07);
  assert.equal(c.rows[0].state, 'withheld');
  assert.equal(c.rows[0].payout, 'Released');
});

test('approved-but-not-released shows what release will withhold at the current rate', async () => {
  const { stats } = makeEnv({
    storedRate: '0.0800',
    rows: [booking({
      downpayments: { amount: 500, status: 'approved', commission_amount: null, commission_rate: null },
    })],
  });

  const c = (await stats.getReportData('7d')).commission;
  assert.equal(c.platform, 80);
  assert.equal(c.bangkero, 920);
  assert.equal(c.reserved, 80);
  assert.equal(c.withheld, 0);
  assert.equal(c.rows[0].payout, 'Awaiting release');
});

test('a same-day fare with no held downpayment still owes the whole-fare share', async () => {
  const { stats } = makeEnv({
    rows: [booking({ total_price: 300, downpayments: null })],
  });

  const c = (await stats.getReportData('7d')).commission;
  assert.equal(c.gross, 300);
  assert.equal(c.platform, 21, '7% of the whole fare, even when nothing was held');
  assert.equal(c.bangkero, 279);
  assert.equal(c.withheld, 0);
  assert.equal(c.reserved, 0);
  assert.equal(c.notWithheld, 21, 'it was never withheld — there was no downpayment');
  assert.equal(c.rows[0].payout, 'On-board');
  assert.equal(c.rows[0].state, 'notWithheld');
  assert.equal(c.rows[0].fee, 21);
});

test('a refunded receipt leaves the fare on board but the share unwithheld, not zero', async () => {
  const { stats } = makeEnv({
    rows: [booking({
      downpayments: { amount: 500, status: 'refunded', commission_amount: null, commission_rate: null },
    })],
  });

  const c = (await stats.getReportData('7d')).commission;
  assert.equal(c.platform, 70);
  assert.equal(c.notWithheld, 70);
  assert.equal(c.withheld, 0);
  assert.equal(c.rows[0].payout, 'Refunded');
});

test('fare always equals bangkero share plus commission, across mixed rows', async () => {
  const { stats } = makeEnv({
    storedRate: '0.0800',
    rows: [
      booking({ total_price: 1000, downpayments: { amount: 500, status: 'approved', commission_amount: 70, commission_rate: 0.07, released_at: twoDaysAgo } }),
      booking({ total_price: 500, downpayments: { amount: 250, status: 'approved', commission_amount: null, commission_rate: null } }),
      booking({ total_price: 300, downpayments: null }),
      booking({ total_price: 800, downpayments: { amount: 400, status: 'refunded', commission_amount: null, commission_rate: null } }),
    ],
  });

  const c = (await stats.getReportData('7d')).commission;
  assert.equal(c.gross, 2600);
  assert.equal(c.platform, 198); // 70 frozen + 40 reserved + 24 + 64 on board
  assert.equal(c.bangkero, 2402);
  assert.equal(c.gross, c.bangkero + c.platform);
  assert.equal(c.withheld, 70);
  assert.equal(c.reserved, 40);
  assert.equal(c.notWithheld, 88);
  for (const row of c.rows) assert.equal(row.net, row.fare - row.fee);
});

test('a missing setting falls back to the 7% SQL default', async () => {
  const { stats } = makeEnv({ storedRate: '', rows: [] });
  assert.equal(await stats.getCommissionRate(), 0.07);
});

test('the rate is written through the guarded RPC and range-checked first', async () => {
  const { stats, calls } = makeEnv({ rpc: () => ({ error: null }) });

  await stats.setCommissionRate(0.08);
  assert.equal(calls.rpc.length, 1);
  assert.equal(calls.rpc[0].name, 'set_commission_rate');
  assert.equal(calls.rpc[0].args.p_rate, 0.08);

  await assert.rejects(() => stats.setCommissionRate(0.04), /between 5% and 9%/);
  await assert.rejects(() => stats.setCommissionRate(0.1), /between 5% and 9%/);
  assert.equal(calls.rpc.length, 1, 'an out-of-range rate never reaches the database');
});

test('an RPC refusal surfaces instead of pretending the rate saved', async () => {
  const { stats } = makeEnv({
    rpc: () => ({ error: { message: 'admins only' } }),
  });
  await assert.rejects(
    () => stats.setCommissionRate(0.08),
    (error) => error.message === 'admins only'
  );
});
