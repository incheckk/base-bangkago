import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing } from '../theme/tokens';

type Severity = 'low' | 'medium' | 'high' | 'critical';

interface Props {
  title: string;
  message: string;
  severity: Severity;
  timestamp?: string;
}

const SEVERITY_CONFIG: Record<Severity, { fg: string; bg: string; border: string }> = {
  low: { fg: colors.textSecondary, bg: 'rgba(169,190,196,0.08)', border: colors.borderSubtle },
  medium: { fg: colors.warning, bg: 'rgba(232,169,60,0.08)', border: 'rgba(232,169,60,0.3)' },
  high: { fg: colors.accent, bg: 'rgba(232,89,60,0.08)', border: 'rgba(232,89,60,0.3)' },
  critical: { fg: colors.danger, bg: 'rgba(224,82,82,0.08)', border: 'rgba(224,82,82,0.3)' },
};

export function StatusCard({ title, message, severity, timestamp }: Props) {
  const config = SEVERITY_CONFIG[severity];
  return (
    <View style={[styles.card, { backgroundColor: config.bg, borderColor: config.border }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: config.fg }]}>{title}</Text>
        {timestamp && <Text style={styles.timestamp}>{timestamp}</Text>}
      </View>
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.md,
    borderWidth: 1,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  title: { fontSize: 14, fontWeight: '700' },
  timestamp: { color: colors.textMuted, fontSize: 11 },
  message: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
});
