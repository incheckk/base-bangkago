import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing } from '@/theme/tokens';
import { ScreenContainer } from '@/components/ScreenContainer';
import { PrimaryButton } from '@/components/PrimaryButton';

export default function FindBangkero() {
  const params = useLocalSearchParams<{ from?: string; to?: string; pax?: string; fare?: string }>();
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const [searching, setSearching] = useState(true);

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.4, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    );
    pulse.start();

    const timer = setTimeout(() => {
      setSearching(false);
      router.replace('/(passenger)/trip-en-route');
    }, 3000);

    return () => { pulse.stop(); clearTimeout(timer); };
  }, []);

  return (
    <ScreenContainer>
      <View style={styles.container}>
        {/* Map placeholder */}
        <View style={styles.mapArea}>
          <Text style={styles.mapPlaceholder}>Tracking area</Text>
        </View>

        {/* Searching indicator */}
        <View style={styles.searchingRow}>
          <Animated.View style={[styles.pulseDot, { opacity: pulseAnim }]} />
          <Text style={styles.searchingText}>Looking for available boats nearby...</Text>
        </View>

        {/* Route info card */}
        <View style={styles.card}>
          <View style={styles.routeRow}>
            <Text style={styles.portLabel}>{params.from || 'Batangas Port'}</Text>
            <Text style={styles.arrow}>→</Text>
            <Text style={styles.portLabel}>{params.to || 'Calapan Port'}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.detailsRow}>
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>Passengers</Text>
              <Text style={styles.detailValue}>{params.pax || '2'}</Text>
            </View>
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>Fare</Text>
              <Text style={styles.detailValue}>₱{params.fare || '480'}</Text>
            </View>
          </View>
        </View>

        <View style={styles.bottomArea}>
          <PrimaryButton
            label="Cancel Search"
            onPress={() => router.back()}
            variant="secondary"
          />
        </View>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  mapArea: {
    height: 280,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  mapPlaceholder: { color: colors.textMuted, fontSize: 13 },
  searchingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xl,
    gap: spacing.sm,
  },
  pulseDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },
  searchingText: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  card: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    backgroundColor: colors.bgElevated,
    borderRadius: radii.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
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
  detailsRow: {
    flexDirection: 'row',
    gap: spacing.xl,
  },
  detailItem: { gap: 2 },
  detailLabel: {
    color: colors.textMuted,
    fontSize: 11,
  },
  detailValue: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  bottomArea: {
    marginTop: 'auto',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },
});
