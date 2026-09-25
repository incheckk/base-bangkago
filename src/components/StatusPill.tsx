import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing } from '../theme/tokens';
import type { BookingStatus } from '../types/models';

const MAP: Record<BookingStatus, { text: string; fg: string; bg: string }> = {
  open:      { text: 'Waiting for bangkero', fg: colors.warning,       bg: colors.warningTint },
  accepted:  { text: 'Bangkero accepted',    fg: colors.primary,       bg: colors.primaryTint },
  completed: { text: 'Completed',            fg: colors.textSecondary, bg: colors.neutralTint },
  cancelled: { text: 'Cancelled',            fg: colors.danger,        bg: colors.dangerTint },
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