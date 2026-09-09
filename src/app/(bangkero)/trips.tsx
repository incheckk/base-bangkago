import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ScrollView, StyleSheet, Text, View,
} from 'react-native';

import { EmptyState } from '@/components/States';
import { FilterChips } from '@/components/FilterChips';
import { ScreenContainer } from '@/components/ScreenContainer';
import { useAuth } from '@/hooks/useAuth';
import { useMyTrips } from '@/hooks/useSupabase';
import { colors, radii, spacing, typography } from '@/theme/tokens';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'completed', label: 'Completed' },
  { key: 'active', label: 'Active' },
];

export default function TripsScreen() {
  const { user } = useAuth();
  const { data: trips, loading, error } = useMyTrips(user?.id ?? null);

  const [filter, setFilter] = useState('all');

  const filtered = useMemo(() => {
    if (filter === 'completed') return trips.filter((t) => t.status === 'completed');
    if (filter === 'active') return trips.filter((t) => t.status === 'accepted');
    return trips;
  }, [trips, filter]);

  return (
    <ScreenContainer padded={false}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.back} onPress={() => router.back()}>← Back</Text>

        <Text style={styles.eyebrow}>TRIPS</Text>
        <Text style={styles.title}>Trip History</Text>

        <FilterChips filters={FILTERS} active={filter} onChange={setFilter} />

        {loading ? (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderText}>Loading trips…</Text>
          </View>
        ) : error ? (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderText}>Failed to load trips</Text>
          </View>
        ) : filtered.length === 0 ? (
          <View style={styles.emptyBox}>
            <EmptyState
              icon="🚤"
              title="No trips yet"
              message="Your completed and active trips will appear here."
            />
          </View>
        ) : (
          filtered.map((trip) => (
            <View key={trip.bookingId} style={styles.card}>
              <View style={styles.cardTop}>
                <Text style={styles.cardRef}>{trip.ref}</Text>
                <View style={[styles.statusBadge, trip.status === 'completed' ? styles.statusCompleted : styles.statusActive]}>
                  <Text style={[styles.statusText, trip.status === 'completed' ? styles.statusTextCompleted : styles.statusTextActive]}>
                    {trip.status === 'completed' ? 'Completed' : 'Active'}
                  </Text>
                </View>
              </View>
              <Text style={styles.route}>
                {trip.fromPortName} → {trip.toPortName}
              </Text>
              <View style={styles.cardMeta}>
                <Text style={styles.metaItem}>
                  {new Date(trip.createdAt).toLocaleDateString()}
                </Text>
                <Text style={styles.metaDivider}>·</Text>
                <Text style={[styles.metaItem, styles.metaFare]}>₱{trip.totalPrice}</Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  back: { color: colors.primary, fontSize: 14, fontWeight: '600', marginBottom: spacing.lg },
  eyebrow: { ...typography.label, marginBottom: 2 },
  title: { ...typography.h1, marginBottom: spacing.lg },

  placeholder: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.xl,
    alignItems: 'center',
  },
  placeholderText: { color: colors.textMuted, fontSize: 14 },

  emptyBox: { minHeight: 200 },

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
  cardRef: { ...typography.caption, color: colors.textMuted, fontSize: 11, letterSpacing: 0.5 },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.pill,
  },
  statusCompleted: { backgroundColor: 'rgba(52,214,176,0.15)' },
  statusActive: { backgroundColor: 'rgba(232,169,60,0.15)' },
  statusText: { fontSize: 11, fontWeight: '700' },
  statusTextCompleted: { color: colors.primary },
  statusTextActive: { color: colors.warning },

  route: { color: colors.text, fontSize: 15, fontWeight: '700', marginBottom: spacing.xs },
  cardMeta: { flexDirection: 'row', alignItems: 'center' },
  metaItem: { ...typography.caption, color: colors.textMuted },
  metaFare: { color: colors.primary, fontWeight: '600' },
  metaDivider: { color: colors.textMuted, marginHorizontal: spacing.sm },
});
