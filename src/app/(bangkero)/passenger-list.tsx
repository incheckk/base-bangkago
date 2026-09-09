import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { FilterChips } from '@/components/FilterChips';
import { ScreenContainer } from '@/components/ScreenContainer';
import { LoadingState, ErrorState, EmptyState } from '@/components/States';
import { useAuth } from '@/hooks/useAuth';
import { useMyTrips } from '@/hooks/useSupabase';
import { colors, radii, spacing, typography } from '@/theme/tokens';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'completed', label: 'Completed' },
];

export default function PassengerList() {
  const { user } = useAuth();
  const { data: trips, loading, error } = useMyTrips(user?.id ?? null);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');

  const filtered = trips.filter((t) => {
    if (activeFilter === 'active' && t.status !== 'accepted') return false;
    if (activeFilter === 'completed' && t.status !== 'completed') return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const name = t.passengerName?.toLowerCase() ?? '';
      const ref = t.ref.toLowerCase();
      if (!name.includes(q) && !ref.includes(q)) return false;
    }
    return true;
  });

  return (
    <ScreenContainer padded={false}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.back} onPress={() => router.back()}>← Back</Text>

        <Text style={styles.eyebrow}>PASSENGERS</Text>
        <Text style={styles.title}>Passenger list</Text>

        <View style={styles.searchBar}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name or booking ref…"
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={setSearch}
          />
        </View>

        <FilterChips filters={FILTERS} active={activeFilter} onChange={setActiveFilter} />

        {loading ? (
          <LoadingState label="Loading passengers…" />
        ) : error ? (
          <ErrorState message={error} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="👤"
            title="No passengers found"
            message="Try a different search or filter."
          />
        ) : (
          filtered.map((t) => (
            <Pressable
              key={t.bookingId}
              style={styles.card}
              onPress={() => router.push({ pathname: '/(bangkero)/passenger-info', params: { bookingId: t.bookingId } })}
            >
              <View style={styles.cardTop}>
                <Text style={styles.name}>{t.passengerName ?? 'Unknown'}</Text>
                <View style={[styles.badge, badgeStyle(t.status)]}>
                  <Text style={[styles.badgeText, badgeTextStyle(t.status)]}>{t.status}</Text>
                </View>
              </View>
              <View style={styles.cardMeta}>
                <Text style={styles.metaText}>{t.ref}</Text>
                <Text style={styles.metaText}>·</Text>
                <Text style={styles.metaText}>{t.fromPortName} → {t.toPortName}</Text>
              </View>
              {t.passengerPhone && (
                <Text style={styles.phone}>{t.passengerPhone}</Text>
              )}
            </Pressable>
          ))
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

function badgeStyle(status: string) {
  if (status === 'accepted') return { backgroundColor: 'rgba(52,214,176,0.14)' };
  if (status === 'completed') return { backgroundColor: 'rgba(169,190,196,0.14)' };
  return { backgroundColor: 'rgba(232,169,60,0.14)' };
}

function badgeTextStyle(status: string) {
  if (status === 'accepted') return { color: colors.primary };
  if (status === 'completed') return { color: colors.textSecondary };
  return { color: colors.warning };
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },

  back: { color: colors.primary, fontSize: 14, fontWeight: '600', marginBottom: spacing.lg },
  eyebrow: { ...typography.label, marginBottom: 2 },
  title: { ...typography.h1, marginBottom: spacing.xl },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  searchIcon: { fontSize: 14, marginRight: spacing.sm },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    paddingVertical: spacing.md,
  },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  name: { color: colors.text, fontSize: 15, fontWeight: '700', flex: 1 },
  badge: {
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radii.pill,
  },
  badgeText: { fontSize: 12, fontWeight: '700' },

  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  metaText: { ...typography.caption, color: colors.textMuted, fontSize: 12 },

  phone: { ...typography.caption, color: colors.textSecondary, fontSize: 12, marginTop: spacing.xs },
});
