import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { colors, radii, spacing, typography } from '../theme/tokens';

/**
 * The coastguard screens are lists of facts inside one card per section —
 * same as the watch screen always was. These three pieces keep queues,
 * departures, routes and alerts from each growing their own border/gap
 * styles.
 */
export function WatchSection({
  label, meta, children, style,
}: { label: string; meta?: string; children: ReactNode; style?: ViewStyle }) {
  return (
    <View style={[styles.section, style]}>
      <View style={styles.head}>
        <Text style={styles.label}>{label}</Text>
        {!!meta && <Text style={styles.metaText} numberOfLines={1}>{meta}</Text>}
      </View>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

export function WatchRow({
  dot, title, meta, right, first, wrap,
}: {
  /** Optional state dot on the left, e.g. online/offline. */
  dot?: string;
  title: string;
  meta?: string;
  right?: ReactNode;
  first?: boolean;
  /** Let long text (alert messages) run to two lines instead of truncating. */
  wrap?: boolean;
}) {
  const lines = wrap ? 2 : 1;
  return (
    <View style={[styles.row, !first && styles.rowBorder]}>
      {!!dot && <View style={[styles.dot, { backgroundColor: dot }]} />}
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={lines}>{title}</Text>
        {!!meta && <Text style={styles.metaText} numberOfLines={wrap ? 2 : 1}>{meta}</Text>}
      </View>
      {right}
    </View>
  );
}

/** Plain tabular figure on the right of a row (fare, count, time). */
export function WatchValue({ children }: { children: string }) {
  return <Text style={styles.value} numberOfLines={1}>{children}</Text>;
}

const styles = StyleSheet.create({
  section: { marginTop: spacing.lg },
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: spacing.md, marginBottom: spacing.sm,
  },
  label: { ...typography.label },
  metaText: {
    flexShrink: 1, ...typography.label,
    fontWeight: '400', letterSpacing: 0, color: colors.textMuted,
  },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  dot: { width: 8, height: 8, borderRadius: radii.pill },
  body: { flex: 1, minWidth: 0 },
  title: { flexShrink: 1, ...typography.bodyStrong, lineHeight: 20 },
  value: { flexShrink: 0, ...typography.bodyStrong },
});
