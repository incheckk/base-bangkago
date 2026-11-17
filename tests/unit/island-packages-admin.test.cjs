const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '../../web/assets/js/services/island-packages.js'),
  'utf8',
);

function loadService(routes = [{ id: 'mactan__olango', is_active: true }], packages = []) {
  const calls = [];
  const datasets = {
    ports: [{ id: 'mactan', is_active: true }, { id: 'olango', is_active: true }],
    routes,
    island_packages: packages,
    bangkas: [{
      id: 'boat-1',
      bangka_name: 'Demo Bangka',
      capacity: 8,
      bangkero_id: 'operator-1',
      is_active: true,
      is_deleted: false,
      deleted_at: null,
      bangkeros: {
        display_name: 'Demo Bangkero',
        verification_stat: 'verified',
        is_deleted: false,
        deleted_at: null,
      },
    }],
  };
  function query(table) {
    const result = { data: datasets[table] || [], error: null };
    const builder = {
      select: () => builder,
      order: () => builder,
      eq: () => builder,
      is: () => builder,
      not: () => builder,
      limit: () => builder,
      insert: (value) => {
        calls.push({ operation: 'insert', table, value });
        return builder;
      },
      update: (value) => {
        calls.push({ operation: 'update', table, value });
        return builder;
      },
      delete: () => {
        calls.push({ operation: 'delete', table });
        return builder;
      },
      single: async () => ({ data: { id: 'new-package' }, error: null }),
      maybeSingle: async () => ({ data: { id: 'new-package' }, error: null }),
      then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    };
    return builder;
  }
  const window = {
    bangkagoServices: { getClient: () => ({
      from: query,
      rpc: async (name, args) => {
        calls.push({ operation: 'rpc', name, args });
        return { data: null, error: null };
      },
    }) },
  };
  vm.runInNewContext(source, { window, Set, Number, String, Error, Promise });
  return { service: window.bangkagoIslandPackages, calls };
}

test('package saving validates the first-to-last route before inserting', async () => {
  const { service, calls } = loadService([]);
  await assert.rejects(
    service.savePackage(null, {
      packageName: 'Island Loop',
      price: 500,
      durationHours: 4,
      stops: ['mactan', 'olango'],
      isActive: true,
    }),
    /No active route/,
  );
  assert.equal(calls.some((call) => call.operation === 'insert'), false);
});

test('package saving persists itinerary and price without assigning a boat', async () => {
  const { service, calls } = loadService();
  await service.savePackage(null, {
    packageName: 'Island Loop',
    description: 'A real route',
    price: 500,
    durationHours: 4,
    stops: ['mactan', 'olango'],
    isActive: true,
  });
  const insert = calls.find((call) => call.operation === 'insert');
  assert.equal(insert.table, 'island_packages');
  assert.deepEqual(JSON.parse(JSON.stringify(insert.value)), {
    package_name: 'Island Loop',
    description: 'A real route',
    price: 500,
    duration_hours: 4,
    stops: ['mactan', 'olango'],
    is_active: true,
  });
});

test('rescheduling delegates to the database guard with the selected schedule', async () => {
  const { service, calls } = loadService();
  await service.rescheduleBooking('booking-1', '2026-11-20', '10:00');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), {
    operation: 'rpc',
    name: 'admin_reschedule_island_booking',
    args: {
      p_booking_id: 'booking-1',
      p_scheduled_date: '2026-11-20',
      p_scheduled_time: '10:00',
    },
  });
});

test('deleting a package uses the reversible admin RPC', async () => {
  const { service, calls } = loadService();
  await service.deletePackage('package-1');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), {
    operation: 'rpc',
    name: 'admin_delete_island_package',
    args: { p_package_id: 'package-1' },
  });
});

test('restoring a package does not require the former Bangka to remain eligible', async () => {
  const { service, calls } = loadService();
  await service.restorePackage('package-1');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), {
    operation: 'rpc',
    name: 'admin_restore_island_package',
    args: { p_package_id: 'package-1' },
  });
});

test('package listing is boat-agnostic — a package with no boat is still available', async () => {
  const { service } = loadService(undefined, [
    { id: 'boatless', package_name: 'Boatless Loop', price: 500, duration_hours: 4, stops: [], is_active: true },
    { id: 'inactive', package_name: 'Inactive Loop', price: 500, duration_hours: 4, stops: [], is_active: false },
  ]);
  const packages = await service.listPackages();
  assert.equal(packages[0].isActive, true);
  assert.equal(packages[0].assignmentEligible, undefined);
  assert.equal(packages[1].isActive, false);
});
