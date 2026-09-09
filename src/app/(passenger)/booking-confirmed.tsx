import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { colors, radii, spacing, typography } from '@/theme/tokens';

function generateRef(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 6; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return `BGO-${id}`;
}

export default function BookingConfirmed() {
  const params = useLocalSearchParams<{
    fromName: string;
    toName: string;
    date: string;
    time: string;
    count: string;
    passengerType: string;
    fare: string;
  }>();

  const bookingRef = useRef(generateRef());
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 5,
        tension: 40,
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const paxCount = parseInt(params.count ?? '1', 10);
  const fare = parseInt(params.fare ?? '0', 10);

  return (
    <ScreenContainer>
      <View style={styles.container}>
        <View style={styles.topSection}>
          <Animated.View style={[styles.checkCircle, { transform: [{ scale: scaleAnim }] }]}>
            <Text style={styles.checkIcon}>✓</Text>
          </Animated.View>

          <Animated.View style={{ opacity: fadeAnim }}>
            <Text style={styles.title}>Booking Confirmed!</Text>
            <Text style={styles.refLabel}>Booking Reference</Text>
            <Text style={styles.refValue}>{bookingRef.current}</Text>
          </Animated.View>
        </View>

        <Animated.View style={[styles.detailsCard, { opacity: fadeAnim }]}>
          <View style={styles.routeRow}>
            <Text style={styles.routeText} numberOfLines={1}>
              {params.fromName ?? '—'}
            </Text>
            <Text style={styles.routeArrow}> → </Text>
            <Text style={styles.routeText} numberOfLines={1}>
              {params.toName ?? '—'}
            </Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Date</Text>
            <Text style={styles.detailValue}>{params.date ?? '—'}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Time</Text>
            <Text style={styles.detailValue}>{params.time ?? '—'}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Passengers</Text>
            <Text style={styles.detailValue}>
              {paxCount} · {(params.passengerType ?? 'Regular').charAt(0).toUpperCase() +
                (params.passengerType ?? 'Regular').slice(1)}
            </Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total Paid</Text>
            <Text style={styles.totalValue}>₱{fare}</Text>
          </View>
        </Animated.View>

        <Animated.View style={[styles.actions, { opacity: fadeAnim }]}>
          <PrimaryButton
            label="Track Boat"
            onPress={() => router.replace('/(passenger)/find-bangkero')}
          />
          <PrimaryButton
            label="Back to Home"
            variant="secondary"
            onPress={() => router.replace('/(passenger)/home')}
            style={styles.secondaryBtn}
          />
        </Animated.View>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },

  topSection: {
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  checkCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  checkIcon: {
    color: colors.primaryText,
    fontSize: 40,
    fontWeight: '700',
  },

  title: {
    ...typography.h1,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  refLabel: {
    ...typography.caption,
    textAlign: 'center',
  },
  refValue: {
    color: colors.primary,
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 2,
    marginTop: spacing.sm,
  },

  detailsCard: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.xl,
    marginBottom: spacing.xl,
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  routeText: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  routeArrow: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '700',
  },
  divider: {
    height: 1,
    backgroundColor: colors.borderSubtle,
    marginVertical: spacing.md,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  detailLabel: { ...typography.caption },
  detailValue: { color: colors.text, fontSize: 13, fontWeight: '600' },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: { color: colors.text, fontSize: 15, fontWeight: '700' },
  totalValue: { color: colors.primary, fontSize: 22, fontWeight: '700' },

  actions: {
    width: '100%',
    gap: spacing.md,
  },
  secondaryBtn: {
    marginTop: 0,
  },
});
