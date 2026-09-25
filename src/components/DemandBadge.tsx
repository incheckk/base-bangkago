import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing } from '../theme/tokens';

type DemandLevel = 'low' | 'medium' | 'high';

interface Props {
  level: DemandLevel;
  predictedPassengers?: number;
}

const CONFIG: Record<DemandLevel, { text: string; color: string; bg: string }> = {
  low: { text: 'Low Demand', color: colors.textSecondary, bg: colors.neutralTint },
  medium: { text: 'Moderate', color: colors.warning, bg: colors.warningTint },
  high: { text: 'High Demand', color: colors.primary, bg: colors.primaryTint },
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
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radii.pill,
  },
  text: { fontSize: 12, fontWeight: '700' },
  count: { fontSize: 11, fontWeight: '600' },
});
