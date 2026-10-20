import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { PassengerScreenHeader } from '@/components/PassengerScreenHeader';
import { ScreenContainer } from '@/components/ScreenContainer';
import { LoadingState } from '@/components/States';
import { useRoutes } from '@/hooks/useRoutes';
import { useAllPorts } from '@/hooks/useAllPorts';
import { colors, radii, spacing, typography } from '@/theme/tokens';

const INFO = [
  { icon: '⏰', title: 'Operating Hours', desc: '5:00 AM – 6:00 PM daily' },
  { icon: '🎫', title: 'Booking Policy', desc: 'Book up to 14 days in advance. Cancel for free any time before departure.' },
  { icon: '🧳', title: 'Luggage Allowance', desc: '1 carry-on bag included. Additional luggage may incur extra fees.' },
  { icon: '⚠️', title: 'Safety', desc: 'Life jackets provided. Trips may be cancelled due to weather conditions.' },
];

export default function FaresInfo() {
  const { data: routes, loading } = useRoutes();
  const { data: ports } = useAllPorts();
  const [query, setQuery] = useState('');

  const nameOf = (id: string) => ports.find((p) => p.portId === id)?.portName ?? id;

  /** Routes grouped by departure port, filtered by the search box. */
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const map = new Map<string, { routeId: string; portName: string; fare: number; minutes: number | null; km: number | null }[]>();
    for (const r of routes) {
      const from = nameOf(r.startPortId);
      const to = nameOf(r.endPortId);
      if (q && !`${from} ${to}`.toLowerCase().includes(q)) continue;
      const list = map.get(from) ?? [];
      list.push({
        routeId: r.routeId,
        portName: to,
        fare: r.baseFare,
        minutes: r.estimatedMinutes ?? null,
        km: r.distanceKm ?? null,
      });
      map.set(from, list);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([from, list]) => ({ from, list: list.sort((a, b) => a.portName.localeCompare(b.portName)) }));
  }, [routes, ports, query]);

  const total = groups.reduce((sum, g) => sum + g.list.length, 0);

  if (loading) return <LoadingState />;

  return (
    <ScreenContainer padded={false}>
      <PassengerScreenHeader title="Fares & Info" />
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Route Fares</Text>
        <Text style={styles.subtitle}>Per person, one way — pick a port to see its crossings</Text>

        <View style={styles.searchBox}>
          <Icon name="search" size={16} color={colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search a port, e.g. Santa Rosa"
            placeholderTextColor={colors.textMuted}
            style={styles.searchInput}
            autoCapitalize="words"
            autoCorrect={false}
            accessibilityLabel="Search ports"
          />
          {query.length > 0 && (
            <Text style={styles.searchCount}>{total}</Text>
          )}
        </View>

        {groups.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTitle}>No route matches “{query.trim()}”</Text>
            <Text style={styles.emptyText}>Try the island name — Marigondon, Caohagan, Olango.</Text>
          </View>
        ) : (
          groups.map((g) => (
            <View key={g.from} style={styles.group}>
              <Text style={styles.groupTitle}>{g.from}</Text>
              {g.list.map((r) => (
                <View key={r.routeId} style={styles.row}>
                  <View style={styles.rowMain}>
                    <Text style={styles.rowTo} numberOfLines={1}>{r.portName}</Text>
                    {(r.minutes || r.km) && (
                      <Text style={styles.rowMeta}>
                        {r.minutes ? `~${r.minutes} min` : ''}
                        {r.minutes && r.km ? ' · ' : ''}
                        {r.km ? `${r.km} km` : ''}
                      </Text>
                    )}
                  </View>
                  <Text style={styles.rowFare}>₱{r.fare}</Text>
                </View>
              ))}
            </View>
          ))
        )}

        <Text style={[styles.title, { marginTop: spacing.xxl }]}>Parcel Delivery</Text>
        <Text style={styles.subtitle}>Inter-island padala rates</Text>

        <View style={styles.card}>
          <View style={styles.parcelHead}>
            <Text style={styles.parcelFare}>₱120</Text>
            <Text style={styles.parcelBase}>base · 10kg included</Text>
          </View>
          <Text style={styles.cardText}>Excess: ₱10/kg over 10kg · Max 50kg</Text>
          <Text style={styles.cardText}>Cross-island routes only (Mactan ↔ Olango)</Text>
        </View>

        <Text style={[styles.title, { marginTop: spacing.xxl }]}>Good to Know</Text>
        {INFO.map((item, i) => (
          <View key={i} style={styles.infoCard}>
            <Text style={styles.infoIcon}>{item.icon}</Text>
            <View style={styles.infoContent}>
              <Text style={styles.infoTitle}>{item.title}</Text>
              <Text style={styles.infoDesc}>{item.desc}</Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  title: { ...typography.h2, marginBottom: spacing.xs },
  subtitle: { ...typography.caption, marginBottom: spacing.lg },

  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.lg, height: 48, marginBottom: spacing.xl,
  },
  searchInput: { flex: 1, minWidth: 0, color: colors.text, fontSize: 15, paddingVertical: 0 },
  searchCount: {
    ...typography.caption, color: colors.primary, fontWeight: '700',
    minWidth: 24, textAlign: 'right',
  },

  group: { marginBottom: spacing.lg },
  groupTitle: { ...typography.label, color: colors.primary, marginBottom: spacing.sm },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    marginBottom: spacing.xs,
  },
  rowMain: { flex: 1, minWidth: 0 },
  rowTo: { ...typography.bodyStrong },
  rowMeta: { ...typography.caption, color: colors.textMuted, fontSize: 12, marginTop: 1 },
  rowFare: { ...typography.h2, color: colors.primary, flexShrink: 0 },

  emptyBox: {
    backgroundColor: colors.surface, borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.borderSubtle,
    padding: spacing.xl, alignItems: 'center',
  },
  emptyTitle: { ...typography.bodyStrong, textAlign: 'center' },
  emptyText: { ...typography.caption, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xs },

  card: {
    backgroundColor: colors.surface, borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.borderSubtle,
    padding: spacing.lg, gap: spacing.xs,
  },
  parcelHead: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  parcelFare: { ...typography.h2, color: colors.primary },
  parcelBase: { ...typography.caption, color: colors.textSecondary },
  cardText: { ...typography.caption, color: colors.textSecondary, lineHeight: 18 },

  infoCard: {
    flexDirection: 'row', gap: spacing.md,
    backgroundColor: colors.surface, borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.borderSubtle,
    padding: spacing.lg, marginBottom: spacing.sm,
  },
  infoIcon: { flexShrink: 1, fontSize: 22 },
  infoContent: { flex: 1, minWidth: 0 },
  infoTitle: { ...typography.bodyStrong, marginBottom: 4 },
  infoDesc: { ...typography.caption, color: colors.textSecondary, lineHeight: 18 },
});
