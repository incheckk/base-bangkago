import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';

import { BangkeroScreenHeader } from '@/components/BangkeroScreenHeader';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { useAuth } from '@/hooks/useAuth';
import { useBangkeroParcels } from '@/hooks/useBangkeroParcels';
import { useRealtimeQuery, useRefetchOnFocus } from '@/hooks/useRealtimeQuery';
import { useMyTrips } from '@/hooks/useSupabase';
import { friendlyError } from '@/services/booking.service';
import { getDownpaymentsForBookings } from '@/services/downpayment.service';
import {
  getPassengerDetailsByBooking,
} from '@/services/passenger-detail.service';
import {
  getPaymentsForBookings, markBookingPaid,
} from '@/services/payment.service';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import type {
  DownpaymentDoc, ParcelDoc, PassengerDetailDoc, PaymentDoc, PaymentMethod,
} from '@/types/models';
import {
  Sailing, buildSailings, sailingAboard, sailingDayLabel,
} from '@/utils/sailings';
import { formatPhone } from '@/utils/phone';

const METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  gcash: 'GCash',
  maya: 'Maya',
  bank_transfer: 'Bank transfer',
};

/**
 * One sailing, opened from the manifest: the passengers booked on it
 * (main passenger + companions), its parcels, and the pay-on-board
 * checklist with Mark as paid (migration 012). Everything reloads on
 * realtime/focus, so a status flip on the departure screen shows here.
 */
