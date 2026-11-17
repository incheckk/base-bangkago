const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(process.cwd(), 'src/services/island-package.service.ts'),
  'utf8',
);
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

function loadService(responses) {
  const calls = [];
  let queryIndex = 0;
  const supabase = {
    from(table) {
      const response = responses[queryIndex++] || { data: [], error: null };
      const builder = {
        select: () => builder,
        eq: (column) => { calls.push({ method: 'eq', table, column }); return builder; },
        is: (column) => { calls.push({ method: 'is', table, column }); return builder; },
        order: () => builder,
        maybeSingle: async () => response,
        then: (resolve, reject) => Promise.resolve(response).then(resolve, reject),
      };
      return builder;
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(javascript, {
    exports: module.exports,
    module,
    require: (id) => {
      if (id === './supabase') return { supabase };
      throw new Error(`Unexpected import: ${id}`);
    },
  });
  return { service: module.exports, calls, getQueryCount: () => queryIndex };
}

test('package catalog hides packages soft-deleted by migration 091', async () => {
  const { service, calls, getQueryCount } = loadService([
    { data: [{ id: 'package-1' }], error: null },
  ]);

  const packages = await service.getIslandPackages();

  assert.equal(packages.length, 1);
  assert.equal(getQueryCount(), 1);
  assert.equal(calls.filter((call) => call.method === 'is' && call.column === 'deleted_at').length, 1);
  assert.equal(calls.some((call) => call.column.startsWith('bangkas.')), false);
});

test('package catalog retries without the filter when migration 091 is not installed', async () => {
  const { service, calls, getQueryCount } = loadService([
    { data: null, error: { code: '42703', message: 'column island_packages.deleted_at does not exist' } },
    { data: [{ id: 'package-1' }], error: null },
  ]);

  const packages = await service.getIslandPackages();

  assert.equal(packages.length, 1);
  assert.equal(getQueryCount(), 2);
  assert.equal(calls.filter((call) => call.method === 'is' && call.column === 'deleted_at').length, 1);
});

test('package detail still reads a soft-deleted row for booking history', async () => {
  const { service, calls, getQueryCount } = loadService([
    { data: { id: 'package-1', is_active: true }, error: null },
  ]);

  const pkg = await service.getIslandPackage('package-1');

  assert.equal(pkg.packageId, 'package-1');
  assert.equal(getQueryCount(), 1);
  assert.equal(calls.some((call) => call.method === 'is'), false);
});

test('package catalog still surfaces unrelated query errors', async () => {
  const error = { code: '42501', message: 'permission denied' };
  const { service, getQueryCount } = loadService([{ data: null, error }]);

  await assert.rejects(service.getIslandPackages(), (actual) => actual === error);
  assert.equal(getQueryCount(), 1);
});
