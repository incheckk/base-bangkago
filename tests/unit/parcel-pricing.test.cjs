const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PARCEL_RATES,
  getParcelZone,
  isParcelAllowed,
  calculateParcelFare,
} = require('../.build/services/parcel-pricing.service.js');

const mactan = { portId: 'mactan-port', islandGroup: 'mactan' };
const olango = { portId: 'olango-port', islandGroup: 'olango' };

test('getParcelZone mirrors the port island group', () => {
  assert.equal(getParcelZone(mactan), 'mactan');
  assert.equal(getParcelZone(olango), 'olango');
});

test('isParcelAllowed enforces the 1-50 kg Phase 0 limit', () => {
  assert.equal(isParcelAllowed({ fromPort: mactan, toPort: olango, totalKg: 1, deliveryType: 'batched' }), null);
  assert.equal(isParcelAllowed({ fromPort: mactan, toPort: olango, totalKg: 50, deliveryType: 'batched' }), null);
  assert.equal(isParcelAllowed({ fromPort: mactan, toPort: olango, totalKg: 0.5, deliveryType: 'batched' }), `Minimum weight is ${PARCEL_RATES.minKg} kg.`);
  assert.equal(isParcelAllowed({ fromPort: mactan, toPort: olango, totalKg: 50.1, deliveryType: 'batched' }), `Max ${PARCEL_RATES.maxKg} kg per parcel.`);
  assert.equal(isParcelAllowed({ fromPort: mactan, toPort: olango, totalKg: NaN, deliveryType: 'batched' }), `Minimum weight is ${PARCEL_RATES.minKg} kg.`);
});

test('calculateParcelFare charges base fee only inside the 10 kg allowance', () => {
  const result = calculateParcelFare({ fromPort: mactan, toPort: mactan, totalKg: 10, deliveryType: 'accompanied' });
  assert.equal(result.fare, 120);
  assert.equal(result.isCrossIsland, false);
  assert.equal(result.blockedReason, null);
  assert.deepEqual(result.breakdown, [
    'Base fee (accompanied): ₱120',
    'Included weight: 10 kg',
    'Total: ₱120',
  ]);
});

test('calculateParcelFare rounds weight up and bills excess kilograms', () => {
  const result = calculateParcelFare({ fromPort: mactan, toPort: olango, totalKg: 12.1, deliveryType: 'piggyback' });
  assert.equal(result.fare, 150);
  assert.equal(result.isCrossIsland, true);
  assert.ok(result.breakdown.includes('Excess 3 kg × ₱10 = ₱30'));
});

test('calculateParcelFare applies the batched base fee across islands', () => {
  const result = calculateParcelFare({ fromPort: mactan, toPort: olango, totalKg: 50, deliveryType: 'batched' });
  assert.equal(result.fare, 550);
  assert.equal(result.isCrossIsland, true);
});

test('calculateParcelFare applies the solo surcharge on top of the batched base', () => {
  const result = calculateParcelFare({ fromPort: mactan, toPort: mactan, totalKg: 5, deliveryType: 'solo' });
  assert.equal(result.fare, 300);
  assert.ok(result.breakdown.includes('Solo surcharge: ₱150'));
});

test('calculateParcelFare blocks out-of-range weights without a fare', () => {
  const light = calculateParcelFare({ fromPort: mactan, toPort: olango, totalKg: 0.5, deliveryType: 'batched' });
  assert.equal(light.fare, 0);
  assert.deepEqual(light.breakdown, []);
  assert.equal(light.blockedReason, `Minimum weight is ${PARCEL_RATES.minKg} kg.`);

  const heavy = calculateParcelFare({ fromPort: mactan, toPort: olango, totalKg: 51, deliveryType: 'batched' });
  assert.equal(heavy.fare, 0);
  assert.equal(heavy.blockedReason, `Max ${PARCEL_RATES.maxKg} kg per parcel.`);
});