export default function SailingScreen() {
  const params = useLocalSearchParams<{ day?: string; from?: string; to?: string }>();
  const day = typeof params.day === 'string' ? params.day : '';
  const from = typeof params.from === 'string' ? params.from : '';
  const to = typeof params.to === 'string' ? params.to : '';

  const { user } = useAuth();
  const uid = user?.id ?? null;

  const trips = useMyTrips(uid);
  const parcels = useBangkeroParcels(uid);

  const [payments, setPayments] = useState<Record<string, PaymentDoc>>({});
  const [downs, setDowns] = useState<Record<string, DownpaymentDoc>>({});
  const [details, setDetails] = useState<Record<string, PassengerDetailDoc[]>>({});
  const [payingId, setPayingId] = useState<string | null>(null);
  const [reference, setReference] = useState('');
  const [payError, setPayError] = useState<string | null>(null);

  const sailing: Sailing | null = useMemo(() => {
    const key = `${day}|${from}|${to}`;
    if (!day || !from || !to) return null;
    return buildSailings(trips.data, parcels.data, payments).find((s) => s.key === key) ?? null;
  }, [trips.data, parcels.data, payments, day, from, to]);

  const bookingIds = useMemo(
    () => (sailing ? sailing.bookings.map((b) => b.bookingId) : []),
    [sailing]
  );

  const loadPayments = useCallback(async () => {
    if (trips.data.length === 0) {
      setPayments({});
      return;
    }
    try {
      const rows = await getPaymentsForBookings(trips.data.map((t) => t.bookingId));
      setPayments(Object.fromEntries(rows.map((r) => [r.bookingId, r])));
    } catch {
      // chips keep their last value; focus/realtime retries
    }
  }, [trips.data]);
  useEffect(() => { void loadPayments(); }, [loadPayments]);
  useRealtimeQuery(loadPayments, [{ table: 'payments' }]);

  const loadDetails = useCallback(async () => {
    if (bookingIds.length === 0) {
      setDetails({});
      return;
    }
    try {
      const rows = await Promise.all(
        bookingIds.map(async (id) => [id, await getPassengerDetailsByBooking(id)] as const)
      );
      setDetails(Object.fromEntries(rows));
    } catch {
      // companions stay hidden; focus retries
    }
  }, [bookingIds]);
  useEffect(() => { void loadDetails(); }, [loadDetails]);
  useRefetchOnFocus(loadDetails);

  const loadDowns = useCallback(async () => {
    if (bookingIds.length === 0) {
      setDowns({});
      return;
    }
    try {
      const rows = await getDownpaymentsForBookings(bookingIds);
      setDowns(Object.fromEntries(rows.map((r) => [r.bookingId, r])));
    } catch {
      // rows keep their last value; focus/realtime retries
    }
  }, [bookingIds]);
  useEffect(() => { void loadDowns(); }, [loadDowns]);
  useRealtimeQuery(loadDowns, [{ table: 'downpayments' }]);

  async function markPaid(bookingId: string) {
    setPayingId(bookingId);
    setPayError(null);
    try {
      await markBookingPaid(bookingId, reference.trim() || undefined);
      await loadPayments();
    } catch (e) {
      setPayError(friendlyError(e));
    }
    setPayingId(null);
  }

  if (trips.loading) {
    return (
      <ScreenContainer padded={false}>
        <BangkeroScreenHeader eyebrow="MANIFEST" title="Sailing" showDrawer={false} />
        <View style={styles.center}><LoadingState label="Loading sailing…" /></View>
      </ScreenContainer>
    );
  }
  if (trips.error) {
    return (
      <ScreenContainer padded={false}>
        <BangkeroScreenHeader eyebrow="MANIFEST" title="Sailing" showDrawer={false} />
        <View style={styles.center}><ErrorState message={trips.error} /></View>
      </ScreenContainer>
    );
  }
  if (!sailing) {
    return (
      <ScreenContainer padded={false}>
        <BangkeroScreenHeader eyebrow="MANIFEST" title="Sailing" showDrawer={false} />
        <View style={styles.center}>
          <EmptyState icon="⛵" title="Sailing not found" message="It may have been removed." />
        </View>
      </ScreenContainer>
    );
  }

  const activeBookings = sailing.bookings.filter((b) => b.status !== 'cancelled');
  const allAboard = sailingAboard(sailing);
  const unpaid = activeBookings.filter((b) => payments[b.bookingId]?.paymentStatus !== 'completed');
  const allPaid = activeBookings.length > 0 && unpaid.length === 0;
  const parcelsHere = parcels.data.filter((p) => bookingIds.includes(p.bookingId));

  return (
    <ScreenContainer padded={false}>
      <BangkeroScreenHeader
        eyebrow="MANIFEST"
        title={`${sailing.from} → ${sailing.to}`}
        showDrawer={false}
      />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        <View style={styles.summary}>
          <Text style={styles.day}>{sailingDayLabel(sailing.day)}</Text>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryText}>
              {activeBookings.length} booking{activeBookings.length === 1 ? '' : 's'} · {sailing.pax} pax
            </Text>
            {sailing.inProgress && (
              <View style={styles.chipLive}>
                <Text style={styles.chipTextLive}>In progress</Text>
              </View>
            )}
          </View>
        </View>

        <Text style={styles.sectionLabel}>PASSENGERS</Text>
        {sailing.bookings.map((b) => {
          const companions = details[b.bookingId] ?? [];
          const payment = payments[b.bookingId];
          return (
            <View key={b.bookingId} style={styles.bookingCard}>
              <View style={styles.bookingTop}>
                <Text style={styles.ref} numberOfLines={1}>{b.ref}</Text>
                <View style={[styles.chip, chipStyle(b.status)]}>
                  <Text style={[styles.chipText, chipTextStyle(b.status)]}>{b.status}</Text>
                </View>
              </View>

              <Text style={styles.passengerName} numberOfLines={1}>
                {b.passengerName ?? 'Unknown passenger'}
                {b.passengerPhone ? ` · ${formatPhone(b.passengerPhone)}` : ''}
              </Text>
              <Text style={styles.bookingMeta} numberOfLines={1}>
                {b.numOfPassenger} pax · ₱{b.totalPrice}
                {b.packageId ? ' · Island hop' : ''}
                {payment ? ` · ${METHOD_LABELS[payment.paymentMethod] ?? payment.paymentMethod}` : ''}
              </Text>

              {companions.length > 0 && (
                <View style={styles.companions}>
                  <Text style={styles.companionsLabel}>COMPANIONS</Text>
                  {companions.map((c) => (
                    <View key={c.passengerId}>
                      <Text style={styles.companion} numberOfLines={1}>
                        {c.firstName} {c.lastName}
                        {c.age != null ? ` · ${c.age}` : ''}
                        {c.sex ? ` · ${c.sex}` : ''}
                      </Text>
                      {!!c.address && (
                        <Text style={styles.companionAddress} numberOfLines={1}>
                          📍 {c.address}
                        </Text>
                      )}
                    </View>
                  ))}
                </View>
              )}
            </View>
          );
        })}

        {parcelsHere.length > 0 && (
          <>
            <Text style={[styles.sectionLabel, styles.mtLg]}>PARCELS</Text>
            {parcelsHere.map((p) => (
              <ParcelRow key={p.parcelId} parcel={p} />
            ))}
          </>
        )}

        <Text style={[styles.sectionLabel, styles.mtLg]}>PAYMENT</Text>
        <View style={styles.payCard}>
          {activeBookings.map((b) => {
            const payment = payments[b.bookingId];
            const down = downs[b.bookingId];
            const paid = payment?.paymentStatus === 'completed';
            const canMark = allAboard && !paid;
            return (
              <View key={b.bookingId} style={styles.payRow}>
                <View style={styles.payBody}>
                  <Text style={styles.payName} numberOfLines={1}>
                    {b.ref} · {b.passengerName ?? 'Passengers'}
                  </Text>
                  {/* The payments row is the ONBOARD remainder for package
                      trips — show exactly what is collectible here. */}
                  <Text style={styles.payMeta} numberOfLines={1}>
                    ₱{payment?.amount ?? b.totalPrice}
                    {payment ? ` · ${METHOD_LABELS[payment.paymentMethod] ?? payment.paymentMethod}` : ''}
                  </Text>
                  {!!down && (
                    <Text style={styles.payDown} numberOfLines={1}>
                      ₱{down.amount} downpayment {down.status === 'approved' ? 'confirmed' : 'pending'} with admin
                    </Text>
                  )}
                </View>
                <Text style={paid ? styles.payDone : styles.payPending}>
                  {paid ? '✓ Paid' : 'Pending'}
                </Text>
                {canMark && (
                  <PrimaryButton
                    label="Mark as paid"
                    onPress={() => void markPaid(b.bookingId)}
                    loading={payingId === b.bookingId}
                    disabled={payingId !== null}
                    style={styles.payBtn}
                  />
                )}
              </View>
            );
          })}

          {allAboard && unpaid.length > 0 && (
            <TextInput
              style={styles.refInput}
              placeholder="GCash / receipt reference (optional)"
              placeholderTextColor={colors.textMuted}
              value={reference}
              onChangeText={setReference}
              autoCapitalize="characters"
            />
          )}

          {!allAboard && unpaid.length > 0 && (
            <Text style={styles.payHint}>
              Payment status becomes actionable once everyone in this sailing is aboard.
            </Text>
          )}
          {allPaid && (
            <Text style={styles.payHintOk}>All payments collected.</Text>
          )}
          {!!payError && (
            <View style={styles.payError}>
              <Text style={styles.payErrorText}>{payError}</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

function ParcelRow({ parcel }: { parcel: ParcelDoc }) {
  return (
    <View style={styles.parcelCard}>
      <View style={styles.parcelBody}>
        <Text style={styles.parcelName} numberOfLines={1}>{parcel.receiverName}</Text>
        <Text style={styles.parcelMeta} numberOfLines={1}>
          ₱{parcel.totalPrice} · {parcel.status.replace('_', ' ')}
        </Text>
      </View>
    </View>
  );
}

function chipStyle(status: string) {
  if (status === 'accepted') return { backgroundColor: colors.primaryTint };
  if (status === 'completed') return { backgroundColor: colors.neutralTint };
  return { backgroundColor: colors.warningTint };
}

function chipTextStyle(status: string) {
  if (status === 'accepted') return { color: colors.primary };
  if (status === 'completed') return { color: colors.textSecondary };
  return { color: colors.warning };
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },

  summary: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  day: { ...typography.label, marginBottom: spacing.xs },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  summaryText: { flexShrink: 1, color: colors.text, fontSize: 14, fontWeight: '600' },

  chip: { paddingHorizontal: spacing.md, paddingVertical: 3, borderRadius: radii.pill },
  chipLive: { backgroundColor: colors.primaryTint, paddingHorizontal: spacing.md, paddingVertical: 3, borderRadius: radii.pill },
  chipText: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
  chipTextLive: { fontSize: 11, fontWeight: '700', color: colors.primary },

  sectionLabel: { ...typography.label, marginBottom: spacing.sm },
  mtLg: { marginTop: spacing.xl },

  bookingCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  bookingTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.xs,
  },
  ref: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '700', letterSpacing: 0.5 },
  passengerName: { flexShrink: 1, color: colors.text, fontSize: 15, fontWeight: '600' },
  bookingMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },

  companions: {
    marginTop: spacing.md,
    backgroundColor: colors.bgElevated,
    borderRadius: radii.sm,
    padding: spacing.md,
  },
  companionsLabel: { ...typography.label, marginBottom: spacing.xs },
  companion: { flexShrink: 1, color: colors.textSecondary, fontSize: 13, lineHeight: 20 },
  companionAddress: { flexShrink: 1, color: colors.textMuted, fontSize: 12, lineHeight: 17 },

  parcelCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  parcelBody: { flex: 1, minWidth: 0 },
  parcelName: { color: colors.text, fontSize: 14, fontWeight: '600' },
  parcelMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },

  payCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.md,
  },
  payRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  payBody: { flex: 1, minWidth: 0 },
  payName: { color: colors.text, fontSize: 14, fontWeight: '600' },
  payMeta: { ...typography.caption, color: colors.textMuted, marginTop: 1 },
  payDown: { ...typography.caption, color: colors.primary, marginTop: 1, fontSize: 11 },
  payDone: { ...typography.label, color: colors.success, letterSpacing: 0 },
  payPending: { ...typography.label, color: colors.warning, letterSpacing: 0 },
  payBtn: { flexBasis: '100%', minHeight: 40 },
  refInput: {
    marginTop: spacing.sm,
    backgroundColor: colors.bgElevated,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    color: colors.text,
    fontSize: 14,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  payHint: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm, lineHeight: 18 },
  payHintOk: { ...typography.caption, color: colors.success, marginTop: spacing.sm, fontWeight: '700' },
  payError: {
    marginTop: spacing.sm,
    backgroundColor: colors.dangerTint,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.danger,
    padding: spacing.sm,
  },
  payErrorText: { flexShrink: 1, color: colors.danger, fontSize: 12, lineHeight: 16 },
});
