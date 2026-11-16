/**
 * Shared realtime manager — web/assets/js/services/realtime.js
 *
 * The admin dashboard's "Realtime Feed" badge is built from getStatuses(),
 * so this file must (a) keep recording the join status of every channel,
 * (b) announce changes, and (c) leave the existing queued-attach and
 * debounced-callback behaviour untouched — ~20 dashboard pages share it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'assets', 'js', 'services', 'realtime.js'), 'utf8');

// getStatuses() hands back a vm-realm object; deepStrictEqual would reject it
// on prototype identity, so assertions compare a host-side copy.
const plain = (obj) => Object.assign({}, obj);

function makeEnv() {
  const state = {
    client: null,
    events: [],
    listeners: {},
    timeouts: [],
    intervals: [],
    channelNames: [],
    statusCb: null,
    dataCbs: [],
    unsubscribed: 0,
    timerId: 0,
  };

  const window = {
    bangkagoServices: { getClient: () => state.client },
    addEventListener: (name, cb) => { state.listeners[name] = cb; },
    dispatchEvent: (ev) => { state.events.push(ev.type); },
  };

  const ctx = {
    console,
    window,
    CustomEvent: class CustomEvent {
      constructor(type, init) { this.type = type; this.detail = init && init.detail; }
    },
    setInterval: (fn, ms) => { state.intervals.push({ fn, ms }); return state.intervals.length; },
    clearInterval: () => {},
    setTimeout: (fn, ms) => {
      const id = ++state.timerId;
      state.timeouts.push({ id, fn, ms });
      return id;
    },
    clearTimeout: (id) => { state.timeouts = state.timeouts.filter((t) => t.id !== id); },
  };

  vm.createContext(ctx);
  vm.runInContext(SOURCE, ctx, { filename: 'realtime.js' });
  // Drop the script's own 30 s cleanup timer so tests only see the timers
  // they trigger themselves.
  state.timeouts = [];

  // Client that hands back one channel object per attach(), like supabase-js.
  state.attachClient = () => ({
    channel(name) {
      state.channelNames.push(name);
      return {
        on(type, filter, cb) { state.dataCbs.push(cb); return this; },
        subscribe(cb) { state.statusCb = cb; return this; },
        unsubscribe() { state.unsubscribed++; },
      };
    },
  });

  state.window = window;
  return state;
}

test('a subscription made before the client exists stays queued, then reports its status', () => {
  const s = makeEnv();
  const rt = s.window.bangkagoRealtime;

  const key = rt.subscribe('bookings', null, () => {});
  assert.equal(key, 'bookings:all');
  assert.deepEqual(plain(rt.getStatuses()), {}, 'no status before any channel exists');
  assert.equal(s.statusCb, null, 'the guard has not handed over a client yet');

  // The guard finishes loading config + client, then fires auth-ready.
  s.client = s.attachClient();
  s.listeners['bangkago-auth-ready']();

  assert.deepEqual(s.channelNames, ['web-bookings_all'], 'queued subscription attached on auth-ready');
  assert.deepEqual(plain(rt.getStatuses()), {}, 'still unknown until the socket answers');

  s.statusCb('SUBSCRIBED');
  assert.deepEqual(plain(rt.getStatuses()), { 'bookings:all': 'SUBSCRIBED' });
  assert.ok(s.events.includes('bangkago-realtime-status'), 'a status change is announced to the page');

  s.statusCb('CHANNEL_ERROR');
  assert.deepEqual(plain(rt.getStatuses()), { 'bookings:all': 'CHANNEL_ERROR' }, 'the latest status wins on rejoin');
});

test('getStatuses() hands out a copy the caller cannot corrupt', () => {
  const s = makeEnv();
  s.client = s.attachClient();
  const rt = s.window.bangkagoRealtime;
  rt.subscribe('vessel_tracking', null, () => {});
  s.statusCb('SUBSCRIBED');

  const copy = rt.getStatuses();
  copy['vessel_tracking:all'] = 'CHANNEL_ERROR';
  delete copy['vessel_tracking:all'];

  assert.equal(rt.getStatuses()['vessel_tracking:all'], 'SUBSCRIBED');
});

test('unsubscribe() drops the channel and its status together', () => {
  const s = makeEnv();
  s.client = s.attachClient();
  const rt = s.window.bangkagoRealtime;
  rt.subscribe('safety_alerts', null, () => {});
  s.statusCb('SUBSCRIBED');

  rt.unsubscribe('safety_alerts:all');
  assert.equal(s.unsubscribed, 1);
  assert.deepEqual(plain(rt.getStatuses()), {}, 'unsubscribed channels must not read as live');
});

test('data callbacks still fire once per debounced burst through the changed chain', () => {
  const s = makeEnv();
  s.client = s.attachClient();
  const rt = s.window.bangkagoRealtime;

  let calls = 0;
  rt.subscribe('downpayments', null, () => { calls++; });
  s.statusCb('SUBSCRIBED');

  s.dataCbs[0]({ eventType: 'INSERT' });
  s.dataCbs[0]({ eventType: 'INSERT' });
  assert.equal(s.timeouts.length, 1, 'bursts coalesce into one pending reload');
  s.timeouts[0].fn();

  assert.equal(calls, 1, 'the reload callback runs exactly once');
  assert.equal(rt.getStatuses()['downpayments:all'], 'SUBSCRIBED', 'a data event does not disturb the status');
});
