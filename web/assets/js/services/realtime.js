/**
 * Shared realtime subscription manager for web dashboards.
 *
 * Fixes over the original:
 *  1. QUEUED ATTACH — pages call subscribe() while the auth guard is
 *     still loading config.js/UMD/client (getClient() null at parse
 *     time). Those calls used to silently no-op, so "live" pages
 *     never refreshed. Now they queue and attach once the client
 *     exists (flushed by the timer below or by bangkago-auth-ready).
 *  2. DEBOUNCE — a venue-wifi GPS stream fires vessel_tracking
 *     events many times a second; each callback used to trigger a
 *     full data reload. Callbacks are now coalesced per key.
 *  3. STATUS — the last join status of every channel is kept and
 *     announced, so a page can show whether its live feed is really
 *     subscribed instead of guessing. getStatuses() reads a copy.
 */
(function() {
  'use strict';
  var svc = window.bangkagoServices;
  var channels = {};
  var pending = [];
  var timers = {};
  var statuses = {};

  function attach(table, filter, callback) {
    var c = svc.getClient(); if (!c) return null;
    var key = table + ':' + (filter || 'all');
    if (channels[key]) { channels[key].callbacks.push(callback); return key; }
    var channel = c.channel('web-' + key.replace(/[^a-z0-9_]/gi, '_'));
    channel.on('postgres_changes', { event: '*', schema: 'public', table: table, filter: filter }, function(payload) {
      // Coalesce bursts (GPS pings, rapid edits) into one reload.
      if (timers[key]) clearTimeout(timers[key]);
      timers[key] = setTimeout(function() {
        timers[key] = null;
        channels[key].callbacks.forEach(function(cb) { cb(payload); });
      }, 400);
    }).subscribe(function(status) {
      // Latest join status only (SUBSCRIBED / CHANNEL_ERROR / TIMED_OUT /
      // CLOSED); re-joins overwrite it, so the map is never stale.
      statuses[key] = status;
      window.dispatchEvent(new CustomEvent('bangkago-realtime-status'));
    });
    channels[key] = { channel: channel, callbacks: [callback] };
    return key;
  }

  function subscribe(table, filter, callback) {
    var key = table + ':' + (filter || 'all');
    if (!svc.getClient()) {
      pending.push([table, filter, callback]);
      return key;
    }
    return attach(table, filter, callback);
  }

  function flush() {
    var queue = pending; pending = [];
    queue.forEach(function(args) { attach(args[0], args[1], args[2]); });
  }
  // The guard loads the client asynchronously after this script
  // parses; poll cheaply until it exists, then attach everything.
  var flushTimer = setInterval(function() {
    if (!svc.getClient()) return;
    clearInterval(flushTimer);
    flush();
  }, 200);
  setTimeout(function() { clearInterval(flushTimer); }, 30000);
  window.addEventListener('bangkago-auth-ready', flush);

  function unsubscribe(key) {
    if (channels[key]) { channels[key].channel.unsubscribe(); delete channels[key]; delete statuses[key]; }
  }

  function unsubscribeAll() { Object.keys(channels).forEach(unsubscribe); }

  function getStatuses() { return Object.assign({}, statuses); }

  window.bangkagoRealtime = { subscribe, unsubscribe, unsubscribeAll, getStatuses };
})();
