import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing } from '../theme/tokens';

type DemandLevel = 'low' | 'steady' | 'high';

interface Props {
  level: DemandLevel;
  predictedPassengers?: number;
}

const CONFIG: Record<DemandLevel, { text: string; color: string; bg: string }> = {
  low: { text: 'Low Demand', color: colors.textSecondary, bg: colors.surfaceAlt },
  steady: { text: 'Steady Demand', color: colors.warning, bg: colors.warningTint },
  high: { text: 'High Demand', color: colors.success, bg: colors.successTint },
};

export function DemandBadge({ level, predictedPassengers }: Props) {
  const config = CONFIG[level];
  return (
    <View style={[styles.badge, { backgroundColor: config.bg }]}>
      <Text style={[styles.text, { color: config.color }]}>{config.text}</Text>
      {predictedPassengers != null && (
        <Text style={[styles.count, { color: config.color }]}>~{predictedPassengers} pax</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radii.pill,
  },
  text: { fontSize: 12, fontWeight: '700' },
  count: { fontSize: 11, fontWeight: '600' },
});
