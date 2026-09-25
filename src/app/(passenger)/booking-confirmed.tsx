import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { PassengerScreenHeader } from '@/components/PassengerScreenHeader';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { colors, radii, spacing, typography } from '@/theme/tokens';

export default function BookingConfirmed() {
  const params = useLocalSearchParams<{
    fromName: string;
    toName: string;
    date: string;
    time: string;
    count: string;
    passengerType: string;
    fare: string;
    ref?: string;
    bookingId?: string;
  }>();

  const bookingRef = params.ref ?? params.bookingId ?? '—';
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
    <ScreenContainer padded={false}>
      <PassengerScreenHeader title="Booking Confirmed" showDrawer={false} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topSection}>
          <Animated.View style={[styles.checkCircle, { transform: [{ scale: scaleAnim }] }]}>
            <Icon name="check" size={40} color={colors.primaryText} />
          </Animated.View>

          <Animated.View style={{ opacity: fadeAnim }}>
            <Text style={styles.title}>Booking Confirmed!</Text>
            <Text style={styles.refLabel}>Booking Reference</Text>
            <Text style={styles.refValue}>{bookingRef}</Text>
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
            <Text style={styles.detailValue} numberOfLines={1}>
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
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  // `alignItems: 'center'` here was the bug: on a flex:1 column it shrinks
  // every child to its content width, so the details card and buttons stopped
  // filling the screen. Centring belongs on the hero block, not the column.
  // ScreenContainer is now padded={false} so this padding is not doubled.
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
  },

  topSection: {
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  checkCircle: {
    width: 80,
    height: 80,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
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
    ...typography.display,
    color: colors.primary,
    fontSize: 24,
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
  routeText: { ...typography.title, flex: 1, minWidth: 0 },
  routeArrow: { ...typography.title, color: colors.primary, fontWeight: '700' },
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
  detailValue: { ...typography.caption, color: colors.text, fontWeight: '600', flexShrink: 1 },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: { ...typography.bodyStrong, fontWeight: '700' },
  totalValue: { flexShrink: 1, ...typography.display, fontSize: 22, color: colors.primary },

  actions: {
    width: '100%',
    gap: spacing.md,
  },
  secondaryBtn: {
    marginTop: 0,
  },
});
