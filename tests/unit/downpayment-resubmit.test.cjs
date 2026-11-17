// One escrow row per booking/rental (019). A rejected receipt must reopen
// that row (099), never insert a second one and hit 23505.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(process.cwd(), 'src/services/downpayment.service.ts'),
  'utf8',
);
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

function loadService({ existing = null, row = null } = {}) {
  const calls = [];
  let inserted = null;
  const supabase = {
    from(table) {
      const builder = {
        select(columns) {
          calls.push({ method: 'select', table, columns });
          return builder;
        },
        eq(column, value) {
          calls.push({ method: 'eq', table, column, value });
          return builder;
        },
        insert(values) {
          inserted = values;
          calls.push({ method: 'insert', table });
          return builder;
        },
        maybeSingle: async () => ({ data: existing, error: null }),
        single: async () => ({ data: row, error: null }),
      };
      return builder;
    },
    rpc: async (name, args) => {
      calls.push({ method: 'rpc', name, args });
      return { error: null };
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(javascript, {
    exports: module.exports,
    module,
    require: (id) => {
      if (id === './supabase') return { supabase };
      if (id === './notification.service') return { createNotification: async () => {} };
      throw new Error(`Unexpected import: ${id}`);
    },
  });
  return { service: module.exports, calls, getInserted: () => inserted };
}

test('a rejected rental receipt reopens the same row instead of inserting', async () => {
  const { service, calls, getInserted } = loadService({
    existing: { id: 'dp-1', status: 'rejected', proof_url: 'old.jpg' },
    row: { id: 'dp-1', status: 'pending', amount: '500', boat_rental_id: 'rental-1' },
  });

  const result = await service.createDownpayment({
    amount: 500,
    referenceNum: '',
    proofUrl: 'new.jpg',
    boatRentalId: 'rental-1',
  });

  assert.equal(getInserted(), null);
  assert.equal(result.downpaymentId, 'dp-1');
  assert.equal(result.status, 'pending');
  const rpc = calls.filter((call) => call.method === 'rpc');
  assert.equal(rpc.length, 1);
  assert.equal(rpc[0].name, 'attach_downpayment_proof');
  assert.equal(rpc[0].args.p_proof, 'new.jpg');
});

test('a rejected receipt cannot be resent without a new proof', async () => {
  const { service, calls } = loadService({
    existing: { id: 'dp-1', status: 'rejected', proof_url: 'old.jpg' },
  });

  await assert.rejects(
    service.createDownpayment({
      amount: 500,
      referenceNum: '',
      proofUrl: '',
      boatRentalId: 'rental-1',
    }),
    /Attach your GCash receipt first/,
  );
  assert.equal(calls.some((call) => call.method === 'rpc'), false);
});

test('an approved downpayment is never rewritten', async () => {
  const { service, getInserted } = loadService({
    existing: { id: 'dp-1', status: 'approved', proof_url: 'paid.jpg' },
  });

  await assert.rejects(
    service.createDownpayment({
      amount: 500,
      referenceNum: '',
      proofUrl: 'new.jpg',
      bookingId: 'booking-1',
    }),
    /already approved/,
  );
  assert.equal(getInserted(), null);
});

test('a first-time downpayment still inserts one row', async () => {
  const { service, getInserted } = loadService({
    row: { id: 'dp-2', status: 'pending', amount: '500', booking_id: 'booking-1' },
  });

  const result = await service.createDownpayment({
    amount: 500,
    referenceNum: '  123456  ',
    proofUrl: 'proof.jpg',
    bookingId: 'booking-1',
  });

  assert.equal(result.downpaymentId, 'dp-2');
  assert.equal(getInserted().booking_id, 'booking-1');
  assert.equal(getInserted().reference_num, '123456');
});
