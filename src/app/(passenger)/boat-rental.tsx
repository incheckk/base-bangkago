import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { PassengerScreenHeader } from '@/components/PassengerScreenHeader';
import { ScreenContainer } from '@/components/ScreenContainer';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { useRealtimeQuery } from '@/hooks/useRealtimeQuery';
import { friendlyError } from '@/services/booking.service';
import { getRentableBangkas, type RentableBangka } from '@/services/rental.service';
import { colors, elevation, radii, spacing, typography } from '@/theme/tokens';

/**
 * Boat Rental catalog (Phase 4C): every verified operator's boat with
 * its hourly charter rate (016). Tapping a boat opens the rental
 * form; "My Rentals" is where filed requests and their escrow status
 * live.
 */
export default function BoatRentalScreen() {
  const [boats, setBoats] = useState<RentableBangka[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = await getRentableBangkas();
      setBoats(rows);
      setError(null);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useRealtimeQuery(load, [{ table: 'bangkas' }]);

  if (loading) {
    return (
      <ScreenContainer>
        <PassengerScreenHeader title="Boat Rental" />
        <LoadingState label="Loading boats…" />
      </ScreenContainer>
    );
  }

  if (error) {
    return (
      <ScreenContainer>
        <PassengerScreenHeader title="Boat Rental" />
        <ErrorState message={error} />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padded={false}>
      <PassengerScreenHeader
        title="Boat Rental"
        subtitle="Charter a boat by the hour — 50% GCash downpayment holds your date."
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Pressable
          onPress={() => router.push('/(passenger)/my-rentals')}
          accessibilityRole="button"
          style={({ pressed }) => [styles.myRentals, pressed && styles.myRentalsPressed]}
        >
          <Icon name="rental" size={18} color={colors.primary} />
          <Text style={styles.myRentalsText}>My Rentals</Text>
          <Icon name="forward" size={16} color={colors.textMuted} />
        </Pressable>

        <Text style={styles.sectionLabel}>RENTABLE BOATS</Text>

        {boats.length === 0 ? (
          <EmptyState
            icon="🚤"
            title="No boats yet"
            message="Verified operators' boats will appear here once they are registered."
          />
        ) : (
          <View style={styles.list}>
            {boats.map((b) => (
              <Pressable
                key={b.bangkaId}
                onPress={() =>
                  router.push({
                    pathname: '/(passenger)/rental-form',
                    params: {
                      bangkaId: b.bangkaId,
                      boatName: b.bangkaName,
                      operatorName: b.displayName,
                      bangkeroId: b.bangkeroId,
                      rate: String(b.hourlyRate),
                      capacity: String(b.capacity),
                    },
                  })
                }
                accessibilityRole="button"
                accessibilityLabel={`${b.bangkaName}, ${b.hourlyRate} pesos per hour`}
                style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
              >
                <View style={styles.cardTop}>
                  <View style={styles.cardTitleWrap}>
                    <Text style={styles.cardName} numberOfLines={1}>{b.bangkaName}</Text>
                    <Text style={styles.cardOperator} numberOfLines={1}>by {b.displayName}</Text>
                  </View>
                  <View style={styles.priceWrap}>
                    <Text style={styles.price}>₱{b.hourlyRate}</Text>
                    <Text style={styles.priceUnit}>per hour</Text>
                  </View>
                </View>
                <View style={styles.metaRow}>
                  <Text style={styles.meta}>👥 up to {b.capacity} pax</Text>
                  {!!b.bangkaType && <Text style={styles.meta}>{b.bangkaType}</Text>}
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.huge },

  myRentals: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.lg,
    minHeight: 52,
    ...elevation.e1,
  },
  myRentalsPressed: { borderColor: colors.primary, backgroundColor: colors.surfaceAlt },
  myRentalsText: { flex: 1, ...typography.bodyStrong, color: colors.primary },

  sectionLabel: { ...typography.label, marginTop: spacing.xl, marginBottom: spacing.md },
  list: { gap: spacing.md },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    ...elevation.e1,
  },
  cardPressed: { borderColor: colors.primary, backgroundColor: colors.surfaceAlt },

  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  cardTitleWrap: { flex: 1, minWidth: 0 },
  cardName: { ...typography.title, fontSize: 16, flexShrink: 1 },
  cardOperator: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  priceWrap: { alignItems: 'flex-end' },
  price: { ...typography.h2, color: colors.primary },
  priceUnit: { ...typography.label, letterSpacing: 0, fontSize: 10 },

  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, marginTop: spacing.md },
  meta: { ...typography.caption, color: colors.textMuted, fontSize: 11 },
});
