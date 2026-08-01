import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Ellipse, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { colors, radii } from '../theme/tokens';
import type { PierDoc } from '../types/models';

/**
 * Static chart of the Mactan–Olango corridor. No tiles, no API key, no location
 * permission — it cannot fail on venue wifi, which is the whole point.
 *
 * Coordinates are the 0–1 mapX/mapY on each pier doc, drawn into a 100×100
 * viewBox. Coastlines are hand-fitted Béziers, not real geometry: this is a
 * schematic for choosing piers, not a navigational chart.
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

// Shallow-water halos, drawn under the landmasses to suggest reef and depth.
const SHALLOWS: { cx: number; cy: number; rx: number; ry: number }[] = [
  { cx: 10, cy: 36, rx: 30, ry: 40 },
  { cx: 55, cy: 37, rx: 21, ry: 19 },
  { cx: 66, cy: 71, rx: 11, ry: 9 },
  { cx: 80, cy: 58, rx: 10, ry: 8 },
];

interface Props {
  piers: PierDoc[];
  fromPierId?: string | null;
  toPierId?: string | null;
  height?: number;
}

export function SeaMap({ piers, fromPierId = null, toPierId = null, height = 200 }: Props) {
  const from = piers.find((p) => p.pierId === fromPierId) ?? null;
  const to = piers.find((p) => p.pierId === toPierId) ?? null;

  return (
    <View style={[styles.wrap, { height }]}>
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

        {/* Route line sits above land so it reads as a crossing, not a road. */}
        {from && to && (
          <Line
            x1={from.mapX * 100}
            y1={from.mapY * 100}
            x2={to.mapX * 100}
            y2={to.mapY * 100}
            stroke={colors.primary}
            strokeWidth={0.9}
            strokeDasharray="2.5 2"
            strokeLinecap="round"
          />
        )}

        {piers.map((p) => {
          const x = p.mapX * 100;
          const y = p.mapY * 100;
          const active = p.pierId === fromPierId || p.pierId === toPierId;
          // Flip labels inward near the right edge so they never clip.
          const right = p.mapX > 0.62;

          return (
            <G key={p.pierId}>
              {active && <Circle cx={x} cy={y} r={4} fill={colors.primary} opacity={0.22} />}
              <Circle
                cx={x}
                cy={y}
                r={active ? 2 : 1.5}
                fill={active ? colors.primary : colors.textSecondary}
                stroke={colors.bgElevated}
                strokeWidth={0.6}
              />
              <SvgText
                x={right ? x - 3.4 : x + 3.4}
                y={y + 1.1}
                fill={active ? colors.text : colors.textSecondary}
                fontSize={3.1}
                fontWeight={active ? '700' : '400'}
                textAnchor={right ? 'end' : 'start'}
              >
                {p.name}
              </SvgText>
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
});
