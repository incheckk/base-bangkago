import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { FilterChips } from '@/components/FilterChips';
import { PrimaryButton } from '@/components/PrimaryButton';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { useSafetyAlerts } from '@/hooks/useSafetyAlerts';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import type { AlertSeverity, SafetyAlertDoc } from '@/types/models';

const FILTERS = [
  { key: 'active', label: 'Active' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'all', label: 'All' },
];

const SEVERITY_CONFIG: Record<AlertSeverity, { fg: string; bg: string; border: string; label: string }> = {
  low: {
    fg: colors.textSecondary,
    bg: 'rgba(169,190,196,0.08)',
    border: colors.borderSubtle,
    label: 'Low',
  },
  medium: {
    fg: colors.warning,
    bg: 'rgba(232,169,60,0.08)',
    border: 'rgba(232,169,60,0.3)',
    label: 'Medium',
  },
  high: {
    fg: '#F59E0B',
    bg: 'rgba(245,158,11,0.08)',
    border: 'rgba(245,158,11,0.3)',
    label: 'High',
  },
  critical: {
    fg: colors.danger,
    bg: 'rgba(224,82,82,0.08)',
    border: 'rgba(224,82,82,0.3)',
    label: 'Critical',
  },
};

function formatTimeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function SystemAlertsScreen() {
  const [filter, setFilter] = useState('active');
  const { data, loading, error, resolveAlert } = useSafetyAlerts(null);

  const filtered = data.filter((a) => {
    if (filter === 'active') return !a.isResolved;
    if (filter === 'resolved') return a.isResolved;
    return true;
  });

  if (loading) {
    return (
      <View style={styles.center}>
        <LoadingState label="Loading alerts…" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <ErrorState message={error} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.scroll}>
      <Text style={styles.back} onPress={() => router.back()}>← Back</Text>

      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.eyebrow}>SYSTEM</Text>
          <Text style={styles.title}>Safety Alerts</Text>
        </View>
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{data.filter((a) => !a.isResolved).length}</Text>
        </View>
      </View>

      <FilterChips filters={FILTERS} active={filter} onChange={setFilter} />

      {filtered.length === 0 ? (
        <EmptyState
          icon="🔔"
          title="No alerts"
          message={filter === 'active' ? 'All alerts are resolved.' : 'No alerts match this filter.'}
        />
      ) : (
        <View style={styles.list}>
          {filtered.map((alert) => (
            <AlertCard
              key={alert.alertId}
              alert={alert}
              onResolve={() => resolveAlert(alert.alertId)}
              onDismiss={() => resolveAlert(alert.alertId)}
            />
          ))}
        </View>
      )}

      <View style={styles.composeWrap}>
        <PrimaryButton
          label="Compose Notification"
          onPress={() => {}}
          variant="secondary"
          style={styles.composeBtn}
        />
      </View>
    </ScrollView>
  );
}

function AlertCard({
  alert,
  onResolve,
  onDismiss,
}: {
  alert: SafetyAlertDoc;
  onResolve: () => void;
  onDismiss: () => void;
}) {
  const sev = SEVERITY_CONFIG[alert.severity];
  return (
    <View style={[styles.alertCard, { backgroundColor: sev.bg, borderColor: sev.border }]}>
      <View style={styles.alertTop}>
        <View style={[styles.severityBadge, { backgroundColor: sev.border }]}>
          <Text style={[styles.severityText, { color: sev.fg }]}>{sev.label}</Text>
        </View>
        <Text style={styles.timestamp}>{formatTimeAgo(alert.createdAt)}</Text>
      </View>
      <Text style={styles.alertMessage}>{alert.message}</Text>
      {alert.isResolved ? (
        <View style={styles.resolvedRow}>
          <Text style={styles.resolvedLabel}>✓ Resolved</Text>
        </View>
      ) : (
        <View style={styles.alertActions}>
          <PrimaryButton
            label="Resolve"
            onPress={onResolve}
            style={styles.alertBtn}
          />
          <PrimaryButton
            label="Dismiss"
            onPress={onDismiss}
            variant="secondary"
            style={styles.alertBtn}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl, flexGrow: 1 },
  back: { color: colors.primary, fontSize: 14, fontWeight: '600', marginBottom: spacing.lg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xl,
  },
  headerLeft: { flex: 1 },
  eyebrow: { ...typography.label, marginBottom: 2 },
  title: { ...typography.h1 },
  countBadge: {
    backgroundColor: colors.danger,
    borderRadius: radii.pill,
    minWidth: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  countText: { color: colors.text, fontSize: 15, fontWeight: '700' },

  list: { gap: spacing.md, marginTop: spacing.sm },

  alertCard: {
    borderRadius: radii.md,
    borderWidth: 1,
    padding: spacing.lg,
  },
  alertTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  severityBadge: {
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radii.pill,
  },
  severityText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  timestamp: { color: colors.textMuted, fontSize: 11 },
  alertMessage: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  alertActions: { flexDirection: 'row', gap: spacing.sm },
  alertBtn: { flex: 1, height: 40 },
  resolvedRow: { marginTop: spacing.xs },
  resolvedLabel: { color: colors.primary, fontSize: 13, fontWeight: '700' },

  composeWrap: { marginTop: spacing.xl },
  composeBtn: { width: '100%' },
});
