import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AdminScreenHeader } from '@/components/AdminScreenHeader';
import { ScreenContainer } from '@/components/ScreenContainer';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { WatchRow, WatchSection } from '@/components/WatchList';
import { useAllPorts } from '@/hooks/useAllPorts';
import { useSafetyAlerts } from '@/hooks/useSafetyAlerts';
import type { AlertSeverity, SafetyAlertDoc } from '@/types/models';
import { colors, spacing } from '@/theme/tokens';

const SEVERITY_COLOR: Record<AlertSeverity, string> = {
  low: colors.textMuted,
  medium: colors.warning,
  high: colors.danger,
  critical: colors.danger,
};

/**
 * Safety alerts across the whole strait. Read-only: the coastguard watches
 * and advises, the admin closes the ticket.
 */
export default function CoastguardAlerts() {
  const alerts = useSafetyAlerts(null);
  const ports = useAllPorts();

  const portName = (id: string | null) =>
    id ? ports.data.find((p) => p.portId === id)?.portName ?? id : null;

  const { open, resolved } = useMemo(() => {
    const sorted = [...alerts.data].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    return {
      open: sorted.filter((a) => !a.isResolved),
      resolved: sorted.filter((a) => a.isResolved).slice(0, 20),
    };
  }, [alerts.data]);

  if (alerts.loading) {
    return (
      <ScreenContainer>
        <AdminScreenHeader role="coastguard" title="Alerts" showBack={false} />
        <LoadingState label="Loading alerts…" />
      </ScreenContainer>
    );
  }

  if (alerts.error) {
    return (
      <ScreenContainer>
        <AdminScreenHeader role="coastguard" title="Alerts" showBack={false} />
        <ErrorState message={alerts.error} />
      </ScreenContainer>
    );
  }

  const row = (a: SafetyAlertDoc, i: number) => (
    <WatchRow
      key={a.alertId}
      first={i === 0}
      wrap
      dot={SEVERITY_COLOR[a.severity]}
      title={a.message}
      meta={[
        a.severity.toUpperCase(),
        portName(a.portId),
        when(a.createdAt),
      ].filter(Boolean).join(' · ')}
    />
  );

  return (
    <ScreenContainer padded={false}>
      <AdminScreenHeader
        role="coastguard"
        title="Alerts"
        subtitle={`${open.length} open`}
        showBack={false}
      />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {open.length === 0 ? (
          <View style={styles.emptyBox}>
            <EmptyState
              icon="sos"
              title="No open alerts"
              message="SOS calls and safety reports land here until an admin resolves them."
            />
          </View>
        ) : (
          <WatchSection label="OPEN">{open.map(row)}</WatchSection>
        )}

        {resolved.length > 0 && (
          <WatchSection label="RECENTLY RESOLVED">{resolved.map(row)}</WatchSection>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

/** "14:32 · 3h ago" — the clock is Manila, the age is what matters at a glance. */
function when(iso: string): string {
  const ageMs = Date.now() - new Date(iso).getTime();
  const min = Math.round(ageMs / 60000);
  const age = min < 60 ? `${Math.max(1, min)}m ago` : `${Math.round(min / 60)}h ago`;
  return `${new Date(iso).toLocaleTimeString('en-PH', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Manila',
  })} · ${age}`;
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.huge },
  emptyBox: { minHeight: 180, justifyContent: 'center' },
});
