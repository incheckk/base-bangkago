import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { AdminScreenHeader } from '@/components/AdminScreenHeader';
import { ScreenContainer } from '@/components/ScreenContainer';
import { LoadingState } from '@/components/States';
import { useAllPorts } from '@/hooks/useAllPorts';
import { useAllPortQueues, usePorts } from '@/hooks/useSupabase';
import { useRoutes } from '@/hooks/useRoutes';
import { DWELL_MS } from '@/services/queue.service';
import type { PortQueueDoc } from '@/types/models';
import { colors, radii, spacing, typography } from '@/theme/tokens';

/** m:ss for the dwell countdowns on the queue rows. */
const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Coastguard / LGU home (B12) — view-only. The two screens the papers
 * promise: live port queues (same data as Admin → Manage Ports' queue
 * block) and the routes/fares table (Admin → Manage Routes, minus every
 * write control). One screen, two sections; nothing here can mutate.
 */
export default function CoastguardHome() {
  const allPorts = useAllPorts();
  const activePorts = usePorts();
  const queues = useAllPortQueues();
  const routes = useRoutes();

  // Dwell countdowns tick while any queue row exists (same as manage-ports).
  const [now, setNow] = useState(() => Date.now());
  const hasQueues = queues.data.length > 0;
  useEffect(() => {
    if (!hasQueues) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasQueues]);

  const queuesByPort = new Map<string, PortQueueDoc[]>();
  for (const row of queues.data) {
    const list = queuesByPort.get(row.portId) ?? [];
    list.push(row);
    queuesByPort.set(row.portId, list);
  }

  const portName = (id: string) =>
    allPorts.data.find((p) => p.portId === id)?.portName ?? id;

  if (allPorts.loading || routes.loading) return <LoadingState />;

  return (
    <ScreenContainer padded={false}>
      <AdminScreenHeader
        role="coastguard"
        title="Coastguard Watch"
        subtitle="View-only · live queues and fares"
        showBack={false}
      />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionLabel}>LIVE PORT QUEUES</Text>
        <View style={styles.list}>
          {activePorts.data.map((p) => (
            <View key={p.portId} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle} numberOfLines={1}>{p.portName}</Text>
                <Text style={styles.cardMeta} numberOfLines={1}>{p.location}</Text>
              </View>
              <View style={styles.queueBlock}>
                <Text style={styles.queueTitle}>WAITING QUEUE</Text>
                {(() => {
                  const q = queuesByPort.get(p.portId) ?? [];
                  if (q.length === 0) {
                    return <Text style={styles.queueEmpty}>No boats waiting.</Text>;
                  }
                  return q.map((r, i) => {
                    const dwellLeft = DWELL_MS - (now - new Date(r.enteredAt).getTime());
                    const listedAt = new Date(r.enteredAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    });
                    return (
                      <View key={r.queueId} style={styles.queueRow}>
                        <Text style={styles.queueRank}>#{i + 1}</Text>
                        <Text style={styles.queueName} numberOfLines={1}>
                          {r.displayName ?? 'Boat'}
                        </Text>
                        <View
                          style={[
                            styles.queueBadge,
                            { backgroundColor: r.isAvailable ? colors.primaryTint : colors.surfaceAlt },
                          ]}
                        >
                          <Text
                            style={[
                              styles.queueBadgeText,
                              { color: r.isAvailable ? colors.primary : colors.textMuted },
                            ]}
                          >
                            {r.isAvailable ? 'online' : 'offline'}
                          </Text>
                        </View>
                        <Text style={styles.queueStatus}>
                          {dwellLeft > 0 ? `dwell ${clock(dwellLeft)}` : `ready · ${listedAt}`}
                        </Text>
                      </View>
                    );
                  });
                })()}
              </View>
            </View>
          ))}
        </View>

        <Text style={styles.sectionLabel}>ROUTES & FARES</Text>
        <View style={styles.list}>
          {routes.data.map((r) => (
            <View key={r.routeId} style={styles.routeRow}>
              <View style={styles.routeInfo}>
                <Text style={styles.routeName} numberOfLines={1}>
                  {portName(r.startPortId)} → {portName(r.endPortId)}
                </Text>
                <Text style={styles.routeMeta} numberOfLines={1}>
                  {r.estimatedMinutes ? `${r.estimatedMinutes} min` : '—'}
                  {!r.isActive && ' · not running'}
                </Text>
              </View>
              <Text style={styles.fare}>₱{r.baseFare}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  sectionLabel: { ...typography.label, marginTop: spacing.xl, marginBottom: spacing.md },
  list: { gap: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
  },
  cardHeader: { justifyContent: 'space-between', gap: spacing.xs },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  cardMeta: { color: colors.textMuted, fontSize: 12 },
  queueBlock: {
    marginTop: spacing.md, paddingTop: spacing.md,
    borderTopWidth: 1, borderTopColor: colors.borderSubtle, gap: spacing.xs,
  },
  queueTitle: { ...typography.micro, color: colors.textMuted, letterSpacing: 1, marginBottom: spacing.xxs },
  queueEmpty: { ...typography.caption, color: colors.textMuted },
  queueRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  queueRank: { width: 26, ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  queueName: { flex: 1, ...typography.caption, color: colors.text },
  queueBadge: { paddingHorizontal: spacing.xs, paddingVertical: 2, borderRadius: radii.pill, flexShrink: 0 },
  queueBadgeText: { fontSize: 10, fontWeight: '700' },
  queueStatus: { flexShrink: 0, ...typography.micro, color: colors.textMuted },
  routeRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: 1,
    borderColor: colors.borderSubtle, padding: spacing.lg, gap: spacing.md,
  },
  routeInfo: { flex: 1, gap: 2 },
  routeName: { color: colors.text, fontSize: 14, fontWeight: '600' },
  routeMeta: { color: colors.textMuted, fontSize: 12 },
  fare: { color: colors.warning, fontSize: 16, fontWeight: '700' },
});
