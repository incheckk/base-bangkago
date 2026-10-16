/**
 * Shared Leaflet + OpenStreetMap fleet map for the web dashboards.
 * Mirrors src/components/OSMMap.tsx — Leaflet 1.9.4 and OSM tiles are
 * vendored under assets/vendor (no CDN on venue wifi; tiles are the one
 * thing that still needs the internet, which the demo already assumes).
 *
 * Usage (pages at BangkaGO-WEB/{admin,coastguard}-dashboard/ depth):
 *   const map = await window.bangkagoFleetMap.mount('fleetMap');
 *   map.update([{ id, name, lat, lng, signal, speed, last, dest }]);
 *   map.panTo(bangkaId);
 */
(function () {
  'use strict';

  // Resolved against the PAGE url — true for both dashboards (both are
  // two levels under the web/ server root, where assets/ lives).
  var LEAFLET_CSS = '../../assets/vendor/leaflet/css/leaflet.css';
  var LEAFLET_JS = '../../assets/vendor/leaflet/js/leaflet.js';

  // Mactan / Olango, Cebu
  var CENTER = [10.315, 123.90];
  var SIGNAL_COLORS = { Stable: '#198754', Intermittent: '#ffc107', Lost: '#dc3545', Unknown: '#6c757d' };

  // Self-contained styling so every page renders the same map chrome.
  var style = document.createElement('style');
  style.textContent =
    '.fleet-map{height:420px;border-radius:12px;overflow:hidden;background:#e9ecef;margin-top:.75rem;}' +
    '.fleet-dot-wrap{background:transparent!important;border:none!important;}' +
    '.fleet-dot{display:block;width:14px;height:14px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.4);}';
  document.head.appendChild(style);

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  var loading = null;
  function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (loading) return loading;
    loading = new Promise(function (resolve, reject) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = LEAFLET_CSS;
      document.head.appendChild(link);
      var s = document.createElement('script');
      s.src = LEAFLET_JS;
      s.onload = function () { resolve(window.L); };
      s.onerror = function () { loading = null; reject(new Error('Leaflet failed to load')); };
      document.head.appendChild(s);
    });
    return loading;
  }

  /** @returns {Promise<{update:Function, panTo:Function, destroy:Function}>} */
  function mount(container) {
    return loadLeaflet().then(function (L) {
      var el = typeof container === 'string' ? document.getElementById(container) : container;
      if (!el) throw new Error('fleet-map: container not found');
      el.classList.add('fleet-map');

      var map = L.map(el).setView(CENTER, 11);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }).addTo(map);

      var markers = {};
      var fitted = false;

      function icon(signal) {
        return L.divIcon({
          className: 'fleet-dot-wrap',
          html: '<span class="fleet-dot" style="background:' + (SIGNAL_COLORS[signal] || SIGNAL_COLORS.Unknown) + '"></span>',
          iconSize: [16, 16],
          iconAnchor: [8, 8]
        });
      }

      function popup(it) {
        return '<strong>' + esc(it.name) + '</strong>' +
          '<br>Signal: ' + esc(it.signal || 'Unknown') +
          (it.speed ? '<br>Speed: ' + esc(it.speed) : '') +
          (it.last ? '<br>Last seen: ' + esc(it.last) : '') +
          (it.dest ? '<br>' + esc(it.dest) : '');
      }

      return {
        update: function (items) {
          var seen = {};
          (items || []).forEach(function (it) {
            if (!it || typeof it.lat !== 'number' || typeof it.lng !== 'number') return;
            seen[it.id] = true;
            if (markers[it.id]) {
              markers[it.id].setLatLng([it.lat, it.lng]);
              markers[it.id].setIcon(icon(it.signal));
              markers[it.id].setPopupContent(popup(it));
            } else {
              markers[it.id] = L.marker([it.lat, it.lng], { icon: icon(it.signal) })
                .addTo(map).bindPopup(popup(it));
            }
          });
          Object.keys(markers).forEach(function (id) {
            if (!seen[id]) { map.removeLayer(markers[id]); delete markers[id]; }
          });
          if (!fitted && Object.keys(markers).length) {
            map.fitBounds(
              L.latLngBounds(Object.keys(markers).map(function (id) { return markers[id].getLatLng(); })),
              { padding: [30, 30], maxZoom: 13 }
            );
            fitted = true;
          }
        },
        panTo: function (id) {
          var m = markers[id];
          if (m) { map.setView(m.getLatLng(), Math.max(map.getZoom(), 13)); m.openPopup(); }
        },
        destroy: function () { map.remove(); }
      };
    });
  }

  window.bangkagoFleetMap = { mount: mount };
})();
