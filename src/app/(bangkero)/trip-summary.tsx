import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { useAuth } from '@/hooks/useAuth';
import { useTripManifest } from '@/hooks/useTripManifest';
import { colors, radii, spacing, typography } from '@/theme/tokens';

export default function TripSummary() {
  const { user } = useAuth();
  const { manifest, passengers, parcels } = useTripManifest(user?.id ?? null);

  const departure = manifest?.actualDepartureTime
    ? new Date(manifest.actualDepartureTime)
    : null;
  const arrival = manifest?.actualArrivalTime
    ? new Date(manifest.actualArrivalTime)
    : null;

  let durationText = '—';
  if (departure && arrival) {
    const diffMs = arrival.getTime() - departure.getTime();
    const mins = Math.round(diffMs / 60000);
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    durationText = hrs > 0 ? `${hrs}h ${rem}m` : `${rem}m`;
  }

  return (
    <ScreenContainer padded={false}>
      <View style={styles.scroll}>
        <View style={styles.checkCircle}>
          <Text style={styles.checkMark}>✓</Text>
        </View>
        <Text style={styles.title}>Trip Complete</Text>

        <View style={styles.routeCard}>
          <View style={styles.routeRow}>
            <Text style={styles.routeLabel}>From</Text>
            <Text style={styles.routePort}>Departure Port</Text>
          </View>
          <View style={styles.routeDivider} />
          <View style={styles.routeRow}>
            <Text style={styles.routeLabel}>To</Text>
            <Text style={styles.routePort}>Arrival Port</Text>
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{passengers.length}</Text>
            <Text style={styles.statLabel}>Passengers</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{parcels.length}</Text>
            <Text style={styles.statLabel}>Parcels</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{durationText}</Text>
            <Text style={styles.statLabel}>Duration</Text>
          </View>
        </View>

        <View style={styles.fareCard}>
          <Text style={styles.fareTitle}>Fare Breakdown</Text>
          <View style={styles.fareRow}>
            <Text style={styles.fareLabel}>Passengers ({passengers.length})</Text>
            <Text style={styles.fareValue}>
              ₱{passengers.length > 0 ? (passengers.length * 150).toFixed(2) : '0.00'}
            </Text>
          </View>
          <View style={styles.fareRow}>
            <Text style={styles.fareLabel}>Parcels ({parcels.length})</Text>
            <Text style={styles.fareValue}>
              ₱{parcels.length > 0 ? (parcels.length * 50).toFixed(2) : '0.00'}
            </Text>
          </View>
          <View style={styles.fareDivider} />
          <View style={styles.fareRow}>
            <Text style={styles.fareTotal}>Total</Text>
            <Text style={styles.fareTotalValue}>
              ₱{((passengers.length * 150) + (parcels.length * 50)).toFixed(2)}
            </Text>
          </View>
        </View>

        <View style={styles.footer}>
          <PrimaryButton label="Done" onPress={() => router.replace('/(bangkero)/home')} />
        </View>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
    alignItems: 'center',
  },

  checkCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xxl,
    marginBottom: spacing.lg,
  },
  checkMark: { color: colors.primaryText, fontSize: 28, fontWeight: '700' },

  title: { ...typography.h1, textAlign: 'center', marginBottom: spacing.xl },

  routeCard: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  routeRow: { paddingVertical: spacing.sm },
  routeLabel: { ...typography.label, marginBottom: 4 },
  routePort: { color: colors.text, fontSize: 15, fontWeight: '700' },
  routeDivider: { height: 1, backgroundColor: colors.borderSubtle, marginVertical: spacing.xs },

  statsRow: {
    flexDirection: 'row',
    width: '100%',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  stat: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    alignItems: 'center',
  },
  statValue: { color: colors.primary, fontSize: 20, fontWeight: '700' },
  statLabel: { ...typography.caption, color: colors.textMuted, marginTop: 4, fontSize: 11 },

  fareCard: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  fareTitle: { ...typography.label, marginBottom: spacing.md },
  fareRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  fareLabel: { color: colors.textSecondary, fontSize: 14 },
  fareValue: { color: colors.text, fontSize: 14, fontWeight: '600' },
  fareDivider: { height: 1, backgroundColor: colors.borderSubtle, marginVertical: spacing.sm },
  fareTotal: { color: colors.text, fontSize: 15, fontWeight: '700' },
  fareTotalValue: { color: colors.primary, fontSize: 15, fontWeight: '700' },

  footer: { width: '100%', marginTop: spacing.sm },
});
