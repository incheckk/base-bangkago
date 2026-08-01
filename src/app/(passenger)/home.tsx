import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ScreenContainer } from '@/components/ScreenContainer';
import { SeaMap } from '@/components/SeaMap';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { StatusPill } from '@/components/StatusPill';
import { useAuth } from '@/hooks/useAuth';
import { useAvailableOperatorCount, usePiers, useRecentBookings } from '@/hooks/useFirestore';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import type { BookingDoc } from '@/types/models';

const SERVICES = [
  { key: 'ride', icon: '⛵', label: 'Boat Ride', enabled: true },
  { key: 'hop', icon: '🏝️', label: 'Island Hop', enabled: false },
  { key: 'padala', icon: '📦', label: 'Padala', enabled: false },
] as const;

export default function PassengerHome() {
  const { user, profile } = useAuth();
  const piers = usePiers();
  const operators = useAvailableOperatorCount();
  const bookings = useRecentBookings(user?.uid ?? null);

  return (
    <ScreenContainer padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.greeting}>
            {profile ? `Kumusta, ${profile.firstName}` : 'Kumusta'}
          </Text>
          <Pressable onPress={() => router.push('/(passenger)/profile')} hitSlop={8}>
            <Text style={styles.profileLink}>Profile</Text>
          </Pressable>
        </View>

        <View style={styles.mapWrap}>
          {piers.error ? (
            <View style={styles.mapFallback}>
              <Text style={styles.mapFallbackText}>Map unavailable — {piers.error}</Text>
            </View>
          ) : (
            <SeaMap piers={piers.data} height={210} />
          )}

          <View style={styles.badge}>
            <View style={[styles.dot, operators.data === 0 && styles.dotOff]} />
            <Text style={styles.badgeText}>
              {operators.loading
                ? 'Checking boats…'
                : operators.data === 0
                  ? 'No boats available'
                  : `${operators.data} boat${operators.data === 1 ? '' : 's'} available`}
            </Text>
          </View>
        </View>

        <View style={styles.sheet}>
          <Text style={styles.sectionLabel}>WHAT DO YOU NEED?</Text>
          <View style={styles.tiles}>
            {SERVICES.map((s) => (
              <Pressable
                key={s.key}
                disabled={!s.enabled}
                onPress={() => router.push('/(passenger)/book')}
                style={({ pressed }) => [
                  styles.tile,
                  !s.enabled && styles.tileDisabled,
                  pressed && s.enabled && styles.tilePressed,
                ]}
              >
                <Text style={[styles.tileIcon, !s.enabled && styles.tileIconDisabled]}>{s.icon}</Text>
                <Text style={[styles.tileLabel, !s.enabled && styles.tileLabelDisabled]}>
                  {s.label}
                </Text>
                {!s.enabled && (
                  <View style={styles.soon}>
                    <Text style={styles.soonText}>Coming soon</Text>
                  </View>
                )}
              </Pressable>
            ))}
          </View>

          <Text style={[styles.sectionLabel, styles.recentLabel]}>RECENT TRIPS</Text>
          <RecentTrips {...bookings} />
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

function RecentTrips({
  data, loading, error,
}: { data: BookingDoc[]; loading: boolean; error: string | null }) {
  if (loading) {
    return <View style={styles.stateBox}><LoadingState label="Loading your trips…" /></View>;
  }
  if (error) {
    return <View style={styles.stateBox}><ErrorState message={error} /></View>;
  }
  if (data.length === 0) {
    return (
      <View style={styles.stateBox}>
        <EmptyState
          icon="⚓"
          title="No trips yet"
          message="Book a boat ride and it will show up here."
        />
      </View>
    );
  }

  return (
    <View style={styles.tripList}>
      {data.map((b) => (
        <Pressable
          key={b.bookingId}
          onPress={() => router.push(`/(passenger)/booking/${b.bookingId}`)}
          style={({ pressed }) => [styles.trip, pressed && styles.tripPressed]}
        >
          <View style={styles.tripTop}>
            <Text style={styles.tripRoute} numberOfLines={1}>
              {b.fromPierName} → {b.toPierName}
            </Text>
            <Text style={styles.tripFare}>₱{b.fare}</Text>
          </View>
          <View style={styles.tripBottom}>
            <StatusPill status={b.status} />
            <Text style={styles.tripRef}>{b.ref}</Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: spacing.xxl },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
  },
  greeting: { ...typography.h2 },
  profileLink: { color: colors.primary, fontSize: 14, fontWeight: '600' },

  mapWrap: { paddingHorizontal: spacing.xl },
  mapFallback: {
    height: 210,
    borderRadius: radii.lg,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  mapFallbackText: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
  badge: {
    position: 'absolute',
    left: spacing.xl + spacing.md,
    top: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(10,22,32,0.82)',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary },
  dotOff: { backgroundColor: colors.textMuted },
  badgeText: { color: colors.text, fontSize: 12, fontWeight: '600' },

  sheet: {
    marginTop: spacing.xl,
    paddingHorizontal: spacing.xl,
  },
  sectionLabel: { ...typography.label, marginBottom: spacing.md },
  recentLabel: { marginTop: spacing.xxl },

  tiles: { flexDirection: 'row', gap: spacing.md },
  tile: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
  },
  tileDisabled: { opacity: 0.5 },
  tilePressed: { borderColor: colors.primary },
  tileIcon: { fontSize: 26, marginBottom: spacing.sm },
  tileIconDisabled: { opacity: 0.6 },
  tileLabel: { color: colors.text, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  tileLabelDisabled: { color: colors.textMuted },
  soon: {
    marginTop: 6,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  soonText: { color: colors.textMuted, fontSize: 9, fontWeight: '700' },

  stateBox: { minHeight: 160 },
  tripList: { gap: spacing.md },
  trip: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
  },
  tripPressed: { borderColor: colors.border },
  tripTop: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  tripRoute: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '600' },
  tripFare: { color: colors.primary, fontSize: 14, fontWeight: '700' },
  tripBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  tripRef: { ...typography.caption, color: colors.textMuted, fontSize: 11 },
});
