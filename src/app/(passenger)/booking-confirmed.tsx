import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { PassengerScreenHeader } from '@/components/PassengerScreenHeader';
import { PrimaryButton } from '@/components/PrimaryButton';
import { slotLabel } from '@/components/SchedulePicker';
import { ScreenContainer } from '@/components/ScreenContainer';
import { useLockBack } from '@/hooks/useLockBack';
import { colors, radii, spacing, typography } from '@/theme/tokens';

export default function BookingConfirmed() {
  // Terminal screen: back (arrow, gesture or hardware) must never re-open
  // the payment form — that was the double-booking path.
  useLockBack();
  const params = useLocalSearchParams<{
    fromName: string;
    toName: string;
    count: string;
    serviceType?: string;
    fare: string;
    ref?: string;
    bookingId?: string;
    parcelId?: string;
    receiverName?: string;
    packageName?: string;
    downAmount?: string;
    downStatus?: string;
    downWarning?: string;
    payWarning?: string;
    parcelWarning?: string;
    remainder?: string;
    scheduledDate?: string;
    scheduledTime?: string;
  }>();

  const bookingRef = params.ref ?? params.bookingId ?? '—';
  // Escrow bookings (020) are 'pending' until the admin clears them —
  // the reference and QR cards wait on booking/[id] for that moment.
  const awaitingAdmin = params.downStatus === 'pending';
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
  const isCargo = params.serviceType === 'cargo' && !!params.parcelId;
  const isPackage = !!params.downAmount;
  const downAmount = parseInt(params.downAmount ?? '0', 10) || 0;
  const remainder = parseInt(params.remainder ?? '0', 10) || 0;

  return (
    <ScreenContainer padded={false}>
      <PassengerScreenHeader title="Booking Requested" showDrawer={false} showBack={false} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topSection}>
          <Animated.View style={[styles.checkCircle, { transform: [{ scale: scaleAnim }] }]}>
            <Icon name="check" size={40} color={colors.primaryText} />
          </Animated.View>

          <Animated.View style={{ opacity: fadeAnim }}>
            <Text style={styles.title}>Booking Requested!</Text>
            <Text style={styles.refLabel}>
              {awaitingAdmin ? 'Status' : 'Booking Reference'}
            </Text>
            {awaitingAdmin ? (
              <Text style={styles.awaitValue}>Awaiting admin confirmation</Text>
            ) : (
              <Text style={styles.refValue}>{bookingRef}</Text>
            )}
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
            <Text style={styles.detailLabel}>Trip date</Text>
            <Text style={styles.detailValue}>
              {params.scheduledDate
                ? new Date(`${params.scheduledDate}T00:00:00`).toLocaleDateString('en-PH', {
                    month: 'short', day: 'numeric', year: 'numeric',
                  }) + (params.scheduledTime ? ` · ${slotLabel(params.scheduledTime)}` : '')
                : `Today · ${new Date().toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}`}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Passengers</Text>
            <Text style={styles.detailValue} numberOfLines={1}>{paxCount}</Text>
          </View>
          {!!params.packageName && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Package</Text>
              <Text style={styles.detailValue} numberOfLines={2}>{params.packageName}</Text>
            </View>
          )}
          {isPackage && (
            <>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>GCash downpayment (50%)</Text>
                <Text style={styles.detailValue} numberOfLines={2}>
                  ₱{downAmount}
                  {params.downStatus === 'pending' ? ' · awaiting admin confirmation' : ''}
                </Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Collected onboard</Text>
                <Text style={styles.detailValue}>₱{remainder}</Text>
              </View>
            </>
          )}
          <View style={styles.divider} />
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>
              {isPackage ? 'Total trip price' : 'Total to be paid'}
            </Text>
            <Text style={styles.totalValue}>₱{fare}</Text>
          </View>
        </Animated.View>

        {params.downWarning === '1' && (
          <Animated.View style={[styles.warnBanner, { opacity: fadeAnim }]}>
            <Text style={styles.warnText}>
              Your downpayment record did not save. Keep your GCash reference and screenshot,
              then contact support with booking ref {bookingRef}.
            </Text>
          </Animated.View>
        )}
        {params.payWarning === '1' && (
          <Animated.View style={[styles.warnBanner, { opacity: fadeAnim }]}>
            <Text style={styles.warnText}>
              Your payment choice did not save. The fare will still be collected onboard —
              booking ref {bookingRef} is confirmed.
            </Text>
          </Animated.View>
        )}
        {params.parcelWarning === '1' && (
          <Animated.View style={[styles.warnBanner, { opacity: fadeAnim }]}>
            <Text style={styles.warnText}>
              Your parcel record did not save. Your booking exists — give the bangkero your
              cargo details at the pier (booking ref {bookingRef}).
            </Text>
          </Animated.View>
        )}

        <Animated.View style={[styles.actions, { opacity: fadeAnim }]}>
          {isCargo ? (
            <PrimaryButton
              label="Track Delivery"
              onPress={() => router.replace({
                pathname: '/(passenger)/track-delivery',
                params: {
                  parcelId: params.parcelId,
                  status: 'pending',
                  receiverName: params.receiverName ?? '',
                  toPort: params.toName ?? '',
                },
              })}
            />
          ) : (
            <PrimaryButton
              label="View Booking"
              onPress={() =>
                router.replace(
                  params.bookingId
                    ? `/(passenger)/booking/${params.bookingId}`
                    : '/(passenger)/home',
                )
              }
            />
          )}
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
  awaitValue: {
    ...typography.bodyStrong,
    color: colors.textSecondary,
    fontSize: 16,
    textAlign: 'center',
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

  warnBanner: {
    width: '100%',
    backgroundColor: colors.dangerTint,
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.xl,
  },
  warnText: { color: colors.danger, fontSize: 13, lineHeight: 18 },
});
