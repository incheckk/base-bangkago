import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { ScreenContainer } from '@/components/ScreenContainer';
import { StatusPill } from '@/components/StatusPill';
import { LoadingState, ErrorState } from '@/components/States';
import { useBooking } from '@/hooks/useSupabase';
import { colors, radii, spacing, typography } from '@/theme/tokens';

export default function TripDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: booking, loading, error } = useBooking(id ?? null);

  if (loading) {
    return (
      <ScreenContainer>
        <LoadingState label="Loading trip details…" />
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

  if (!booking) {
    return (
      <ScreenContainer>
        <ErrorState message="Booking not found." />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padded={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.back} onPress={() => router.back()}>← Back</Text>
        <Text style={styles.eyebrow}>TRIP DETAILS</Text>
        <Text style={styles.title}>{booking.ref}</Text>

        <View style={styles.statusRow}>
          <StatusPill status={booking.status} />
        </View>

        {/* Route */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>ROUTE</Text>
          <View style={styles.routeRow}>
            <Text style={styles.port}>{booking.fromPortName}</Text>
            <Text style={styles.arrow}>→</Text>
            <Text style={styles.port}>{booking.toPortName}</Text>
          </View>
        </View>

        {/* Schedule */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>SCHEDULE</Text>
          <InfoRow label="Created" value={formatDate(booking.createdAt)} />
          {booking.departTime && (
            <InfoRow label="Departure" value={formatDate(booking.departTime)} />
          )}
          {booking.arrivalTime && (
            <InfoRow label="Arrival" value={formatDate(booking.arrivalTime)} />
          )}
        </View>

        {/* Passenger */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>PASSENGER INFO</Text>
          <InfoRow label="Passengers" value={`${booking.numOfPassenger} pax`} />
          <InfoRow label="Service" value={capitalize(booking.serviceType)} />
        </View>

        {/* Operator */}
        {booking.operatorName && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>OPERATOR</Text>
            <InfoRow label="Name" value={booking.operatorName} />
            {booking.operatorBoatName && (
              <InfoRow label="Boat" value={booking.operatorBoatName} />
            )}
          </View>
        )}

        {/* Fare */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>FARE BREAKDOWN</Text>
          <InfoRow label="Total fare" value={`₱${booking.totalPrice}`} highlight />
        </View>

        {/* Cancel reason */}
        {booking.cancelReason && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>CANCELLATION</Text>
            <Text style={styles.cancelReason}>{booking.cancelReason}</Text>
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

function InfoRow({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={infoStyles.row}>
      <Text style={infoStyles.label}>{label}</Text>
      <Text style={[infoStyles.value, highlight && infoStyles.highlight]}>{value}</Text>
    </View>
  );
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl, flexGrow: 1 },
  back: { color: colors.primary, fontSize: 14, fontWeight: '600', marginBottom: spacing.lg },
  eyebrow: { ...typography.label, marginBottom: 2 },
  title: { ...typography.h1, marginBottom: spacing.md },
  statusRow: { marginBottom: spacing.xl },
  section: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  sectionLabel: { ...typography.label, marginBottom: spacing.md },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  port: { color: colors.text, fontSize: 18, fontWeight: '700' },
  arrow: { color: colors.primary, fontSize: 18, fontWeight: '700' },
  cancelReason: { color: colors.danger, fontSize: 14, lineHeight: 20 },
});

const infoStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  label: { color: colors.textSecondary, fontSize: 14 },
  value: { color: colors.text, fontSize: 14, fontWeight: '600' },
  highlight: { color: colors.primary, fontSize: 16 },
});
