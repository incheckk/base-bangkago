const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '../../web/assets/js/services/island-packages.js'),
  'utf8',
);

function loadService(routes = [{ id: 'mactan__olango', is_active: true }]) {
  const calls = [];
  const datasets = {
    ports: [{ id: 'mactan', is_active: true }, { id: 'olango', is_active: true }],
    routes,
  };
  function query(table) {
    const result = { data: datasets[table] || [], error: null };
    const builder = {
      select: () => builder,
      order: () => builder,
      eq: () => builder,
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
      maxCapacity: 8,
      durationHours: 4,
      bangkaId: 'boat-1',
      stops: ['mactan', 'olango'],
      isActive: true,
    }),
    /No active route/,
  );
  assert.equal(calls.some((call) => call.operation === 'insert'), false);
});

test('package saving persists validated assignment, itinerary, capacity and price', async () => {
  const { service, calls } = loadService();
  await service.savePackage(null, {
    packageName: 'Island Loop',
    description: 'A real route',
    price: 500,
    maxCapacity: 8,
    durationHours: 4,
    bangkaId: 'boat-1',
    stops: ['mactan', 'olango'],
    isActive: true,
  });
  const insert = calls.find((call) => call.operation === 'insert');
  assert.equal(insert.table, 'island_packages');
  assert.deepEqual(JSON.parse(JSON.stringify(insert.value)), {
    package_name: 'Island Loop',
    description: 'A real route',
    price: 500,
    max_capacity: 8,
    duration_hours: 4,
    stops: ['mactan', 'olango'],
    bangka_id: 'boat-1',
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
