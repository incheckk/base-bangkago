import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { AdminScreenHeader } from '@/components/AdminScreenHeader';
import { Icon } from '@/components/Icon';
import { ScreenContainer } from '@/components/ScreenContainer';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { WeatherCard } from '@/components/WeatherCard';
import { useAllPorts } from '@/hooks/useAllPorts';
import { useAllPortQueues, usePorts } from '@/hooks/useSupabase';
import { useRoutes } from '@/hooks/useRoutes';
import { DWELL_MS } from '@/services/queue.service';
import { STRAIT_POINT } from '@/services/weather.service';
import { colors, numeric, radii, spacing, typography } from '@/theme/tokens';

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

  const [query, setQuery] = useState('');

  // Dwell countdowns tick while any queue row exists (same as manage-ports).
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
   * Boats, not ports.
   *
   * This rendered a bordered card per port — nine of them, and on a normal
   * day seven read "No boats waiting." A watch screen should show what is
   * happening, not enumerate every place where nothing is. The ports with
   * nothing at them collapse into one muted line underneath.
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

  /**
   * Forty routes was forty bordered cards in a single column. Grouped by
   * departure port it becomes nine short blocks, and the filter means you
   * never scroll to find one — a fare lookup is a search, not a browse.
   */
  const routeGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matching = routes.data.filter((r) => {
      if (!q) return true;
      return `${portName(r.startPortId)} ${portName(r.endPortId)}`.toLowerCase().includes(q);
    });
    const byOrigin = new Map<string, typeof matching>();
    for (const r of matching) {
      const list = byOrigin.get(r.startPortId) ?? [];
      list.push(r);
      byOrigin.set(r.startPortId, list);
    }
    // Follow the ports' own sort order rather than insertion order.
    return activePorts.data
      .filter((p) => byOrigin.has(p.portId))
      .map((p) => ({ portId: p.portId, name: p.portName, routes: byOrigin.get(p.portId)! }));
  }, [routes.data, query, activePorts.data, allPorts.data]);

  if (allPorts.loading || routes.loading) {
    return (
      <ScreenContainer>
        <AdminScreenHeader role="coastguard" title="Coastguard Watch" showBack={false} />
        <LoadingState label="Loading watch data…" />
      </ScreenContainer>
    );
  }

  if (routes.error) {
    return (
      <ScreenContainer>
        <AdminScreenHeader role="coastguard" title="Coastguard Watch" showBack={false} />
        <ErrorState message={routes.error} />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padded={false}>
      <AdminScreenHeader
        role="coastguard"
        title="Coastguard Watch"
        subtitle="View-only · live queues and fares"
        showBack={false}
      />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.weatherWrap}>
          <WeatherCard latitude={STRAIT_POINT.lat} longitude={STRAIT_POINT.lon} place="Mactan–Olango" />
        </View>

        {/* ---------- waiting now ---------- */}
        <View style={styles.sectionHead}>
          <Text style={styles.sectionLabel}>WAITING NOW</Text>
          <Text style={styles.sectionCount}>
            {waiting.length} boat{waiting.length === 1 ? '' : 's'} · {busyPortIds.size} port
            {busyPortIds.size === 1 ? '' : 's'}
          </Text>
        </View>

        {waiting.length === 0 ? (
          <View style={styles.emptyBox}>
            <EmptyState
              icon="anchor"
              title="No boats waiting"
              message="Boats appear here the moment they join a port queue."
            />
          </View>
        ) : (
          <View style={styles.card}>
            {waiting.map((r, i) => (
              <View key={r.queueId} style={[styles.row, i > 0 && styles.rowBorder]}>
                {/* One dot, two states. The old pill repeated the word
                    "online" on every row to say what a colour already says. */}
                <View
                  style={[
                    styles.dot,
                    { backgroundColor: r.isAvailable ? colors.primary : colors.textOnDisabled },
                  ]}
                />
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {r.displayName ?? 'Boat'}
                  </Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {r.port}
                    {!r.isAvailable && ' · offline'}
                  </Text>
                </View>
                <Text
                  style={[styles.rowStat, r.dwellLeft > 0 && styles.rowStatPending]}
                  numberOfLines={1}
                >
                  {r.dwellLeft > 0 ? `dwell ${clock(r.dwellLeft)}` : `ready ${r.listedAt}`}
                </Text>
              </View>
            ))}
          </View>
        )}

        {quietPorts.length > 0 && (
          <Text style={styles.quietNote}>
            No boats at {quietPorts.map((p) => p.portName).join(', ')}.
          </Text>
        )}

        {/* ---------- routes & fares ---------- */}
        <View style={[styles.sectionHead, styles.sectionGap]}>
          <Text style={styles.sectionLabel}>ROUTES &amp; FARES</Text>
          <Text style={styles.sectionCount}>{routes.data.length} routes</Text>
        </View>

        <View style={styles.search}>
          <Icon name="port" size={16} color={colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Filter by port"
            placeholderTextColor={colors.textMuted}
            style={styles.searchInput}
            autoCorrect={false}
            returnKeyType="search"
          />
        </View>

        {routeGroups.length === 0 ? (
          <View style={styles.emptyBox}>
            <EmptyState
              icon="route"
              title="No matching routes"
              message={`Nothing sails to or from "${query.trim()}".`}
            />
          </View>
        ) : (
          routeGroups.map((g) => (
            <View key={g.portId} style={styles.group}>
              <Text style={styles.groupLabel} numberOfLines={1}>FROM {g.name.toUpperCase()}</Text>
              <View style={styles.card}>
                {g.routes.map((r, i) => (
                  <View key={r.routeId} style={[styles.row, i > 0 && styles.rowBorder]}>
                    <View style={styles.rowBody}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {portName(r.endPortId)}
                      </Text>
                      <Text style={styles.rowMeta} numberOfLines={1}>
                        {r.estimatedMinutes ? `${r.estimatedMinutes} min` : 'Duration not set'}
                        {!r.isActive && ' · not running'}
                      </Text>
                    </View>
                    {/* Plain white, tabular. Forty amber fares in a column
                        made the accent meaningless and the numbers ragged. */}
                    <Text style={styles.fare}>₱{r.baseFare}</Text>
                  </View>
                ))}
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

  sectionHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: spacing.md, marginTop: spacing.lg, marginBottom: spacing.sm,
  },
  sectionGap: { marginTop: spacing.xxl },
  sectionLabel: { ...typography.label },
  weatherWrap: { marginBottom: spacing.xl },
  sectionCount: { flexShrink: 1, ...typography.label, ...numeric, fontWeight: '400', letterSpacing: 0 },

  // One card per block, rows inside it. Previously every single port and
  // every single route carried its own border, shadow and corner radius —
  // forty-nine surfaces on one scroll.
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
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { flexShrink: 1, ...typography.bodyStrong, lineHeight: 20 },
  rowMeta: {
    flexShrink: 1, ...typography.label,
    fontWeight: '400', letterSpacing: 0,
  },
  rowStat: { flexShrink: 1, ...typography.label, ...numeric, letterSpacing: 0 },
  rowStatPending: { color: colors.textOnDisabled },

  dot: { width: 8, height: 8, borderRadius: radii.pill },

  quietNote: {
    ...typography.label,
    fontWeight: '400',
    letterSpacing: 0,
    marginTop: spacing.sm,
    lineHeight: 18,
  },

  // ---------- routes ----------
  search: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.md,
    height: 44,
    marginBottom: spacing.lg,
  },
  searchInput: {
    flex: 1, minWidth: 0,
    ...typography.body,
    padding: 0,
  },

  group: { marginBottom: spacing.lg },
  groupLabel: { ...typography.label, marginBottom: spacing.sm },
  fare: { flexShrink: 1, ...typography.bodyStrong, ...numeric },

  emptyBox: { minHeight: 180, justifyContent: 'center' },
});
