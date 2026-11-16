/**
 * Live sea-weather strip from Open-Meteo — no API key, free for
 * non-commercial use, CC BY 4.0 (keep the credit line).
 *
 * Two consumers, one fetch:
 *   [data-sea-weather]  → renders a full card into the element
 *   #kpiWeather         → fills the coastguard dashboard's Weather KPI
 *   window.bangkagoSeaWeather.getLive(lat, lon) → dashboards that need it
 */
(function () {
  'use strict';

  var TTL = 15 * 60 * 1000;
  var CACHE_PREFIX = 'bangkago:seaWeather:v2:';
  var DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

  var el = document.querySelector('[data-sea-weather]');
  var kpi = document.getElementById('kpiWeather');

  var lat = Number((el && el.dataset.lat) || 10.27);
  var lon = Number((el && el.dataset.lon) || 124.03);
  var place = (el && el.dataset.place) || 'Mactan\u2013Olango';

  function describe(code) {
    var WMO = {
      0: 'Clear sky', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast',
      45: 'Fog', 48: 'Freezing fog',
      51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
      61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
      80: 'Light showers', 81: 'Rain showers', 82: 'Heavy showers',
      95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Severe thunderstorm'
    };
    return WMO[code] || (code >= 51 ? 'Rain' : 'Cloudy');
  }

  // Same thresholds as the app's WeatherCard: 25 km/h or 1 m is "take care",
  // 40 km/h or 1.5 m is "consider delaying".
  function advice(label, wind, wave) {
    if (/thunderstorm/i.test(label) || (wind != null && wind >= 40) || (wave != null && wave >= 1.5)) {
      return { cls: 'text-danger', text: 'Rough sea \u2014 consider delaying the trip.' };
    }
    if ((wind != null && wind >= 25) || (wave != null && wave >= 1)) {
      return { cls: 'text-warning', text: 'Choppy \u2014 sail with care, life jackets on.' };
    }
    if (wind == null) {
      return { cls: 'text-muted', text: 'Wind speed unavailable \u2014 check conditions before sailing.' };
    }
    if (wave == null) {
      return { cls: 'text-muted', text: 'Light wind \u2014 good to sail. Wave height unavailable.' };
    }
    return { cls: 'text-success', text: 'Calm sea, light wind \u2014 good to sail.' };
  }

  function num(value, digits) {
    if (typeof value !== 'number' || !isFinite(value)) return null;
    var scale = Math.pow(10, digits == null ? 0 : digits);
    return Math.round(value * scale) / scale;
  }

  function display(value, suffix) {
    return value == null ? '\u2014' : value + suffix;
  }

  function paint(w, stale) {
    var waves = w.wave == null ? 'waves n/a' : w.wave + ' m waves';
    var tip = advice(w.label, w.wind, w.wave);
    if (kpi) {
      kpi.textContent = display(w.temp, '\u00B0C') + ' \u00B7 ' + w.label;
      var detail = document.getElementById('kpiWeatherDetail');
      if (detail) detail.textContent = 'Wind ' + display(w.wind, ' km/h') + ' ' + w.dir + ' \u00B7 ' + waves;
      return;
    }
    el.innerHTML =
      '<div class="d-flex flex-wrap align-items-center gap-3">' +
        '<div>' +
          '<div class="text-muted small">SEA WEATHER \u00B7 ' + place + '</div>' +
          '<div style="font-size:1.35rem;font-weight:700">' +
            display(w.temp, '\u00B0C') + ' \u00B7 ' + w.label +
          '</div>' +
        '</div>' +
        '<div class="ms-auto text-end small">' +
          'Wind ' + display(w.wind, ' km/h') + ' ' + w.dir + '<br>' + waves +
        '</div>' +
      '</div>' +
      '<div class="' + tip.cls + ' small fw-semibold mt-2">' + tip.text + '</div>' +
      '<div class="text-muted" style="font-size:10px;margin-top:4px">' +
        (stale ? 'Cached reading \u00B7 ' : '') +
        'Weather data by <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>' +
      '</div>';
  }

  function failed() {
    if (kpi) {
      kpi.textContent = 'Unavailable';
      var detail = document.getElementById('kpiWeatherDetail');
      if (detail) detail.textContent = 'Retrying shortly';
    } else if (el) {
      el.innerHTML = '<div class="text-muted small">Sea weather unavailable</div>';
    }
  }

  function cacheKey(la, lo) {
    return CACHE_PREFIX + Number(la).toFixed(2) + ':' + Number(lo).toFixed(2);
  }

  function readCache(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || 'null');
    } catch (e) {
      return null;
    }
  }

  async function json(url) {
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 8000) : null;
    try {
      var res = await fetch(url, controller ? { signal: controller.signal } : undefined);
      if (!res.ok) throw new Error('weather ' + res.status);
      return await res.json();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function fetchLive(la, lo, opts) {
    opts = opts || {};
    var key = cacheKey(la, lo);
    var cached = readCache(key);
    if (cached && Date.now() - cached.at < TTL) {
      return cached;
    }

    try {
      var out = await Promise.all([
        json('https://api.open-meteo.com/v1/forecast?latitude=' + la + '&longitude=' + lo +
          '&current=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,' +
          'relative_humidity_2m,visibility'),
        json('https://marine-api.open-meteo.com/v1/marine?latitude=' + la + '&longitude=' + lo +
          '&current=wave_height').catch(function () { return null; })
      ]);
      var cur = (out[0] && out[0].current) || {};
      var wave = out[1] && out[1].current && out[1].current.wave_height;
      var deg = Number(cur.wind_direction_10m);
      var w = {
        temp: num(cur.temperature_2m, 0),
        label: describe(Number(cur.weather_code || 0)),
        wind: num(cur.wind_speed_10m, 0),
        dir: isFinite(deg) ? DIRS[Math.round(deg / 45) % 8] : '\u2014',
        wave: typeof wave === 'number' ? Math.round(wave * 10) / 10 : null,
        visibility: num(cur.visibility == null ? null : cur.visibility / 1000, 1),
        humidity: num(cur.relative_humidity_2m, 0),
        at: Date.now()
      };
      try { localStorage.setItem(key, JSON.stringify(w)); } catch (e) { /* ignore */ }
      return w;
    } catch (e) {
      if (cached && opts.allowStale !== false) {
        return Object.assign({}, cached, { stale: true });
      }
      throw e;
    }
  }

  async function load() {
    try {
      var w = await fetchLive(lat, lon, { allowStale: true });
      paint(w, w.stale === true);
    } catch (e) {
      failed();
    }
  }

  if (el || kpi) {
    load();
    setInterval(load, TTL);
  }

  window.bangkagoSeaWeather = {
    getLive: function (la, lo, opts) {
      return fetchLive(Number(la), Number(lo), opts);
    },
    point: { lat: lat, lon: lon, place: place }
  };
})();
