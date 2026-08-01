import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { StatusPill } from '@/components/StatusPill';
import { useBooking } from '@/hooks/useFirestore';
import { cancelBooking, friendlyError } from '@/services/booking.service';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import { formatPhone } from '@/utils/phone';

export default function BookingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: booking, loading, error } = useBooking(id ?? null);

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function cancel() {
    if (!id) return;
    setBusy(true);
    setActionError(null);
    try {
      await cancelBooking(id);
    } catch (e) {
      setActionError(friendlyError(e));
    }
    setBusy(false);
  }

  if (loading) {
    return <ScreenContainer><LoadingState label="Loading booking…" /></ScreenContainer>;
  }
  if (error) {
    return <ScreenContainer><ErrorState message={error} /></ScreenContainer>;
  }
  if (!booking) {
    return (
      <ScreenContainer>
        <EmptyState icon="🔍" title="Booking not found" message="It may have been removed." />
        <PrimaryButton
          label="Back to home"
          variant="secondary"
          onPress={() => router.replace('/(passenger)/home')}
          style={{ marginBottom: spacing.xl }}
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padded={false}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.ref}>{booking.ref}</Text>
          <StatusPill status={booking.status} />
        </View>

        <View style={styles.card}>
          <Text style={styles.route}>{booking.fromPierName}</Text>
          <Text style={styles.arrow}>↓</Text>
          <Text style={styles.route}>{booking.toPierName}</Text>
        </View>

        {/* Appears the moment a bangkero accepts — no refresh, same listener. */}
        {booking.status === 'accepted' && (
          <View style={styles.operator}>
            <Text style={styles.operatorLabel}>YOUR BANGKERO</Text>
            <Text style={styles.operatorName}>{booking.operatorName}</Text>
            {!!booking.operatorBoatName && (
              <Text style={styles.operatorBoat}>{booking.operatorBoatName}</Text>
            )}
          </View>
        )}

        <View style={styles.details}>
          <Row label="Passengers" value={String(booking.passengerCount)} />
          <Row label="Fare" value={`₱${booking.fare}`} strong />
          <Row label="Estimated time" value={`${booking.estimatedMinutes} min`} />
          <Row label="Payment" value="Cash on board" />
          <Row label="Booked by" value={booking.passengerName} />
          <Row label="Contact" value={formatPhone(booking.passengerPhone)} />
        </View>

        {!!actionError && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>{actionError}</Text>
          </View>
        )}

        <View style={styles.actions}>
          {booking.status === 'open' && (
            <>
              <Text style={styles.waiting}>
                Waiting for a bangkero to accept. This updates on its own.
              </Text>
              <PrimaryButton label="Cancel booking" variant="danger" onPress={cancel} loading={busy} />
            </>
          )}

          {booking.status === 'accepted' && (
            <Text style={styles.waiting}>
              Your bangkero is on the way. Meet them at {booking.fromPierName}.
            </Text>
          )}

          <PrimaryButton
            label="Back to home"
            variant="secondary"
            onPress={() => router.replace('/(passenger)/home')}
            style={{ marginTop: spacing.md }}
          />
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, strong && styles.rowValueStrong]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: spacing.xl, gap: spacing.md,
  },
  ref: { ...typography.h2, letterSpacing: 1 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.xl,
    alignItems: 'center',
  },
  route: { color: colors.text, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  arrow: { color: colors.primary, fontSize: 18, marginVertical: spacing.sm },

  operator: {
    marginTop: spacing.lg,
    backgroundColor: 'rgba(52,214,176,0.10)',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.primary,
    padding: spacing.lg,
  },
  operatorLabel: { ...typography.label, color: colors.primary, marginBottom: spacing.sm },
  operatorName: { color: colors.text, fontSize: 16, fontWeight: '700' },
  operatorBoat: { ...typography.caption, marginTop: 2 },

  details: {
    marginTop: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm, gap: spacing.md },
  rowLabel: { ...typography.caption },
  rowValue: { color: colors.text, fontSize: 13, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  rowValueStrong: { color: colors.primary, fontSize: 15, fontWeight: '700' },

  banner: {
    marginTop: spacing.lg,
    backgroundColor: 'rgba(224,82,82,0.12)',
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  bannerText: { color: colors.danger, fontSize: 13, lineHeight: 18 },

  actions: { marginTop: spacing.xl },
  waiting: { ...typography.caption, textAlign: 'center', marginBottom: spacing.lg, lineHeight: 18 },
});
