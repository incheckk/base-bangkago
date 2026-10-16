/**
 * Shared realtime subscription manager for web dashboards.
 */
(function() {
  'use strict';
  var svc = window.bangkagoServices;
  var channels = {};

  function subscribe(table, filter, callback) {
    var c = svc.getClient(); if (!c) return null;
    var key = table + ':' + (filter || 'all');
    if (channels[key]) { channels[key].callbacks.push(callback); return key; }
    var channel = c.channel('web-' + key.replace(/[^a-z0-9_]/gi, '_'));
    channel.on('postgres_changes', { event: '*', schema: 'public', table: table, filter: filter }, function(payload) {
      channels[key].callbacks.forEach(function(cb) { cb(payload); });
    }).subscribe();
    channels[key] = { channel: channel, callbacks: [callback] };
    return key;
  }

  function unsubscribe(key) {
    if (channels[key]) { channels[key].channel.unsubscribe(); delete channels[key]; }
  }

  function unsubscribeAll() { Object.keys(channels).forEach(unsubscribe); }

  window.bangkagoRealtime = { subscribe, unsubscribe, unsubscribeAll };
})();