import { useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { colors, radii } from '../theme/tokens';
import type { PortDoc } from '../types/models';

interface Props {
  ports: PortDoc[];
  fromPortId?: string | null;
  toPortId?: string | null;
  height?: number;
  /** Edge-to-edge background mode: no border, no corner radius, absolute fill. */
  fill?: boolean;
  /** Tapping a port marker. Enables the invisible hit circles when provided. */
  onPortPress?: (port: PortDoc) => void;
  /** Highlighted independently of the from/to route pins. */
  selectedPortId?: string | null;
  /** Vessel positions to display as markers */
  vessels?: { latitude: number; longitude: number; speed?: number | null; bangkaId?: string }[];
  /**
   * One-finger drag to pan. Off for a map embedded in a ScrollView, where the
   * WebView would otherwise swallow the page's vertical scroll.
   */
  draggable?: boolean;
  /** Tiles or Leaflet itself failed to load — the caller swaps in SeaMap. */
  onFail?: () => void;
}

// Center of the Mactan-Olango corridor
const CENTER_LAT = 10.3157;
const CENTER_LNG = 124.0150;
const ZOOM = 11;
const MIN_ZOOM = 10;
// Was 15, which stopped short of seeing a pier at all. 17 is close enough to
// pick out the individual jetty you are being told to walk to.
const MAX_ZOOM = 17;
/*
 * There are deliberately no maxBounds any more.
 *
 * The old box spanned 0.20 degrees of longitude, but at zoom 11 a phone
 * viewport covers about 0.27 — wider than the box. Leaflet then has no legal
 * position for the centre and clamps it back on every drag, so panning either
 * did nothing (at viscosity 1.0) or sprang back (at 0.6). Sizing a bounds box
 * correctly means knowing the viewport, which varies per device, so any fixed
 * box reintroduces this on some phone.
 *
 * minZoom keeps the corridor from shrinking to a dot, and the recentre button
 * is the way back if you wander. Panning now works the same on every screen.
 */

/** Leaflet never showed up — almost always the CDN blocked on venue wifi. */
const LOAD_TIMEOUT_MS = 7000;

const MARKER_COLOR = colors.mapMarker;
const MARKER_ACTIVE_COLOR = colors.mapMarkerActive;
const ROUTE_COLOR = colors.primary;
const VESSEL_COLOR = colors.danger;

/**
 * The page is built from the PORT LIST ONLY.
 *
 * Selection, the route line and vessel positions used to be baked into this
 * string, which meant tapping a port produced a new html prop, reloaded the
 * WebView, and re-ran `setView` — so the map snapped back to the default
 * corridor and threw away whatever the passenger had panned or zoomed to.
 * Those now arrive through `window.__apply`, which redraws the markers and
 * never touches the view.
 */
function buildLeafletHTML(
  ports: PortDoc[],
  tappable: boolean,
  draggable: boolean,
): string {
  const validPorts = ports.filter((p) => p.latitude && p.longitude);

  /*
   * Ports are divIcons, not circleMarkers.
   *
   * A circleMarker is one flat disc, so "this is a port", "this is on your
   * route" and "this is the one you just tapped" could only be told apart by
   * swapping a fill colour and nudging a radius — three meanings carried by
   * one visual channel. A divIcon is real HTML, so each state gets its own
   * structure: a quiet ring when idle, a filled core on the route, and a
   * pulsing halo under the selected one.
   */
  // Ports are emitted once, with no state. `window.__apply` paints them.
  const portMarkers = validPorts.map((p) => {
    const label = p.portName.replace(/'/g, "\\'");
    const id = p.portId.replace(/'/g, "\\'");
    const behaviour = tappable
      ? `.on('click', function () { send({ type: 'portPress', portId: '${id}' }); })`
      : `.bindPopup('<b>${label}</b>')`;
    return `
      PORTS['${id}'] = { name: '${label}', marker:
        L.marker([${p.latitude}, ${p.longitude}], {
          icon: pinIcon('idle'), keyboard: false, riseOnHover: true
        }).addTo(map)${behaviour} };
    `;
  }).join('\n');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
      <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
      <style>
        html, body, #map {
          margin: 0; padding: 0; height: 100%; width: 100%;
          background: #dfe8ea;
        }
        /* Untouched OpenStreetMap tiles: the invert() filter this used to
         * carry made the sea almost black on a projector. */
        .leaflet-container { background: #dfe8ea; }
        .leaflet-control-attribution {
          font-size: 8px !important;
          background: rgba(255,255,255,0.85) !important;
          color: #3a4a50 !important;
          padding: 1px 5px !important;
        }
        .leaflet-control-attribution a { color: #1c5a66 !important; }
        .leaflet-popup-content-wrapper, .leaflet-popup-tip {
          background: ${colors.surface};
          color: ${colors.text};
          border: 1px solid ${colors.border};
          box-shadow: none;
        }
        .leaflet-popup-content { font-family: -apple-system, Roboto, sans-serif; font-size: 13px; }

        /* ---------- port pins ----------
         * Three states, three structures rather than three shades:
         *   idle  — hollow ring, reads as "a port exists here"
         *   route — filled core, reads as "this leg of your trip"
         *   sel   — filled core plus a pulsing halo, reads as "you tapped this"
         * The ring keeps a dark outline so a pin stays legible over both the
         * pale landmass and the dark water.
         */
        .pin { position: relative; width: 28px; height: 28px; }
        .pin i {
          position: absolute; left: 50%; top: 50%;
          transform: translate(-50%, -50%);
          border-radius: 50%;
          box-sizing: border-box;
        }
        .pin .core {
          width: 12px; height: 12px;
          border: 2px solid ${colors.bg};
          background: ${colors.bg};
        }
        .pin .ring {
          width: 22px; height: 22px;
          border: 1.5px solid ${MARKER_COLOR};
          background: rgba(10,22,32,0.45);
        }
        .pin--route .core, .pin--sel .core { background: ${MARKER_ACTIVE_COLOR}; }
        .pin--route .ring, .pin--sel .ring {
          border-color: ${MARKER_ACTIVE_COLOR};
          background: rgba(10,22,32,0.25);
        }
        .pin--sel .core { width: 14px; height: 14px; }
        .pin .pulse {
          width: 22px; height: 22px;
          background: ${MARKER_ACTIVE_COLOR};
          opacity: 0;
        }
        .pin--sel .pulse { animation: ping 1.8s ease-out infinite; }
        @keyframes ping {
          0%   { transform: translate(-50%, -50%) scale(0.75); opacity: 0.5; }
          70%  { transform: translate(-50%, -50%) scale(2.1);  opacity: 0; }
          100% { opacity: 0; }
        }

        /* A live boat, distinct from a fixed port: no ring, always pulsing. */
        .pin--vessel .core {
          width: 13px; height: 13px;
          background: ${VESSEL_COLOR};
          border-color: ${colors.text};
        }
        .pin--vessel .pulse {
          background: ${VESSEL_COLOR};
          animation: ping 1.6s ease-out infinite;
        }

        .portTip {
          background: ${colors.scrim};
          border: 1px solid ${colors.border};
          border-radius: 6px;
          color: ${colors.text};
          font-family: -apple-system, Roboto, sans-serif;
          font-size: 11px;
          font-weight: 600;
          padding: 2px 7px;
          box-shadow: none;
          white-space: nowrap;
        }
        .portTip::before { display: none; }
      </style>
    </head>
    <body>
      <div id="map"></div>
      <script>
        function send(payload) {
          if (window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage(JSON.stringify(payload));
          }
        }

        // Leaflet comes off a CDN. On a venue network that blocks it, every
        // line below throws and the map is a silent grey rectangle forever —
        // so say so instead, and let the caller fall back to the SVG chart.
        if (typeof L === 'undefined') {
          send({ type: 'failed', reason: 'leaflet-missing' });
        } else {
          // One factory for every pin, so a port and a boat can never drift
          // into two differently-built markers.
          function pinIcon(state) {
            var pulse = (state === 'sel' || state === 'vessel') ? '<i class="pulse"></i>' : '';
            var ring = state === 'vessel' ? '' : '<i class="ring"></i>';
            return L.divIcon({
              className: '',
              html: '<div class="pin pin--' + state + '">' + pulse + ring + '<i class="core"></i></div>',
              iconSize: [28, 28],
              iconAnchor: [14, 14],
              popupAnchor: [0, -14]
            });
          }

          try {
            var map = L.map('map', {
              zoomControl: false,
              attributionControl: true,
              minZoom: ${MIN_ZOOM},
              maxZoom: ${MAX_ZOOM},
              // Half-steps: pinching feels continuous rather than notched.
              zoomSnap: 0.5,
              zoomDelta: 0.5,
              touchZoom: true,
              doubleClickZoom: true,
              dragging: ${draggable}
            }).setView([${CENTER_LAT}, ${CENTER_LNG}], ${ZOOM});

            L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
              attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
              maxZoom: 19
            }).addTo(map);

            var PORTS = {}, ROUTE = null, VESSELS = [];
            ${portMarkers}

            /*
             * Repaint markers in place. Called on every selection change
             * instead of rebuilding the page, so the passenger's pan and
             * zoom survive a tap. Nothing here calls setView.
             */
            window.__apply = function (s) {
              Object.keys(PORTS).forEach(function (id) {
                var p = PORTS[id];
                var state = id === s.selected ? 'sel'
                  : (id === s.from || id === s.to) ? 'route' : 'idle';
                p.marker.setIcon(pinIcon(state));
                // Names only for the ports that matter right now; nine
                // permanent labels at zoom 11 overlap into a stack.
                if (p.marker.getTooltip()) p.marker.unbindTooltip();
                if (state !== 'idle') {
                  p.marker.bindTooltip(p.name, {
                    permanent: true, direction: 'top',
                    offset: [0, -14], className: 'portTip'
                  });
                }
              });

              if (ROUTE) { map.removeLayer(ROUTE); ROUTE = null; }
              if (s.line && s.line.length === 2) {
                ROUTE = L.polyline(s.line, {
                  color: '${ROUTE_COLOR}', weight: 3, dashArray: '8 6', opacity: 0.8
                }).addTo(map);
              }

              VESSELS.forEach(function (m) { map.removeLayer(m); });
              VESSELS = (s.vessels || []).map(function (v) {
                return L.marker([v.lat, v.lng], {
                  icon: pinIcon('vessel'), keyboard: false, zIndexOffset: 1000
                }).addTo(map).bindPopup('<b>' + v.label + '</b><br/>Speed: ' + v.speed);
              });
            };

            send({ type: 'ready' });
          } catch (e) {
            send({ type: 'failed', reason: String(e && e.message) });
          }
        }
      </script>
    </body>
    </html>
  `;
}

export function OSMMap({
  ports,
  fromPortId = null,
  toPortId = null,
  height = 200,
  fill = false,
  onPortPress,
  selectedPortId = null,
  vessels = [],
  draggable = true,
  onFail,
}: Props) {
  const webRef = useRef<WebView>(null);
  const failedRef = useRef(false);

  // Depends on the port list and the two static flags only. Selection is NOT
  // in here on purpose: adding it back would reload the page on every tap and
  // reset the view, which is the bug this shape exists to prevent.
  const html = useMemo(
    () => buildLeafletHTML(ports, !!onPortPress, draggable),
    [ports, onPortPress, draggable],
  );

  /** Marker state, pushed into the live page rather than re-rendered into it. */
  const applyState = useCallback(() => {
    const valid = ports.filter((p) => p.latitude && p.longitude);
    const from = valid.find((p) => p.portId === fromPortId);
    const to = valid.find((p) => p.portId === toPortId);
    const payload = {
      from: fromPortId,
      to: toPortId,
      selected: selectedPortId,
      line: from && to
        ? [[from.latitude, from.longitude], [to.latitude, to.longitude]]
        : null,
      vessels: vessels.map((v, i) => ({
        lat: v.latitude,
        lng: v.longitude,
        label: v.bangkaId ? v.bangkaId.slice(0, 8) : `Vessel ${i + 1}`,
        speed: v.speed != null ? `${v.speed.toFixed(1)} knots` : 'N/A',
      })),
    };
    webRef.current?.injectJavaScript(
      `window.__apply && window.__apply(${JSON.stringify(payload)}); true;`
    );
  }, [ports, fromPortId, toPortId, selectedPortId, vessels]);

  // Repaint whenever selection or vessel positions change.
  useEffect(() => { applyState(); }, [applyState]);

  /** Fires once — a tile error and a load timeout can both arrive. */
  const fail = useCallback(() => {
    if (failedRef.current) return;
    failedRef.current = true;
    onFail?.();
  }, [onFail]);

  // Nothing heard back from the page at all: the WebView itself never ran.
  const readyRef = useRef(false);
  useEffect(() => {
    const t = setTimeout(() => {
      if (!readyRef.current) fail();
    }, LOAD_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [fail]);

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    let msg: { type?: string; portId?: string; zoom?: number };
    try {
      msg = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (msg.type === 'ready') {
      // The page just finished building its markers; paint the current
      // selection into it. Anything injected before this is dropped.
      applyState();
      readyRef.current = true;
      return;
    }
    if (msg.type === 'failed') {
      fail();
      return;
    }
    // The prop was accepted but never wired, so tapping a pin on the real map
    // did nothing — the port callout only ever appeared on the SVG fallback.
    if (msg.type === 'portPress' && msg.portId) {
      const port = ports.find((p) => p.portId === msg.portId);
      if (port) onPortPress?.(port);
    }
  }, [ports, onPortPress, fail, applyState]);

  return (
    <View style={fill ? styles.fill : [styles.wrap, { height }]}>
      <WebView
        ref={webRef}
        source={{ html }}
        style={styles.webview}
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        onMessage={onMessage}
        onError={fail}
        onHttpError={fail}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radii.lg,
    overflow: 'hidden',
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  fill: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.bgElevated,
  },
  webview: {
    flex: 1,
    backgroundColor: colors.bgElevated,
  },
});
