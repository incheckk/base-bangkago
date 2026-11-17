const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BATCH_WINDOW_MINUTES,
  batchWindowFor,
  computeBatchingRouteKey,
} = require('./load-ts.cjs')('src/utils/parcel-batch.ts');

const at = (h, m, day = 17) => new Date(2026, 10, day, h, m, 0, 0);

test('senders inside the same hour share one umbrella key', () => {
  const early = batchWindowFor('mactan', 'olango', at(10, 5));
  const late = batchWindowFor('mactan', 'olango', at(10, 55));
  assert.equal(early.routeKey, late.routeKey);
  assert.equal(early.routeKey, 'mactan__olango-20261117');
});

test('the key is day-scoped: tomorrow never joins today', () => {
  const today = batchWindowFor('mactan', 'olango', at(23, 30, 17));
  const tomorrow = batchWindowFor('mactan', 'olango', at(0, 30, 18));
  assert.notEqual(today.routeKey, tomorrow.routeKey);
  assert.match(today.routeKey, /-20261117$/);
  assert.match(tomorrow.routeKey, /-20261118$/);
});

test('different routes never merge', () => {
  const out = computeBatchingRouteKey({ fromPortId: 'mactan', toPortId: 'olango', date: at(10, 0) });
  const back = computeBatchingRouteKey({ fromPortId: 'olango', toPortId: 'mactan', date: at(10, 0) });
  assert.notEqual(out, back);
});

test('every window is exactly one hour', () => {
  const now = at(10, 5);
  const { deadlineAt } = batchWindowFor('mactan', 'olango', now);
  assert.equal(BATCH_WINDOW_MINUTES, 60);
  assert.equal(deadlineAt.getTime() - now.getTime(), BATCH_WINDOW_MINUTES * 60_000);
});
