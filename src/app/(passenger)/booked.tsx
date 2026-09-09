import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing } from '@/theme/tokens';
import { ScreenContainer } from '@/components/ScreenContainer';
import { PrimaryButton } from '@/components/PrimaryButton';
import { StatusPill } from '@/components/StatusPill';

const PASSENGERS = [
  { name: 'Juan Dela Cruz', seat: 'A1' },
  { name: 'Maria Santos', seat: 'A2' },
  { name: 'Pedro Reyes', seat: 'B1' },
];

export default function Booked() {
  return (
    <ScreenContainer>
      <View style={styles.container}>
        {/* Booking reference */}
        <View style={styles.refContainer}>
          <Text style={styles.refLabel}>Booking Reference</Text>
          <Text style={styles.refCode}>BKG-2026-09041</Text>
        </View>

        {/* Status */}
        <View style={styles.statusRow}>
          <StatusPill status="accepted" />
          <Text style={styles.statusText}>Waiting for departure</Text>
        </View>

        {/* Booking details card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Booking Details</Text>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Route</Text>
            <Text style={styles.detailValue}>Batangas → Calapan</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Date</Text>
            <Text style={styles.detailValue}>Sep 9, 2026</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Departure</Text>
            <Text style={styles.detailValue}>8:00 AM</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.detailRow}>
            <Text style={styles.totalLabel}>Total Fare</Text>
            <Text style={styles.totalValue}>₱480.00</Text>
          </View>
        </View>

        {/* Passenger manifest */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Passenger Manifest</Text>
          {PASSENGERS.map((p, i) => (
            <View key={i} style={styles.passengerRow}>
              <View style={styles.seatBadge}>
                <Text style={styles.seatText}>{p.seat}</Text>
              </View>
              <Text style={styles.passengerName}>{p.name}</Text>
            </View>
          ))}
        </View>

        {/* Action buttons */}
        <View style={styles.actions}>
          <PrimaryButton
            label="Track Trip"
            onPress={() => router.push('/(passenger)/trip-en-route')}
          />
          <PrimaryButton
            label="Back to Home"
            onPress={() => router.replace('/')}
            variant="secondary"
          />
        </View>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xxl,
  },
  refContainer: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  refLabel: {
    color: colors.textSecondary,
    fontSize: 13,
    marginBottom: spacing.xs,
  },
  refCode: {
    color: colors.primary,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 1,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  statusText: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: radii.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginBottom: spacing.md,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
    marginBottom: spacing.md,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  detailLabel: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  detailValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '500',
  },
  divider: {
    height: 1,
    backgroundColor: colors.borderSubtle,
    marginVertical: spacing.md,
  },
  totalLabel: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  totalValue: {
    color: colors.primary,
    fontSize: 20,
    fontWeight: '700',
  },
  passengerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  seatBadge: {
    width: 32,
    height: 32,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceAlt,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  seatText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '700',
  },
  passengerName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '500',
  },
  actions: {
    marginTop: 'auto',
    gap: spacing.md,
    paddingBottom: spacing.lg,
  },
});
