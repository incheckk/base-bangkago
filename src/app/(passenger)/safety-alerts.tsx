import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { PassengerScreenHeader } from '@/components/PassengerScreenHeader';
import { ScreenContainer } from '@/components/ScreenContainer';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { WatchRow, WatchSection } from '@/components/WatchList';
import { useAlertFeed } from '@/hooks/useSafetyAlerts';
import { useAllPorts } from '@/hooks/useAllPorts';
import type { AlertSeverity, SafetyAlertDoc } from '@/types/models';
import { colors, spacing } from '@/theme/tokens';

const SEVERITY_COLOR: Record<AlertSeverity, string> = {
  low: colors.textMuted,
  medium: colors.warning,
  high: colors.danger,
  critical: colors.danger,
};

/**
 * Read-only safety feed for passengers. The alert_feed RPC scrubs every
 * other vessel's message, so this screen shows severity, port, and time
 * without leaking names or GPS from another boat.
 */
export default function PassengerSafetyAlertsScreen() {
  const alerts = useAlertFeed();
  const ports = useAllPorts();

  const portName = (id: string | null) =>
    id ? ports.data.find((p) => p.portId === id)?.portName ?? id : null;

  const { open, resolved } = useMemo(() => {
    const sorted = [...alerts.data].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    return {
      open: sorted.filter((a) => !a.isResolved),
      resolved: sorted.filter((a) => a.isResolved).slice(0, 10),
    };
  }, [alerts.data]);

  if (alerts.loading) {
    return (
      <ScreenContainer padded={false}>
        <PassengerScreenHeader title="Safety Alerts" />
        <LoadingState label="Loading safety alerts..." />
      </ScreenContainer>
    );
  }

  if (alerts.error) {
    return (
      <ScreenContainer padded={false}>
        <PassengerScreenHeader title="Safety Alerts" />
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
      ].filter(Boolean).join(' \u00b7 ')}
    />
  );

  return (
    <ScreenContainer padded={false}>
      <PassengerScreenHeader
        title="Safety Alerts"
        subtitle={`${open.length} active`}
      />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {open.length === 0 ? (
          <View style={styles.emptyBox}>
            <EmptyState
              icon="sos"
              title="No active alerts"
              message="Coast Guard advisories and emergency reports appear here until they are resolved."
            />
          </View>
        ) : (
          <WatchSection label="ACTIVE">{open.map(row)}</WatchSection>
        )}

        {resolved.length > 0 && (
          <WatchSection label="RECENTLY RESOLVED">{resolved.map(row)}</WatchSection>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

function when(iso: string): string {
  const ageMs = Date.now() - new Date(iso).getTime();
  const min = Math.round(ageMs / 60000);
  const age = min < 60 ? `${Math.max(1, min)}m ago` : `${Math.round(min / 60)}h ago`;
  return `${new Date(iso).toLocaleTimeString('en-PH', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Manila',
  })} \u00b7 ${age}`;
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.huge },
  emptyBox: { minHeight: 180, justifyContent: 'center' },
});
