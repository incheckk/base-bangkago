import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { AdminScreenHeader } from '@/components/AdminScreenHeader';
import { ScreenContainer } from '@/components/ScreenContainer';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { WatchRow, WatchSection, WatchValue } from '@/components/WatchList';
import { useAllPorts } from '@/hooks/useAllPorts';
import { useAllPortQueues, usePorts } from '@/hooks/useSupabase';
import { DWELL_MS } from '@/services/queue.service';
import { colors, typography } from '@/theme/tokens';

/** m:ss for the dwell countdowns on the queue rows. */
const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Live port queues, straight from port_queue — the same rows dispatch uses,
 * so what the watch officer sees here is what the FCFS list is acting on.
 */
export default function CoastguardQueues() {
  const allPorts = useAllPorts();
  const activePorts = usePorts();
  const queues = useAllPortQueues();

  // Dwell countdowns tick while any queue row exists.
  const [now, setNow] = useState(() => Date.now());
  const hasQueues = queues.data.length > 0;
  useEffect(() => {
    if (!hasQueues) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasQueues]);

  const portName = (id: string) =>
    allPorts.data.find((p) => p.portId === id)?.portName ?? id;

  /**
   * Boats, not ports. Nine bordered cards mostly read "No boats waiting." A
   * watch screen shows what is happening; empty ports collapse into one line.
   */
  const waiting = useMemo(() => {
    const rows = queues.data.map((r) => ({
      ...r,
      port: portName(r.portId),
      dwellLeft: DWELL_MS - (now - new Date(r.enteredAt).getTime()),
      listedAt: new Date(r.enteredAt).toLocaleTimeString([], {
        hour: '2-digit', minute: '2-digit',
      }),
    }));
    // Ready boats first, then the ones still serving their dwell.
    return rows.sort((a, b) => a.dwellLeft - b.dwellLeft);
  }, [queues.data, now, allPorts.data]);

  const busyPortIds = new Set(queues.data.map((r) => r.portId));
  const quietPorts = activePorts.data.filter((p) => !busyPortIds.has(p.portId));

  if (allPorts.loading || queues.loading) {
    return (
      <ScreenContainer>
        <AdminScreenHeader role="coastguard" title="Port Queues" showBack={false} />
        <LoadingState label="Loading queues…" />
      </ScreenContainer>
    );
  }

  if (queues.error) {
    return (
      <ScreenContainer>
        <AdminScreenHeader role="coastguard" title="Port Queues" showBack={false} />
        <ErrorState message={queues.error} />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padded={false}>
      <AdminScreenHeader
        role="coastguard"
        title="Port Queues"
        subtitle={`${waiting.length} boat${waiting.length === 1 ? '' : 's'} · ${busyPortIds.size} port${busyPortIds.size === 1 ? '' : 's'}`}
        showBack={false}
      />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {waiting.length === 0 ? (
          <View style={styles.emptyBox}>
            <EmptyState
              icon="anchor"
              title="No boats waiting"
              message="Boats appear here the moment they join a port queue."
            />
          </View>
        ) : (
          <WatchSection label="WAITING NOW">
            {waiting.map((r, i) => (
              <WatchRow
                key={r.queueId}
                first={i === 0}
                dot={r.isAvailable ? colors.primary : colors.textOnDisabled}
                title={r.displayName ?? 'Boat'}
                meta={`${r.port}${r.isAvailable ? '' : ' · offline'}`}
                right={
                  <WatchValue>
                    {r.dwellLeft > 0 ? `dwell ${clock(r.dwellLeft)}` : `ready ${r.listedAt}`}
                  </WatchValue>
                }
              />
            ))}
          </WatchSection>
        )}

        {quietPorts.length > 0 && (
          <Text style={styles.quietNote}>
            No boats at {quietPorts.map((p) => p.portName).join(', ')}.
          </Text>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 24, paddingBottom: 48 },
  quietNote: {
    ...typography.label,
    fontWeight: '400',
    letterSpacing: 0,
    marginTop: 12,
    lineHeight: 18,
    color: colors.textMuted,
  },
  emptyBox: { minHeight: 180, justifyContent: 'center' },
});
