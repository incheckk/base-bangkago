import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { LoadingState, ErrorState, EmptyState } from '@/components/States';
import { StatusPill } from '@/components/StatusPill';
import { useAuth } from '@/hooks/useAuth';
import { useBooking } from '@/hooks/useSupabase';
import {
  acceptBooking, completeBooking, rejectBooking, friendlyError,
} from '@/services/booking.service';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import { formatPhone } from '@/utils/phone';

export default function BookingStatus() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const { user } = useAuth();
  const { data: booking, loading, error } = useBooking(bookingId ?? null);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const uid = user?.id ?? null;

  async function handleAccept() {
    if (!uid || !booking) return;
    setPending(true);
    setActionError(null);
    try {
      await acceptBooking(booking.bookingId, { uid, displayName: '' });
    } catch (e) {
      setActionError(friendlyError(e));
    }
    setPending(false);
  }

  async function handleDecline() {
    if (!uid || !booking) return;
    setPending(true);
    setActionError(null);
    try {
      await rejectBooking(booking.bookingId, uid);
      router.back();
    } catch (e) {
      setActionError(friendlyError(e));
    }
    setPending(false);
  }

  async function handleStartTrip() {
    router.push('/(bangkero)/trip-summary');
  }

  async function handleComplete() {
    if (!booking) return;
    setPending(true);
    setActionError(null);
    try {
      await completeBooking(booking.bookingId);
      router.push('/(bangkero)/trip-summary');
    } catch (e) {
      setActionError(friendlyError(e));
    }
    setPending(false);
  }

  function handleContactPassenger() {
    if (booking?.passengerPhone) {
      const phone = booking.passengerPhone.replace('+', '');
      router.push(`tel:${phone}`);
    }
  }

  return (
    <ScreenContainer padded={false}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.back} onPress={() => router.back()}>← Back</Text>

        <Text style={styles.eyebrow}>BOOKING</Text>
        <Text style={styles.title}>Booking status</Text>

        {loading ? (
          <LoadingState label="Loading booking…" />
        ) : error ? (
          <ErrorState message={error} />
        ) : !booking ? (
          <EmptyState icon="📋" title="Not found" message="This booking could not be loaded." />
        ) : (
          <>
            <View style={styles.refCard}>
              <View style={styles.refTop}>
                <Text style={styles.refText}>{booking.ref}</Text>
                <StatusPill status={booking.status} />
              </View>
              <View style={styles.refRoute}>
                <Text style={styles.refPort}>{booking.fromPortName}</Text>
                <Text style={styles.refArrow}>→</Text>
                <Text style={styles.refPort}>{booking.toPortName}</Text>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardLabel}>PASSENGER INFO</Text>
              <Text style={styles.cardValue}>{booking.passengerName ?? 'N/A'}</Text>
              <Text style={styles.cardSub}>
                {booking.passengerPhone ? formatPhone(booking.passengerPhone) : ''}
              </Text>
              <Text style={styles.cardSub}>{booking.numOfPassenger} pax · ₱{booking.totalPrice}</Text>
            </View>

            {!!actionError && (
              <View style={styles.banner}>
                <Text style={styles.bannerText}>{actionError}</Text>
              </View>
            )}

            <View style={styles.actions}>
              {booking.status === 'open' && (
                <>
                  <PrimaryButton
                    label="Decline"
                    variant="secondary"
                    onPress={handleDecline}
                    loading={pending}
                    style={styles.actionBtn}
                  />
                  <PrimaryButton
                    label="Accept"
                    onPress={handleAccept}
                    loading={pending}
                    style={styles.actionBtn}
                  />
                </>
              )}

              {booking.status === 'accepted' && (
                <>
                  <PrimaryButton
                    label="Contact Passenger"
                    variant="secondary"
                    onPress={handleContactPassenger}
                    style={styles.actionBtn}
                  />
                  <PrimaryButton
                    label="Start Trip"
                    onPress={handleStartTrip}
                    loading={pending}
                    style={styles.actionBtn}
                  />
                </>
              )}

              {booking.status === 'completed' && (
                <PrimaryButton
                  label="View Summary"
                  onPress={() => router.push('/(bangkero)/trip-summary')}
                />
              )}
            </View>
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },

  back: { color: colors.primary, fontSize: 14, fontWeight: '600', marginBottom: spacing.lg },
  eyebrow: { ...typography.label, marginBottom: 2 },
  title: { ...typography.h1, marginBottom: spacing.xl },

  refCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  refTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  refText: { color: colors.textMuted, fontSize: 11, letterSpacing: 0.5 },
  refRoute: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  refPort: { color: colors.text, fontSize: 15, fontWeight: '700' },
  refArrow: { color: colors.primary, fontSize: 15, fontWeight: '700' },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  cardLabel: { ...typography.label, marginBottom: spacing.sm },
  cardValue: { color: colors.text, fontSize: 15, fontWeight: '700' },
  cardSub: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs },

  banner: {
    backgroundColor: 'rgba(224,82,82,0.12)',
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  bannerText: { color: colors.danger, fontSize: 13, lineHeight: 18 },

  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
  actionBtn: { flex: 1 },
});
