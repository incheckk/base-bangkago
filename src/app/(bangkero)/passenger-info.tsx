import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { ScreenContainer } from '@/components/ScreenContainer';
import { LoadingState, ErrorState, EmptyState } from '@/components/States';
import { useAuth } from '@/hooks/useAuth';
import { useBooking } from '@/hooks/useSupabase';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import { formatPhone } from '@/utils/phone';

export default function PassengerInfo() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const { data: booking, loading, error } = useBooking(bookingId ?? null);

  return (
    <ScreenContainer padded={false}>
      <View style={styles.scroll}>
        <Text style={styles.back} onPress={() => router.back()}>← Back</Text>

        <Text style={styles.eyebrow}>PASSENGER</Text>
        <Text style={styles.title}>Passenger info</Text>

        {loading ? (
          <LoadingState label="Loading passenger…" />
        ) : error ? (
          <ErrorState message={error} />
        ) : !booking ? (
          <EmptyState icon="👤" title="Not found" message="This booking could not be loaded." />
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.label}>NAME</Text>
              <Text style={styles.value}>{booking.passengerName ?? 'N/A'}</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.label}>CONTACT NUMBER</Text>
              <Text style={styles.value}>
                {booking.passengerPhone ? formatPhone(booking.passengerPhone) : 'N/A'}
              </Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.label}>PASSENGER TYPE</Text>
              <Text style={styles.value}>Regular</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.label}>BOOKING REFERENCE</Text>
              <Text style={styles.value}>{booking.ref}</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.label}>ROUTE</Text>
              <Text style={styles.value}>
                {booking.fromPortName} → {booking.toPortName}
              </Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.label}>WEIGHT DECLARATION</Text>
              <Text style={styles.value}>{booking.numOfPassenger} pax · ₱{booking.totalPrice}</Text>
            </View>
          </>
        )}
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },

  back: { color: colors.primary, fontSize: 14, fontWeight: '600', marginBottom: spacing.lg },
  eyebrow: { ...typography.label, marginBottom: 2 },
  title: { ...typography.h1, marginBottom: spacing.xl },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  label: { ...typography.label, marginBottom: spacing.sm },
  value: { color: colors.text, fontSize: 15, fontWeight: '600' },
});
