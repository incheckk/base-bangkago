import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ScreenContainer } from '@/components/ScreenContainer';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { StatusPill } from '@/components/StatusPill';
import { useAuth } from '@/hooks/useAuth';
import { useRecentBookings } from '@/hooks/useSupabase';
import { colors, radii, spacing, typography } from '@/theme/tokens';

export default function BookingsScreen() {
  const { user } = useAuth();
  const { data, loading, error } = useRecentBookings(user?.id ?? null, 50);

  const activeBookings = data.filter(
    (b) => b.status === 'open' || b.status === 'accepted'
  );

  if (loading) {
    return (
      <ScreenContainer>
        <LoadingState label="Loading your bookings…" />
      </ScreenContainer>
    );
  }

  if (error) {
    return (
      <ScreenContainer>
        <ErrorState message={error} />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padded={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.back} onPress={() => router.back()}>← Back</Text>
        <Text style={styles.eyebrow}>ACTIVE</Text>
        <Text style={styles.title}>My Bookings</Text>

        {activeBookings.length === 0 ? (
          <EmptyState
            icon="🚤"
            title="No active bookings"
            message="Your current bookings will appear here."
          />
        ) : (
          <View style={styles.list}>
            {activeBookings.map((b) => (
              <Pressable
                key={b.bookingId}
                onPress={() => router.push(`/(passenger)/trip/${b.bookingId}`)}
                style={styles.card}
              >
                <View style={styles.cardTop}>
                  <Text style={styles.ref}>{b.ref}</Text>
                  <StatusPill status={b.status} />
                </View>
                <View style={styles.routeRow}>
                  <Text style={styles.port}>{b.fromPortName}</Text>
                  <Text style={styles.arrow}>→</Text>
                  <Text style={styles.port}>{b.toPortName}</Text>
                </View>
                <View style={styles.details}>
                  <Text style={styles.detail}>{b.numOfPassenger} pax</Text>
                  <Text style={styles.detail}>·</Text>
                  <Text style={styles.detail}>₱{b.totalPrice}</Text>
                  {b.operatorName && (
                    <>
                      <Text style={styles.detail}>·</Text>
                      <Text style={styles.detail}>{b.operatorName}</Text>
                    </>
                  )}
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
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl, flexGrow: 1 },
  back: { color: colors.primary, fontSize: 14, fontWeight: '600', marginBottom: spacing.lg },
  eyebrow: { ...typography.label, marginBottom: 2 },
  title: { ...typography.h1, marginBottom: spacing.xl },
  list: { gap: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  ref: { color: colors.textMuted, fontSize: 11, letterSpacing: 0.5 },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  port: { color: colors.text, fontSize: 15, fontWeight: '700' },
  arrow: { color: colors.primary, fontSize: 15, fontWeight: '700' },
  details: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  detail: { color: colors.textSecondary, fontSize: 13 },
});
