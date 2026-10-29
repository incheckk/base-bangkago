import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { AdminScreenHeader } from '@/components/AdminScreenHeader';
import { Icon } from '@/components/Icon';
import { ScreenContainer } from '@/components/ScreenContainer';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { WatchRow, WatchSection, WatchValue } from '@/components/WatchList';
import { useAllPorts } from '@/hooks/useAllPorts';
import { usePorts } from '@/hooks/useSupabase';
import { useRoutes } from '@/hooks/useRoutes';
import { colors, radii, spacing, typography } from '@/theme/tokens';

/**
 * The fare table, view-only. Grouped by departure port and searchable —
 * forty flat rows was a browse, and a fare lookup is a search.
 */
export default function CoastguardRoutes() {
  const allPorts = useAllPorts();
  const activePorts = usePorts();
  const routes = useRoutes();
  const [query, setQuery] = useState('');

  const portName = (id: string) => allPorts.data.find((p) => p.portId === id)?.portName ?? id;

  const groups = useMemo(() => {
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
        <AdminScreenHeader role="coastguard" title="Routes & Fares" showBack={false} />
        <LoadingState label="Loading routes…" />
      </ScreenContainer>
    );
  }

  if (routes.error) {
    return (
      <ScreenContainer>
        <AdminScreenHeader role="coastguard" title="Routes & Fares" showBack={false} />
        <ErrorState message={routes.error} />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padded={false}>
      <AdminScreenHeader
        role="coastguard"
        title="Routes & Fares"
        subtitle={`${routes.data.length} routes`}
        showBack={false}
      />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
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

        {groups.length === 0 ? (
          <View style={styles.emptyBox}>
            <EmptyState
              icon="route"
              title="No matching routes"
              message={`Nothing sails to or from "${query.trim()}".`}
            />
          </View>
        ) : (
          groups.map((g) => (
            <WatchSection
              key={g.portId}
              label={`FROM ${g.name.toUpperCase()}`}
              meta={`${g.routes.length}`}
            >
              {g.routes.map((r, i) => (
                <WatchRow
                  key={r.routeId}
                  first={i === 0}
                  title={portName(r.endPortId)}
                  meta={[
                    r.estimatedMinutes ? `${r.estimatedMinutes} min` : 'Duration not set',
                    r.isActive ? null : 'not running',
                  ].filter(Boolean).join(' · ')}
                  right={<WatchValue>{`₱${r.baseFare}`}</WatchValue>}
                />
              ))}
            </WatchSection>
          ))
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.huge },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.md,
    height: 44,
  },
  searchInput: {
    flex: 1, minWidth: 0,
    ...typography.body,
    padding: 0,
  },
  emptyBox: { minHeight: 180, justifyContent: 'center' },
});
