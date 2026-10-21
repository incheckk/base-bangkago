/**
 * Weather data service for web dashboards.
 * Queries weather_data table.
 */
(function() {
  'use strict';
  var svc = window.bangkagoServices;

  function mapWeather(row) {
    return {
      id: row.id,
      portId: row.port_id,
      windSpeed: row.wind_speed,
      waveHeight: row.wave_height,
      weatherCondition: row.weather_condition,
      isSafe: row.is_safe,
      recordedAt: row.recorded_at,
      // joined port
      portName: row.ports?.port_name ?? null
    };
  }

  function manilaDayRange(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid weather date');
    var start = new Date(date + 'T00:00:00+08:00');
    if (isNaN(start.getTime())) throw new Error('Invalid weather date');
    return { start: start.toISOString(), end: new Date(start.getTime() + 86400000).toISOString() };
  }

  async function listAll(filters) {
    filters = filters || {};
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var q = c.from('weather_data').select('*, ports(port_name)');
    if (filters.portId) q = q.eq('port_id', filters.portId);
    if (filters.isSafe !== undefined) q = q.eq('is_safe', filters.isSafe);
    if (filters.date) {
      var range = manilaDayRange(filters.date);
      q = q.gte('recorded_at', range.start).lt('recorded_at', range.end);
    }
    q = q.order('recorded_at', { ascending: false });
    if (filters.limit) q = q.limit(filters.limit);
    var r = await q;
    if (r.error) throw r.error;
    return (r.data || []).map(mapWeather);
  }

  async function getLatestByPort(portId) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var r = await c.from('weather_data').select('*, ports(port_name)').eq('port_id', portId).order('recorded_at', { ascending: false }).limit(1).maybeSingle();
    if (r.error) throw r.error;
    return r.data ? mapWeather(r.data) : null;
  }

  async function getAllLatest() {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    // Get latest weather for each port
    var r = await c.from('weather_data').select('*, ports(port_name)').order('recorded_at', { ascending: false });
    if (r.error) throw r.error;
    var seen = new Set();
    var latest = [];
    for (var row of r.data || []) {
      if (!seen.has(row.port_id)) {
        seen.add(row.port_id);
        latest.push(mapWeather(row));
      }
    }
    return latest;
  }

  window.bangkagoWeather = { listAll, getLatestByPort, getAllLatest };
})();