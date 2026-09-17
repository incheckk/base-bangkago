import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

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
}

// Center of the Mactan-Olango corridor
const CENTER_LAT = 10.3157;
const CENTER_LNG = 124.0150;
const ZOOM = 11;
const MIN_ZOOM = 10;
const MAX_ZOOM = 15;
// Hard bounds: Lapu-Lapu + Olango islands with padding
const BOUNDS: [[number, number], [number, number]] = [[10.22, 123.92], [10.40, 124.12]];

const MARKER_COLOR = '#FFD700'; // Yellow markers
const MARKER_ACTIVE_COLOR = '#FFA500'; // Orange for active/selected
const ROUTE_COLOR = '#34D6B0'; // Teal for route lines
const VESSEL_COLOR = '#E05252'; // Red for vessel positions

function buildLeafletHTML(
  ports: PortDoc[],
  fromPortId: string | null,
  toPortId: string | null,
  selectedPortId: string | null,
  vessels: { latitude: number; longitude: number; speed?: number | null; bangkaId?: string }[],
): string {
  const validPorts = ports.filter((p) => p.latitude && p.longitude);

  const portMarkers = validPorts.map((p) => {
    const isOnRoute = p.portId === fromPortId || p.portId === toPortId;
    const isSelected = p.portId === selectedPortId;
    const isActive = isOnRoute || isSelected;
    const color = isActive ? MARKER_ACTIVE_COLOR : MARKER_COLOR;
    const radius = isActive ? 10 : 7;
    const label = p.portName.replace(/'/g, "\\'");
    return `
      L.circleMarker([${p.latitude}, ${p.longitude}], {
        radius: ${radius},
        fillColor: '${color}',
        color: '#0A1620',
        weight: 2,
        opacity: 1,
        fillOpacity: 0.85
      }).addTo(map).bindPopup('<b>${label}</b>');
    `;
  }).join('\n');

  // Route line between selected ports
  const from = validPorts.find((p) => p.portId === fromPortId);
  const to = validPorts.find((p) => p.portId === toPortId);
  const routeLine = from && to
    ? `L.polyline([[${from.latitude}, ${from.longitude}], [${to.latitude}, ${to.longitude}]], {
        color: '${ROUTE_COLOR}', weight: 3, dashArray: '8 6', opacity: 0.8
      }).addTo(map);`
    : '';

  // Vessel position markers
  const vesselMarkers = vessels.map((v, i) => {
    const speedLabel = v.speed != null ? `${v.speed.toFixed(1)} knots` : 'N/A';
    const idLabel = v.bangkaId ? v.bangkaId.slice(0, 8) : `Vessel ${i + 1}`;
    return `
      L.circleMarker([${v.latitude}, ${v.longitude}], {
        radius: 8,
        fillColor: '${VESSEL_COLOR}',
        color: '#FFFFFF',
        weight: 2,
        opacity: 1,
        fillOpacity: 0.9
      }).addTo(map).bindPopup('<b>${idLabel}</b><br/>Speed: ${speedLabel}');
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
        html, body, #map { margin: 0; padding: 0; height: 100%; width: 100%; }
        .leaflet-control-attribution { font-size: 8px !important; }
        .leaflet-tile-pane { filter: saturate(0.55) brightness(1.05) contrast(1.05); }
      </style>
    </head>
    <body>
      <div id="map"></div>
      <script>
        var map = L.map('map', {
          zoomControl: false,
          attributionControl: true,
          minZoom: ${MIN_ZOOM},
          maxZoom: ${MAX_ZOOM},
          maxBounds: ${JSON.stringify(BOUNDS)},
          maxBoundsViscosity: 1.0
        }).setView([${CENTER_LAT}, ${CENTER_LNG}], ${ZOOM});

        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          maxZoom: 18
        }).addTo(map);

        ${portMarkers}
        ${routeLine}
        ${vesselMarkers}
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
}: Props) {
  const html = useMemo(
    () => buildLeafletHTML(ports, fromPortId, toPortId, selectedPortId, vessels),
    [ports, fromPortId, toPortId, selectedPortId, vessels],
  );

  return (
    <View style={fill ? styles.fill : [styles.wrap, { height }]}>
      <WebView
        source={{ html }}
        style={styles.webview}
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        onError={() => {}}
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
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.bgElevated,
  },
  webview: {
    flex: 1,
    backgroundColor: colors.bgElevated,
  },
});
