import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing } from '@/theme/tokens';
import { ScreenContainer } from '@/components/ScreenContainer';
import { PrimaryButton } from '@/components/PrimaryButton';

export default function TripArrived() {
  return (
    <ScreenContainer>
      <View style={styles.container}>
        {/* Success icon */}
        <View style={styles.iconContainer}>
          <View style={styles.checkCircle}>
            <Text style={styles.checkMark}>✓</Text>
          </View>
        </View>

        <Text style={styles.title}>You've arrived!</Text>
        <Text style={styles.subtitle}>Thank you for riding with BangkaGo</Text>

        {/* Route summary */}
        <View style={styles.card}>
          <View style={styles.routeRow}>
            <Text style={styles.portLabel}>Batangas Port</Text>
            <Text style={styles.arrow}>→</Text>
            <Text style={styles.portLabel}>Calapan Port</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.durationRow}>
            <Text style={styles.durationLabel}>Trip Duration</Text>
            <Text style={styles.durationValue}>1h 45m</Text>
          </View>
        </View>

        {/* Fare breakdown */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Fare Breakdown</Text>
          <View style={styles.fareRow}>
            <Text style={styles.fareLabel}>Base Fare</Text>
            <Text style={styles.fareValue}>₱400.00</Text>
          </View>
          <View style={styles.fareRow}>
            <Text style={styles.fareLabel}>Terminal Fee</Text>
            <Text style={styles.fareValue}>₱50.00</Text>
          </View>
          <View style={styles.fareRow}>
            <Text style={styles.fareLabel}>Service Fee</Text>
            <Text style={styles.fareValue}>₱30.00</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.fareRow}>
            <Text style={styles.totalLabel}>Total Paid</Text>
            <Text style={styles.totalValue}>₱480.00</Text>
          </View>
        </View>

        {/* Action buttons */}
        <View style={styles.actions}>
          <PrimaryButton
            label="Rate Your Trip"
            onPress={() => router.push('/(passenger)/rate-trip')}
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
  iconContainer: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  checkCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkMark: {
    color: colors.primaryText,
    fontSize: 40,
    fontWeight: '700',
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: spacing.xl,
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
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  portLabel: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
  },
  arrow: {
    color: colors.primary,
    fontSize: 20,
    fontWeight: '700',
  },
  divider: {
    height: 1,
    backgroundColor: colors.borderSubtle,
    marginVertical: spacing.md,
  },
  durationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  durationLabel: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  durationValue: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  fareRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  fareLabel: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  fareValue: {
    color: colors.text,
    fontSize: 13,
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
  actions: {
    marginTop: 'auto',
    gap: spacing.md,
    paddingBottom: spacing.lg,
  },
});
