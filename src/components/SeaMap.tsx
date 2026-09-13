import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Ellipse, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { colors, radii } from '../theme/tokens';
import type { PortDoc } from '../types/models';

/**
 * Static chart of the Mactan–Olango corridor. No tiles, no API key, no location
 * permission — it cannot fail on venue wifi, which is the whole point.
 *
 * Port coordinates (latitude/longitude) are normalized to 0–1 for the SVG
 * viewBox. Coastlines are hand-fitted Béziers, not real geometry.
 */

const ISLANDS: { name: string; d: string; labelX: number; labelY: number }[] = [
  {
    name: 'MACTAN',
    d: 'M -6 4 C 10 0, 26 11, 28 24 C 30 36, 24 47, 24 56 C 22 67, 8 72, -6 68 Z',
    labelX: 9,
    labelY: 36,
  },
  {
    name: 'OLANGO',
    d: 'M 46 25 C 53 21, 64 24, 68 32 C 71 39, 66 47, 58 49 C 50 51, 43 44, 43 36 C 43 30, 44 27, 46 25 Z',
    labelX: 55,
    labelY: 43,
  },
  {
    name: 'CAOHAGAN',
    d: 'M 61 68 C 63 64, 69 65, 71 69 C 73 73, 69 77, 65 75 C 62 74, 60 71, 61 68 Z',
    labelX: 66,
    labelY: 80,
  },
  {
    name: 'NALUSUAN',
    d: 'M 75 56 C 77 52, 83 53, 85 57 C 86 61, 82 64, 79 62 C 76 61, 74 59, 75 56 Z',
    labelX: 80,
    labelY: 68,
  },
];

const SHALLOWS: { cx: number; cy: number; rx: number; ry: number }[] = [
  { cx: 10, cy: 36, rx: 30, ry: 40 },
  { cx: 55, cy: 37, rx: 21, ry: 19 },
  { cx: 66, cy: 71, rx: 11, ry: 9 },
  { cx: 80, cy: 58, rx: 10, ry: 8 },
];

/** Normalize lat/lng to 0–1 for SVG positioning. */
function normalizeCoord(
  lat: number, lng: number,
  minLat: number, maxLat: number,
  minLng: number, maxLng: number,
): { x: number; y: number } {
  const x = maxLng === minLng ? 0.5 : (lng - minLng) / (maxLng - minLng);
  const y = maxLat === minLat ? 0.5 : 1 - (lat - minLat) / (maxLat - minLat); // flip Y so north is up
  return { x: x * 100, y: y * 100 };
}

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
}

export function SeaMap({
  ports,
  fromPortId = null,
  toPortId = null,
  height = 200,
  fill = false,
  onPortPress,
  selectedPortId = null,
}: Props) {
  // Compute bounds from port coordinates
  const lats = ports.map((p) => p.latitude ?? 0).filter(Boolean);
  const lngs = ports.map((p) => p.longitude ?? 0).filter(Boolean);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  const from = ports.find((p) => p.portId === fromPortId) ?? null;
  const to = ports.find((p) => p.portId === toPortId) ?? null;

  const fromPos = from?.latitude && from?.longitude
    ? normalizeCoord(from.latitude, from.longitude, minLat, maxLat, minLng, maxLng)
    : null;
  const toPos = to?.latitude && to?.longitude
    ? normalizeCoord(to.latitude, to.longitude, minLat, maxLat, minLng, maxLng)
    : null;

  return (
    <View style={fill ? styles.fill : [styles.wrap, { height }]}>
      <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
        <Rect x="0" y="0" width="100" height="100" fill={colors.bgElevated} />

        {SHALLOWS.map((s, i) => (
          <Ellipse
            key={i}
            cx={s.cx}
            cy={s.cy}
            rx={s.rx}
            ry={s.ry}
            fill={colors.primary}
            opacity={0.06}
          />
        ))}

        {ISLANDS.map((island) => (
          <G key={island.name}>
            <Path d={island.d} fill={colors.surfaceAlt} stroke={colors.border} strokeWidth={0.5} />
            <SvgText
              x={island.labelX}
              y={island.labelY}
              fill={colors.textMuted}
              fontSize={3}
              fontWeight="700"
              textAnchor="middle"
              letterSpacing={0.6}
            >
              {island.name}
            </SvgText>
          </G>
        ))}

        {fromPos && toPos && (
          <Line
            x1={fromPos.x}
            y1={fromPos.y}
            x2={toPos.x}
            y2={toPos.y}
            stroke={colors.primary}
            strokeWidth={0.9}
            strokeDasharray="2.5 2"
            strokeLinecap="round"
          />
        )}

        {ports.map((p) => {
          if (!p.latitude || !p.longitude) return null;
          const pos = normalizeCoord(p.latitude, p.longitude, minLat, maxLat, minLng, maxLng);
          const onRoute = p.portId === fromPortId || p.portId === toPortId;
          const selected = p.portId === selectedPortId;
          const active = onRoute || selected;
          const right = pos.x > 62;

          return (
            <G key={p.portId}>
              {active && <Circle cx={pos.x} cy={pos.y} r={4} fill={colors.primary} opacity={0.22} />}
              {selected && (
                <Circle
                  cx={pos.x} cy={pos.y} r={6}
                  fill="none" stroke={colors.primary} strokeWidth={0.5} opacity={0.6}
                />
              )}
              <Circle
                cx={pos.x}
                cy={pos.y}
                r={active ? 2 : 1.5}
                fill={active ? colors.primary : colors.textSecondary}
                stroke={colors.bgElevated}
                strokeWidth={0.6}
              />
              <SvgText
                x={right ? pos.x - 3.4 : pos.x + 3.4}
                y={pos.y + 1.1}
                fill={active ? colors.text : colors.textSecondary}
                fontSize={3.1}
                fontWeight={active ? '700' : '400'}
                textAnchor={right ? 'end' : 'start'}
              >
                {p.portName}
              </SvgText>
              {/* A 1.5-unit pin is far below a fingertip. This invisible disc is
                  the real tap target — roughly 40pt on a phone-width viewBox. */}
              {onPortPress && (
                <Circle
                  cx={pos.x} cy={pos.y} r={7}
                  fill="transparent"
                  onPress={() => onPortPress(p)}
                />
              )}
            </G>
          );
        })}
      </Svg>
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
});
