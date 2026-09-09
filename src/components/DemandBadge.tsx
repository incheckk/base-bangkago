import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing } from '../theme/tokens';

type DemandLevel = 'low' | 'medium' | 'high';

interface Props {
  level: DemandLevel;
  predictedPassengers?: number;
}

const CONFIG: Record<DemandLevel, { text: string; color: string; bg: string }> = {
  low: { text: 'Low Demand', color: colors.textSecondary, bg: 'rgba(169,190,196,0.14)' },
  medium: { text: 'Moderate', color: colors.warning, bg: 'rgba(232,169,60,0.14)' },
  high: { text: 'High Demand', color: '#34D6B0', bg: 'rgba(52,214,176,0.14)' },
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
