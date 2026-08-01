import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing } from '../theme/tokens';
import type { BookingStatus } from '../types/models';

const MAP: Record<BookingStatus, { text: string; fg: string; bg: string }> = {
  open:      { text: 'Waiting for bangkero', fg: colors.warning,       bg: 'rgba(232,169,60,0.14)' },
  accepted:  { text: 'Bangkero accepted',    fg: colors.primary,       bg: 'rgba(52,214,176,0.14)' },
  completed: { text: 'Completed',            fg: colors.textSecondary, bg: 'rgba(169,190,196,0.14)' },
  cancelled: { text: 'Cancelled',            fg: colors.danger,        bg: 'rgba(224,82,82,0.14)' },
};

export function StatusPill({ status }: { status: BookingStatus }) {
  const s = MAP[status];
  return (
    <View style={[styles.pill, { backgroundColor: s.bg }]}>
      <Text style={[styles.text, { color: s.fg }]}>{s.text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start', paddingHorizontal: spacing.md,
    paddingVertical: 5, borderRadius: radii.pill,
  },
  text: { fontSize: 12, fontWeight: '700' },
});