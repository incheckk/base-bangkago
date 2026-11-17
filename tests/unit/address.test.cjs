const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const vm = require('node:vm');

function load(file) {
  const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
}

const region7 = { exports: {} };
vm.runInNewContext(load('src/data/region7.ts'), { exports: region7.exports, module: region7 });

const address = { exports: {} };
vm.runInNewContext(load('src/utils/address.ts'), {
  exports: address.exports,
  module: address,
  require: (id) => {
    if (id === '../data/region7') return region7.exports;
    throw new Error(`Unexpected import: ${id}`);
  },
});

const { REGION7_CITIES } = region7.exports;
const { cityLabel, cityOptionLabel, composeAddress, parseAddress, addressCity } = address.exports;

test('every city option label is unique', () => {
  const labels = REGION7_CITIES.map(cityOptionLabel);
  assert.equal(new Set(labels).size, labels.length);
  assert.equal(labels.length, 132);
});

test('only the duplicated city names gain a province', () => {
  const get = (name, province) =>
    cityOptionLabel(REGION7_CITIES.find((c) => c.name === name && c.province === province));
  assert.equal(get('Carmen', 'Bohol'), 'Carmen (Bohol)');
  assert.equal(get('Carmen', 'Cebu'), 'Carmen (Cebu)');
  assert.equal(get('Pilar', 'Cebu'), 'Pilar (Cebu)');
  assert.equal(get('Valencia', 'Negros Oriental'), 'Valencia (Negros Oriental)');
  assert.equal(get('Alcantara', 'Cebu'), 'Alcantara');
  assert.equal(get('City of Lapu-Lapu', 'Cebu'), 'Lapu-Lapu City');
});

test('the right Carmen comes back from a saved address', () => {
  const cebu = composeAddress('12 Mabini St.', 'Poblacion', 'Carmen (Cebu)');
  const parsed = parseAddress(cebu);
  assert.equal(parsed.city, 'Carmen (Cebu)');
  assert.equal(parsed.barangay, 'Poblacion');
  assert.equal(parsed.street, '12 Mabini St.');
  assert.equal(addressCity(cebu).province, 'Cebu');

  const bohol = composeAddress('7 Rizal Ave.', 'Poblacion', 'Carmen (Bohol)');
  assert.equal(addressCity(bohol).province, 'Bohol');
});

test('legacy addresses without the province still resolve to the old city', () => {
  const legacy = '12 Mabini St., Poblacion Sur, Carmen, Region VII';
  const parsed = parseAddress(legacy);
  assert.equal(parsed.city, 'Carmen (Bohol)');
  assert.equal(parsed.barangay, 'Poblacion Sur');
  assert.equal(parsed.street, '12 Mabini St.');
  assert.equal(cityLabel('Carmen'), 'Carmen');
});

test('a free-typed street is preserved when no city matches', () => {
  const parsed = parseAddress('Somewhere on the island');
  assert.equal(parsed.city, '');
  assert.equal(parsed.street, 'Somewhere on the island');
});
