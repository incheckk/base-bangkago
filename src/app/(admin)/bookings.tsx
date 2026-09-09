import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { FilterChips } from '@/components/FilterChips';
import { ScreenContainer } from '@/components/ScreenContainer';
import { StatusPill } from '@/components/StatusPill';
import { useAllTrips } from '@/hooks/useAllTrips';
import { colors, radii, spacing, typography } from '@/theme/tokens';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'accepted', label: 'Active' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
];

export default function AdminBookings() {
  const [filter, setFilter] = useState('all');
  const { data, loading, error } = useAllTrips(filter === 'all' ? undefined : filter);
  const [search, setSearch] = useState('');

  const filtered = search.length > 0
    ? data.filter((b) =>
        b.ref.toLowerCase().includes(search.toLowerCase()) ||
        (b.passengerName ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (b.fromPortName ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (b.toPortName ?? '').toLowerCase().includes(search.toLowerCase())
      )
    : data;

  return (
    <ScreenContainer padded={false}>
      <View style={styles.header}>
        <Text style={styles.back} onPress={() => router.back()}>← Back</Text>
        <Text style={styles.headerTitle}>All Bookings</Text>
        <View style={{ width: 50 }} />
      </View>

      <View style={styles.searchWrap}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by ref, name, or route…"
          placeholderTextColor={colors.textMuted}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      <FilterChips filters={FILTERS} active={filter} onChange={setFilter} />

      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        <Text style={styles.count}>{filtered.length} booking{filtered.length !== 1 ? 's' : ''}</Text>

        {loading ? (
          <View style={styles.stateBox}><Text style={styles.loadingText}>Loading…</Text></View>
        ) : error ? (
          <View style={styles.stateBox}><Text style={styles.errorText}>{error}</Text></View>
        ) : filtered.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyIcon}>📋</Text>
            <Text style={styles.emptyTitle}>No bookings found</Text>
          </View>
        ) : (
          filtered.map((b) => (
            <Pressable
              key={b.bookingId}
              onPress={() => router.push(`/(admin)/booking/${b.bookingId}`)}
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            >
              <View style={styles.cardTop}>
                <Text style={styles.ref}>{b.ref}</Text>
                <StatusPill status={b.status as any} />
              </View>
              <Text style={styles.route}>
                {b.fromPortName} → {b.toPortName}
              </Text>
              <View style={styles.cardMeta}>
                <Text style={styles.metaItem}>{b.passengerName ?? 'Passenger'}</Text>
                <Text style={styles.metaDot}>·</Text>
                <Text style={styles.metaItem}>{b.numOfPassenger} pax</Text>
                <Text style={styles.metaDot}>·</Text>
                <Text style={styles.fare}>₱{b.totalPrice}</Text>
              </View>
              <Text style={styles.date}>
                {new Date(b.createdAt).toLocaleDateString('en-PH', {
                  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                })}
              </Text>
            </Pressable>
          ))
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.md,
  },
  back: { color: colors.primary, fontSize: 15, fontWeight: '600' },
  headerTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },

  searchWrap: { paddingHorizontal: spacing.xl, marginBottom: spacing.sm },
  searchInput: {
    backgroundColor: colors.surface, borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.lg, height: 44,
    color: colors.text, fontSize: 14,
  },

  list: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  count: { ...typography.caption, marginBottom: spacing.md },

  stateBox: { minHeight: 160, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: colors.textMuted, fontSize: 13 },
  errorText: { color: colors.danger, fontSize: 13 },
  emptyBox: {
    backgroundColor: colors.surface, borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.borderSubtle,
    padding: spacing.xl, alignItems: 'center',
  },
  emptyIcon: { fontSize: 36, marginBottom: spacing.sm },
  emptyTitle: { color: colors.textSecondary, fontSize: 14 },

  card: {
    backgroundColor: colors.surface, borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.borderSubtle,
    padding: spacing.lg, marginBottom: spacing.sm,
  },
  cardPressed: { borderColor: colors.border },
  cardTop: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: spacing.sm,
  },
  ref: { color: colors.textMuted, fontSize: 11, letterSpacing: 0.5 },
  route: { color: colors.text, fontSize: 15, fontWeight: '700', marginBottom: spacing.xs },
  cardMeta: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
  },
  metaItem: { color: colors.textSecondary, fontSize: 13 },
  metaDot: { color: colors.textMuted },
  fare: { color: '#F59E0B', fontSize: 13, fontWeight: '700' },
  date: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm },
});
