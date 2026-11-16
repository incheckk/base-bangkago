import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { AdminScreenHeader } from './AdminScreenHeader';
import { EmptyState, ErrorState, LoadingState } from './States';
import { ScreenContainer } from './ScreenContainer';
import { useAllPorts } from '@/hooks/useAllPorts';
import { useAllPortQueues } from '@/hooks/useSupabase';
import { DWELL_MS } from '@/services/queue.service';
import { colors, radii, spacing, typography } from '@/theme/tokens';

/** m:ss for the dwell countdowns on the queue rows. */
const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Live port queues for both watch roles. Reads port_queue directly — the
 * same rows dispatch acts on (008 RLS + realtime already cover signed-in
 * users), so a boat appears here the moment it enters a port perimeter.
 *
 * Grouped per port in FCFS order: the number on the left IS the boat's place
 * in line, and a green dot means dispatch can offer it a trip.
 */
export function PortQueuesScreen({ role }: { role: 'admin' | 'coastguard' }) {
  const allPorts = useAllPorts();
  const queues = useAllPortQueues();

  // Dwell countdowns tick while any queue row exists.
  const [now, setNow] = useState(() => Date.now());
  const hasQueues = queues.data.length > 0;
  useEffect(() => {
    if (!hasQueues) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasQueues]);

  /** Port groups, FCFS order inside each, ports with boats first. */
  const groups = useMemo(() => {
    const nameById = new Map(allPorts.data.map((p) => [p.portId, p.portName]));
    const byPort = new Map<string, typeof queues.data>();
    for (const row of queues.data) {
      const list = byPort.get(row.portId) ?? [];
      list.push(row);
      byPort.set(row.portId, list);
    }
    return [...byPort.entries()]
      .map(([portId, rows]) => {
        const sorted = [...rows].sort(
          (a, b) => new Date(a.enteredAt).getTime() - new Date(b.enteredAt).getTime(),
        );
        return {
          portId,
          name: nameById.get(portId) ?? sorted[0]?.portName ?? portId,
          rows: sorted,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [queues.data, allPorts.data]);

  const boats = queues.data.length;
  const ports = groups.length;

  if (allPorts.loading || queues.loading) {
    return (
      <ScreenContainer>
        <AdminScreenHeader role={role} title="Port Queues" showBack={false} />
        <LoadingState label="Loading queues…" />
      </ScreenContainer>
    );
  }

  if (queues.error) {
    return (
      <ScreenContainer>
        <AdminScreenHeader role={role} title="Port Queues" showBack={false} />
        <ErrorState message={queues.error} />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padded={false}>
      <AdminScreenHeader
        role={role}
        title="Port Queues"
        subtitle={`${boats} boat${boats === 1 ? '' : 's'} · ${ports} port${ports === 1 ? '' : 's'}`}
        showBack={false}
      />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {groups.length === 0 ? (
          <View style={styles.emptyBox}>
            <EmptyState
              icon="anchor"
              title="No boats waiting"
              message="Boats appear here the moment they join a port queue."
            />
          </View>
        ) : (
          groups.map((group) => (
            <View key={group.portId} style={styles.group}>
              <View style={styles.groupHead}>
                <Text style={styles.groupName} numberOfLines={1}>{group.name}</Text>
                <Text style={styles.groupCount}>
                  {group.rows.length} boat{group.rows.length === 1 ? '' : 's'}
                </Text>
              </View>
              <View style={styles.groupCard}>
                {group.rows.map((r, i) => {
                  const dwellLeft = DWELL_MS - (now - new Date(r.enteredAt).getTime());
                  const online = r.isAvailable !== false;
                  return (
                    <View
                      key={r.queueId}
                      style={[styles.row, i > 0 && styles.rowDivided]}
                    >
                      <Text style={styles.rank}>{i + 1}</Text>
                      <View style={styles.rowBody}>
                        <Text style={styles.rowName} numberOfLines={1}>
                          {r.displayName ?? 'Boat'}
                        </Text>
                        <View style={styles.rowMetaWrap}>
                          <View style={[styles.dot, online ? styles.dotOn : styles.dotOff]} />
                          <Text style={styles.rowMeta} numberOfLines={1}>
                            {online ? 'Ready for a trip' : 'Offline'}
                            {' · listed '}
                            {new Date(r.enteredAt).toLocaleTimeString('en-PH', {
                              hour: '2-digit', minute: '2-digit',
                            })}
                          </Text>
                        </View>
                      </View>
                      <Text style={[styles.dwell, dwellLeft <= 0 && styles.dwellReady]} numberOfLines={1}>
                        {dwellLeft > 0 ? `dwell ${clock(dwellLeft)}` : 'ready'}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.huge },
  emptyBox: { minHeight: 180, justifyContent: 'center' },

  group: { marginBottom: spacing.xl },
  groupHead: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
    gap: spacing.md, marginBottom: spacing.sm,
  },
  groupName: { flexShrink: 1, ...typography.bodyStrong },
  groupCount: { ...typography.label, color: colors.textMuted, letterSpacing: 0 },

  groupCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.borderSubtle,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  rowDivided: { borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  rank: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: colors.surfaceAlt,
    textAlign: 'center', lineHeight: 24,
    color: colors.primary, fontSize: 12, fontWeight: '700',
  },
  rowBody: { flex: 1, minWidth: 0 },
  rowName: { ...typography.bodyStrong },
  rowMetaWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 2 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  dotOn: { backgroundColor: colors.primary },
  dotOff: { backgroundColor: colors.textOnDisabled },
  rowMeta: { flexShrink: 1, ...typography.caption, color: colors.textMuted, fontSize: 11 },
  dwell: {
    ...typography.caption, color: colors.warning, fontSize: 11, fontWeight: '700',
  },
  dwellReady: { color: colors.primary },
});
