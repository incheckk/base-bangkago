import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { ScreenContainer } from '@/components/ScreenContainer';
import { StatusPill } from '@/components/StatusPill';
import { useAllTrips } from '@/hooks/useAllTrips';
import { colors, radii, spacing, typography } from '@/theme/tokens';

export default function AdminBookingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data } = useAllTrips();
  const booking = data.find((b) => b.bookingId === id);

  if (!booking) {
    return (
      <ScreenContainer>
        <View style={styles.center}>
          <Text style={styles.back} onPress={() => router.back()}>← Back</Text>
          <Text style={styles.emptyTitle}>Booking not found</Text>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padded={false}>
      <View style={styles.header}>
        <Text style={styles.back} onPress={() => router.back()}>← Back</Text>
        <Text style={styles.headerTitle}>Booking Detail</Text>
        <View style={{ width: 50 }} />
      </View>

      <View style={styles.content}>
        <View style={styles.refRow}>
          <Text style={styles.ref}>{booking.ref}</Text>
          <StatusPill status={booking.status as any} />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>ROUTE</Text>
          <Text style={styles.route}>{booking.fromPortName} → {booking.toPortName}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>PASSENGER</Text>
          <Text style={styles.info}>{booking.passengerName ?? 'N/A'}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>OPERATOR</Text>
          <Text style={styles.info}>{booking.operatorName ?? 'Not assigned'}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>DETAILS</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Passengers</Text>
            <Text style={styles.value}>{booking.numOfPassenger}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Total Fare</Text>
            <Text style={styles.valueAccent}>₱{booking.totalPrice}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Created</Text>
            <Text style={styles.value}>
              {new Date(booking.createdAt).toLocaleDateString('en-PH', {
                month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
              })}
            </Text>
          </View>
          {booking.departTime && (
            <View style={styles.row}>
              <Text style={styles.label}>Departure</Text>
              <Text style={styles.value}>
                {new Date(booking.departTime).toLocaleTimeString('en-PH', {
                  hour: '2-digit', minute: '2-digit',
                })}
              </Text>
            </View>
          )}
          {booking.arrivalTime && (
            <View style={styles.row}>
              <Text style={styles.label}>Arrival</Text>
              <Text style={styles.value}>
                {new Date(booking.arrivalTime).toLocaleTimeString('en-PH', {
                  hour: '2-digit', minute: '2-digit',
                })}
              </Text>
            </View>
          )}
        </View>
      </View>
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

  content: { paddingHorizontal: spacing.xl },

  refRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: spacing.xl,
  },
  ref: { color: colors.textMuted, fontSize: 13, letterSpacing: 0.5 },

  card: {
    backgroundColor: colors.surface, borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.borderSubtle,
    padding: spacing.lg, marginBottom: spacing.md,
  },
  cardLabel: { ...typography.label, marginBottom: spacing.sm },
  route: { color: colors.text, fontSize: 16, fontWeight: '700' },
  info: { color: colors.textSecondary, fontSize: 14 },
  row: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  label: { color: colors.textSecondary, fontSize: 13 },
  value: { color: colors.text, fontSize: 13, fontWeight: '600' },
  valueAccent: { color: colors.warning, fontSize: 13, fontWeight: '700' },

  center: { flex: 1, paddingHorizontal: spacing.xl, paddingTop: spacing.lg },
  emptyTitle: { ...typography.h2, marginTop: spacing.xxl, textAlign: 'center' },
});
