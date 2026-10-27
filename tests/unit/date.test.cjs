const test = require('node:test');
const assert = require('node:assert/strict');
const { manilaTodayIso, toManilaIso, manilaDayStartMs } = require('../.build/utils/date.js');

test('manilaTodayIso returns a YYYY-MM-DD Manila date', () => {
  assert.match(manilaTodayIso(), /^\d{4}-\d{2}-\d{2}$/);
});

test('toManilaIso converts UTC timestamps across the Manila midnight boundary', () => {
  assert.equal(toManilaIso('2026-10-28T15:30:00Z'), '2026-10-28');
  assert.equal(toManilaIso('2026-10-28T16:30:00Z'), '2026-10-29');
  assert.equal(toManilaIso('2026-12-31T16:00:00Z'), '2027-01-01');
});

test('toManilaIso returns null for missing or invalid values', () => {
  assert.equal(toManilaIso(null), null);
  assert.equal(toManilaIso(undefined), null);
  assert.equal(toManilaIso(''), null);
  assert.equal(toManilaIso('not-a-date'), null);
});

test('manilaDayStartMs anchors midnight at UTC+08:00 with no DST drift', () => {
  assert.equal(manilaDayStartMs('2026-10-28'), Date.parse('2026-10-27T16:00:00Z'));
  assert.equal(manilaDayStartMs('2026-01-15'), Date.parse('2026-01-14T16:00:00Z'));
});
