import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PassengerScreenHeader } from '@/components/PassengerScreenHeader';
import { ScreenContainer } from '@/components/ScreenContainer';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { StatusPill } from '@/components/StatusPill';
import { useAuth } from '@/hooks/useAuth';
import { useRecentBookings } from '@/hooks/useSupabase';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import type { BookingDoc } from '@/types/models';

/**
 * Which timestamp matters depends on where the booking ended up. Showing
 * `createdAt` on a finished trip answers the wrong question — the list had no
 * date at all, so a completed and a cancelled trip looked equally undated.
 */
function statusDate(b: BookingDoc): { label: string; iso: string } | null {
  if (b.status === 'completed' && b.completedAt) return { label: 'Completed', iso: b.completedAt };
  if (b.status === 'cancelled' && b.cancelledAt) return { label: 'Cancelled', iso: b.cancelledAt };
  if (b.status === 'accepted' && b.acceptedAt) return { label: 'Accepted', iso: b.acceptedAt };
  if (b.createdAt) return { label: 'Requested', iso: b.createdAt };
  return null;
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString('en-PH', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });

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
      <PassengerScreenHeader title="My Bookings" subtitle="ACTIVE" />

      <ScrollView contentContainerStyle={styles.scroll}>
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
                  <View style={styles.rail}>
                    <View style={styles.railDot} />
                    <View style={styles.railLine} />
                    <View style={[styles.railDot, styles.railDotEnd]} />
                  </View>
                  <View style={styles.routeText}>
                    <Text style={styles.port} numberOfLines={1}>{b.fromPortName}</Text>
                    <Text style={[styles.port, styles.portTo]} numberOfLines={1}>
                      {b.toPortName}
                    </Text>
                  </View>
                </View>
                <View style={styles.details}>
                  <Text style={styles.detail} numberOfLines={1}>
                    {b.numOfPassenger} pax · ₱{b.totalPrice}
                    {b.operatorName ? ` · ${b.operatorName}` : ''}
                  </Text>
                  {(() => {
                    const d = statusDate(b);
                    return d ? (
                      <Text style={styles.dateLine} numberOfLines={1}>
                        {d.label} {fmt(d.iso)}
                      </Text>
                    ) : null;
                  })()}
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
  ref: { ...typography.label, color: colors.textMuted, letterSpacing: 0.5, flexShrink: 1 },

  // Ports stack on a rail instead of sitting side by side. Two long port names
  // on one row cannot fit a phone width, and RN defaults flexShrink to 0 — so
  // the old row let text run straight out past the card border.
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rail: { alignItems: 'center' },
  railDot: { width: 8, height: 8, borderRadius: radii.pill, backgroundColor: colors.primary },
  railDotEnd: { borderRadius: radii.xs, backgroundColor: colors.textSecondary },
  railLine: { width: 2, height: 18, backgroundColor: colors.border, marginVertical: spacing.xxs },
  routeText: { flex: 1, minWidth: 0 },
  port: { flexShrink: 1, ...typography.bodyStrong },
  portTo: { marginTop: spacing.md },

  details: { marginTop: spacing.md },
  detail: { flexShrink: 1, ...typography.caption, color: colors.textSecondary },
  dateLine: { flexShrink: 1, ...typography.caption, color: colors.textMuted, fontSize: 11, marginTop: spacing.xxs },
});
