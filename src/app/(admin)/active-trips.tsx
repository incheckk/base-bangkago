import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { FilterChips } from '@/components/FilterChips';
import { ScreenContainer } from '@/components/ScreenContainer';
import { useAllTrips } from '@/hooks/useAllTrips';
import { colors, radii, spacing, typography } from '@/theme/tokens';
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'completed', label: 'Completed' },
];

const STATUS_COLORS: Record<string, string> = {
  open: colors.warning,
  accepted: colors.primary,
  completed: colors.textMuted,
};

export default function ActiveTripsScreen() {
  const [filter, setFilter] = useState('all');
  const trips = useAllTrips(filter === 'all' ? undefined : filter);

  return (
    <ScreenContainer padded={false}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.back} onPress={() => router.back()}>← Back</Text>
        <Text style={styles.title}>Active Trips</Text>
        <Text style={styles.count}>
          {trips.loading ? 'Loading…' : `${trips.data.length} trip${trips.data.length === 1 ? '' : 's'}`}
        </Text>

        <View style={styles.chipsWrap}>
          <FilterChips filters={FILTERS} active={filter} onChange={setFilter} />
        </View>

        {trips.loading ? (
          <View style={styles.stateBox}>
            <Text style={styles.loadingText}>Loading trips…</Text>
          </View>
        ) : trips.data.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyIcon}>📋</Text>
            <Text style={styles.emptyTitle}>No trips found</Text>
            <Text style={styles.emptyText}>No trips match the selected filter.</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {trips.data.map((t) => (
              <Pressable
                key={t.bookingId}
                style={({ pressed }) => [styles.tripCard, pressed && styles.cardPressed]}
              >
                <View style={styles.tripTop}>
                  <Text style={styles.tripRef}>{t.ref}</Text>
                  <View style={[styles.statusBadge, { backgroundColor: (STATUS_COLORS[t.status] ?? colors.textMuted) + '20' }]}>
                    <Text style={[styles.statusText, { color: STATUS_COLORS[t.status] ?? colors.textMuted }]}>
                      {t.status.charAt(0).toUpperCase() + t.status.slice(1)}
                    </Text>
                  </View>
                </View>

                <View style={styles.routeRow}>
                  <Text style={styles.port}>{t.fromPortName}</Text>
                  <Text style={styles.arrow}>→</Text>
                  <Text style={styles.port}>{t.toPortName}</Text>
                </View>

                <View style={styles.tripDetails}>
                  <Text style={styles.detail}>₱{t.totalPrice}</Text>
                  {t.operatorName && (
                    <>
                      <Text style={styles.dot}>·</Text>
                      <Text style={styles.detail}>{t.operatorName}</Text>
                    </>
                  )}
                  <Text style={styles.dot}>·</Text>
                  <Text style={styles.detail}>{t.numOfPassenger} pax</Text>
                </View>

                {t.passengerName && (
                  <Text style={styles.passenger}>Passenger: {t.passengerName}</Text>
                )}
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  back: { color: colors.primary, fontSize: 14, fontWeight: '600', marginBottom: spacing.lg },
  title: { ...typography.h1, marginBottom: spacing.xs },
  count: { ...typography.caption, marginBottom: spacing.lg },
  chipsWrap: { marginBottom: spacing.md },

  stateBox: { minHeight: 120, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: colors.textMuted, fontSize: 13 },

  emptyBox: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyIcon: { fontSize: 32, marginBottom: spacing.sm },
  emptyTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  emptyText: { ...typography.caption, marginTop: spacing.xs },

  list: { gap: spacing.md },
  tripCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
  },
  cardPressed: { borderColor: colors.warning },

  tripTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  tripRef: { color: colors.textMuted, fontSize: 11, letterSpacing: 0.5 },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
  },
  statusText: { fontSize: 12, fontWeight: '700' },

  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  port: { color: colors.text, fontSize: 15, fontWeight: '700' },
  arrow: { color: colors.warning, fontSize: 15, fontWeight: '700' },

  tripDetails: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  detail: { color: colors.textSecondary, fontSize: 13 },
  dot: { color: colors.textMuted, fontSize: 13 },

  passenger: { color: colors.textMuted, fontSize: 12, marginTop: spacing.sm },
});
