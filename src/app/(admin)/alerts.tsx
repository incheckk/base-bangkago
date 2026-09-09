import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { FilterChips } from '@/components/FilterChips';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { useSafetyAlerts } from '@/hooks/useSafetyAlerts';
import { colors, radii, spacing, typography } from '@/theme/tokens';

const ADMIN_ACCENT = '#F59E0B';

const FILTERS = [
  { key: 'active', label: 'Active' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'all', label: 'All' },
];

const SEVERITY_CONFIG: Record<string, { fg: string; bg: string; border: string }> = {
  low: { fg: colors.textSecondary, bg: 'rgba(169,190,196,0.08)', border: colors.borderSubtle },
  medium: { fg: colors.warning, bg: 'rgba(232,169,60,0.08)', border: 'rgba(232,169,60,0.3)' },
  high: { fg: colors.accent, bg: 'rgba(232,89,60,0.08)', border: 'rgba(232,89,60,0.3)' },
  critical: { fg: colors.danger, bg: 'rgba(224,82,82,0.08)', border: 'rgba(224,82,82,0.3)' },
};

export default function AlertsScreen() {
  const [filter, setFilter] = useState('active');
  const alerts = useSafetyAlerts(null);

  const filtered = useMemo(() => {
    if (filter === 'all') return alerts.data;
    if (filter === 'active') return alerts.data.filter((a) => !a.isResolved);
    return alerts.data.filter((a) => a.isResolved);
  }, [alerts.data, filter]);

  return (
    <ScreenContainer padded={false}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.back} onPress={() => router.back()}>← Back</Text>
        <Text style={styles.title}>System Alerts</Text>
        <Text style={styles.count}>
          {alerts.loading ? 'Loading…' : `${filtered.length} alert${filtered.length === 1 ? '' : 's'}`}
        </Text>

        <View style={styles.chipsWrap}>
          <FilterChips filters={FILTERS} active={filter} onChange={setFilter} />
        </View>

        {alerts.loading ? (
          <View style={styles.stateBox}>
            <Text style={styles.loadingText}>Loading alerts…</Text>
          </View>
        ) : filtered.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyIcon}>✅</Text>
            <Text style={styles.emptyTitle}>No alerts</Text>
            <Text style={styles.emptyText}>
              {filter === 'active' ? 'All alerts have been resolved.' : 'No alerts found.'}
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {filtered.map((a) => {
              const sev = SEVERITY_CONFIG[a.severity] ?? SEVERITY_CONFIG.low;
              return (
                <View
                  key={a.alertId}
                  style={[styles.alertCard, { backgroundColor: sev.bg, borderColor: sev.border }]}
                >
                  <View style={styles.alertTop}>
                    <View style={[styles.severityDot, { backgroundColor: sev.fg }]} />
                    <Text style={[styles.severityLabel, { color: sev.fg }]}>
                      {a.severity.toUpperCase()}
                    </Text>
                    {a.isResolved && (
                      <View style={styles.resolvedBadge}>
                        <Text style={styles.resolvedText}>Resolved</Text>
                      </View>
                    )}
                  </View>

                  <Text style={styles.alertMessage}>{a.message}</Text>

                  <Text style={styles.alertTime}>
                    {new Date(a.createdAt).toLocaleString('en-PH', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Text>

                  {!a.isResolved && (
                    <View style={styles.resolveRow}>
                      <PrimaryButton
                        label="Resolve"
                        variant="secondary"
                        onPress={() => alerts.resolveAlert(a.alertId)}
                        style={styles.resolveBtn}
                      />
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  back: { color: colors.primary, fontSize: 14, fontWeight: '600', marginBottom: spacing.lg },
  title: { ...typography.h1, marginBottom: spacing.xs },
  count: { ...typography.caption, marginBottom: spacing.lg },
  chipsWrap: { marginBottom: spacing.md },

  stateBox: { minHeight: 120, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: colors.textMuted, fontSize: 13 },

  emptyBox: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyIcon: { fontSize: 32, marginBottom: spacing.sm },
  emptyTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  emptyText: { ...typography.caption, marginTop: spacing.xs },

  list: { gap: spacing.md },
  alertCard: {
    borderRadius: radii.md,
    borderWidth: 1,
    padding: spacing.lg,
  },
  alertTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  severityDot: { width: 8, height: 8, borderRadius: 4 },
  severityLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  resolvedBadge: {
    marginLeft: 'auto',
    backgroundColor: 'rgba(52,214,176,0.15)',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  resolvedText: { color: colors.primary, fontSize: 11, fontWeight: '700' },

  alertMessage: { color: colors.text, fontSize: 14, lineHeight: 20, marginBottom: spacing.sm },
  alertTime: { color: colors.textMuted, fontSize: 12 },

  resolveRow: { marginTop: spacing.md },
  resolveBtn: { alignSelf: 'flex-start' },
});
