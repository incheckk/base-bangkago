import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PassengerScreenHeader } from '@/components/PassengerScreenHeader';
import { PrimaryButton } from '@/components/PrimaryButton';
import { slotLabel, todayIso } from '@/components/SchedulePicker';
import { ScreenContainer } from '@/components/ScreenContainer';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { StatusPill } from '@/components/StatusPill';
import { useRealtimeQuery } from '@/hooks/useRealtimeQuery';
import { useAuth } from '@/hooks/useAuth';
import { useBooking, usePortQueue, usePorts } from '@/hooks/useSupabase';
import { cancelBooking, disputeBoarding, friendlyError } from '@/services/booking.service';
import { getDownpaymentByBooking } from '@/services/downpayment.service';
import { getIslandPackage } from '@/services/island-package.service';
import { createNotification } from '@/services/notification.service';
import { getPaymentByBooking } from '@/services/payment.service';
import { startPortOf } from '@/services/queue.service';
import {
  PENALTY_FALSE_ONBOARD, PENALTY_MISSED_PICKUP, applyRatingPenalty, getRatingsByBooking,
} from '@/services/rating.service';
import { createAlert } from '@/services/safety-alert.service';
import { getLatestPositionForBangkero } from '@/services/tracking.service';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import type { DownpaymentDoc, IslandPackageDoc, PaymentDoc } from '@/types/models';
import { formatPhone } from '@/utils/phone';

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Pay onboard to the bangkero',
  gcash: 'Pay via GCash on board',
};

/** The escape valve opens this long after the bangkero accepts. */
const ESCAPE_WAIT_MS = 10 * 60 * 1000;

export default function BookingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { data: booking, loading, error } = useBooking(id ?? null);

  // While the request is open, how many boats are already queued at the
  // departure port — reassurance that the wait has a real queue behind it.
  const depPortId = booking && booking.status === 'open' ? startPortOf(booking.routeId) : null;
  const waitQueue = usePortQueue(depPortId);

  const [busy, setBusy] = useState(false);
  /**
   * Set once a cancel / escape / dispute lands. `busy` clears when the
   * function returns but the realtime row flip lingers a beat — without
   * this, a second tap re-runs the whole flow and the rating penalty
   * lands twice.
   */
  const [acted, setActed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [payment, setPayment] = useState<PaymentDoc | null>(null);
  const ports = usePorts();

  // GCash escrow row (015) — pending → approved flips live when the
  // admin reviews it in Admin → Downpayments.
  const [downpayment, setDownpayment] = useState<DownpaymentDoc | null>(null);
  const [pkg, setPkg] = useState<IslandPackageDoc | null>(null);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    getDownpaymentByBooking(id)
      .then((dp) => {
        if (alive) setDownpayment(dp);
      })
      .catch(() => {
        // rows without escrow simply show nothing
      });
    return () => {
      alive = false;
    };
  }, [id]);

  useRealtimeQuery(async () => {
    if (!id) return;
    try {
      const dp = await getDownpaymentByBooking(id);
      setDownpayment(dp);
    } catch {
      // keep whatever we have; focus/realtime retries
    }
  }, [{ table: 'downpayments', filter: id ? `booking_id=eq.${id}` : undefined }]);

  // Package bookings render their full itinerary under the route card.
  useEffect(() => {
    if (!booking?.packageId) return;
    let alive = true;
    getIslandPackage(booking.packageId)
      .then((p) => {
        if (alive) setPkg(p);
      })
      .catch(() => {
        // route card alone still shows first → last
      });
    return () => {
      alive = false;
    };
  }, [booking?.packageId]);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    getPaymentByBooking(id)
      .then((p) => {
        if (alive) setPayment(p);
      })
      .catch(() => {
        // the fare row still shows without the method
      });
    return () => {
      alive = false;
    };
  }, [id]);

  // Live Paid/Pending: flips on its own when the bangkero taps
  // "Mark as paid" on the departure screen (payments realtime, 012).
  useRealtimeQuery(async () => {
    if (!id) return;
    try {
      const p = await getPaymentByBooking(id);
      setPayment(p);
    } catch {
      // keep whatever we have; focus/realtime retries
    }
  }, [{ table: 'payments', filter: id ? `booking_id=eq.${id}` : undefined }]);

  const paymentLabel = payment
    ? `${PAYMENT_LABELS[payment.paymentMethod] ?? payment.paymentMethod} · ${
        payment.paymentStatus === 'completed' ? 'Paid' : 'Pending'
      }`
    : '—';

  // Completed trips can be rated once (013 makes a second row impossible).
  const [ratedScore, setRatedScore] = useState<number | null>(null);
  useEffect(() => {
    if (!id || !user?.id || booking?.status !== 'completed') return;
    let alive = true;
    getRatingsByBooking(id)
      .then((rows) => {
        if (!alive) return;
        const mine = rows.find((r) => r.userId === user.id);
        setRatedScore(mine ? mine.score : null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [id, user?.id, booking?.status]);

  async function cancel() {
    if (!id || acted || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await cancelBooking(id, 'Cancelled by the passenger while waiting for a bangkero.');
      setActed(true);
      if (booking?.operatorId) {
        createNotification(
          booking.operatorId,
          'Booking Cancelled',
          `Trip ${booking.ref} was cancelled by the passenger.`
        ).catch(() => {});
      }
      // No refund step — the fare is collected on board, so a cancelled
      // trip simply means nothing was ever charged.
    } catch (e) {
      setActionError(friendlyError(e));
    }
    setBusy(false);
  }

  /**
   * Cancel first — every penalty, notification and alert below is
   * individually caught, so an RLS denial or a lost race only costs that
   * one side effect. The trip itself is already over.
   */
  async function finishCancelled(reason: string) {
    if (!booking) return false as const;
    try {
      await cancelBooking(booking.bookingId, reason);
    } catch (e) {
      setActionError(friendlyError(e));
      return false as const;
    }
    setActed(true);
    if (booking.operatorId) {
      createNotification(
        booking.operatorId,
        'Passenger did not board',
        `Passenger could not reach the boat for ${booking.ref} at ${booking.fromPortName}. The trip was cancelled — nothing was charged, the fare is collected on board.`
      ).catch(() => {});
    }
    return true as const;
  }

  async function escape() {
    if (!booking || acted || busy) return;
    setBusy(true);
    setActionError(null);
    const done = await finishCancelled(
      'Passenger used the 10-minute escape — could not reach the boat.'
    );
    if (done) {
      if (booking.operatorId) {
        // Missed pickup: the boat did not wait for a confirmed passenger.
        applyRatingPenalty(booking.operatorId, PENALTY_MISSED_PICKUP).catch(() => {});
        // Boat's last known position, so whoever investigates has a starting point.
        getLatestPositionForBangkero(booking.operatorId)
          .then((found) => createAlert({
            message:
              `Passenger escape: trip ${booking.ref} cancelled — passenger could not reach ${booking.operatorBoatName ?? 'the boat'} at ${booking.fromPortName}. ` +
              (found
                ? `Boat last seen at ${found.position.latitude.toFixed(5)}, ${found.position.longitude.toFixed(5)} at ${new Date(found.position.recordedAt).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}.`
                : 'No GPS fix on record.'),
            severity: 'high',
            bangkaId: found?.bangkaId,
          }))
          .catch(() => {});
      } else {
        createAlert({
          message: `Passenger escape: trip ${booking.ref} cancelled — passenger could not reach ${booking.fromPortName}.`,
          severity: 'high',
        }).catch(() => {});
      }
    }
    setBusy(false);
  }

  async function dispute() {
    if (!booking || acted || busy) return;
    setBusy(true);
    setActionError(null);
    // Solo — nobody else is aboard, so cancel exactly as before. Group —
    // mark ONLY this passenger absent (022): the rest of the party sails.
    const isGroup = booking.numOfPassenger > 1;
    let done: boolean;
    if (isGroup) {
      try {
        await disputeBoarding(booking.bookingId);
        done = true;
      } catch (e) {
        setActionError(friendlyError(e));
        done = false;
      }
    } else {
      done = await finishCancelled(
        'Passenger disputes being aboard — reports the boat departed without them.'
      );
    }
    if (done) {
      if (booking.operatorId) {
        // False-onboard: a harsher deduction — this one is an accusation.
        applyRatingPenalty(booking.operatorId, PENALTY_FALSE_ONBOARD).catch(() => {});
        createNotification(
          booking.operatorId,
          'Passenger disputes departure',
          isGroup
            ? `A passenger reports they were NOT on board for ${booking.ref}. They are marked not aboard — the rest of the booking continues and the trip will complete normally.`
            : `A passenger reports they were NOT on board for ${booking.ref}. The trip was cancelled and your rating has been penalised.`
        ).catch(() => {});
        // Boat's last known position, so whoever investigates has a starting point.
        getLatestPositionForBangkero(booking.operatorId)
          .then((found) => createAlert({
            message:
              `Passenger disputes departure for ${booking.ref} (${booking.fromPortName} → ${booking.toPortName}). ` +
              (isGroup ? 'Booking continues — passenger marked not aboard. ' : 'Trip cancelled. ') +
              (found
                ? `Boat last seen at ${found.position.latitude.toFixed(5)}, ${found.position.longitude.toFixed(5)} at ${new Date(found.position.recordedAt).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}.`
                : 'No GPS fix on record.'),
            severity: 'critical',
            bangkaId: found?.bangkaId,
          }))
          .catch(() => {});
      }
    }
    setBusy(false);
  }

  function confirmEscape() {
    Alert.alert(
      "I can't reach my boat",
      'Your trip will be cancelled. You were not charged — the fare is collected on board. Your bangkero is told you did not board, and you can book again right away.',
      [
        { text: 'Keep booking', style: 'cancel' },
        { text: 'Cancel my trip', style: 'destructive', onPress: () => void escape() },
      ]
    );
  }

  function confirmDispute() {
    Alert.alert(
      "I'm NOT on board",
      booking && booking.numOfPassenger > 1
        ? 'Use this only if the boat has already left without you. You are marked as not aboard — the rest of your group\u2019s trip continues and the boat crew is investigated.'
        : 'Use this only if the boat has already left without you. Your trip is cancelled and the boat crew is investigated.',
      [
        { text: 'Go back', style: 'cancel' },
        { text: 'Report it', style: 'destructive', onPress: () => void dispute() },
      ]
    );
  }

  // ---------- live countdown to the escape valve ----------
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (booking?.status !== 'accepted' || booking.onboardedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [booking?.status, booking?.onboardedAt]);

  const escapeAt = booking?.acceptedAt
    ? new Date(booking.acceptedAt).getTime() + ESCAPE_WAIT_MS
    : null;
  // No accepted_at (defensive) means eligible immediately — a null stamp
  // must never park the passenger on an "opens in 0:00" screen forever.
  const escapeReady =
    !booking?.onboardedAt && (escapeAt === null || now >= escapeAt);
  const escapeIn = escapeAt !== null ? Math.max(0, escapeAt - now) : 0;
  const escapeClock = `${Math.floor(escapeIn / 60000)}:${String(
    Math.floor((escapeIn % 60000) / 1000)
  ).padStart(2, '0')}`;

  // 3a reminder — the sail slot is impossible to miss on the eve and the
  // morning of sailing (far-off dates are already covered by the schedule
  // row). Reuses the escape ticker above, so the countdown stays live.
  const sailReminder = (() => {
    if (booking?.status !== 'accepted' || booking.onboardedAt || !booking.scheduledDate) return null;
    const dayDiff = Math.round(
      (new Date(`${booking.scheduledDate}T00:00:00`).getTime() -
        new Date(`${todayIso()}T00:00:00`).getTime()) / 86400000
    );
    const when = booking.scheduledTime ? ` · ${slotLabel(booking.scheduledTime)}` : '';
    if (dayDiff === 1) return `Sails tomorrow${when}`;
    if (dayDiff !== 0 || !booking.scheduledTime) {
      return dayDiff === 0 ? 'Sails today' : null;
    }
    const ms = new Date(`${booking.scheduledDate}T${booking.scheduledTime}:00`).getTime() - now;
    if (ms <= 0) return `Sailing today${when} — due now`;
    const h = Math.floor(ms / 3_600_000);
    const m = Math.round((ms % 3_600_000) / 60_000);
    const left = h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ''}` : `${m}m`;
    return `Sails today${when} — in ~${left}`;
  })();

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
      <PassengerScreenHeader title="Booking Details" showDrawer={false} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          {/* The ref is the bangkero-facing code — it stays under wraps
              until the admin clears the escrow (020). */}
          <Text style={styles.ref}>
            {booking.status === 'pending' ? 'Advance booking' : booking.ref}
          </Text>
          <StatusPill status={booking.status} />
        </View>

        {booking.status === 'pending' && (
          <View style={styles.pendingBanner}>
            <Text style={styles.pendingText}>
              Awaiting admin confirmation of your GCash downpayment. Bangkeros cannot see
              this booking yet — you&apos;ll get a notification the moment it&apos;s confirmed.
            </Text>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.route} numberOfLines={1}>{booking.fromPortName}</Text>
          <Text style={styles.arrow}>↓</Text>
          <Text style={styles.route} numberOfLines={1}>{booking.toPortName}</Text>
        </View>

        {!!pkg && pkg.stops.length > 1 && (
          <View style={styles.itinerary}>
            <Text style={styles.itineraryLabel}>ITINERARY</Text>
            {pkg.stops.map((stopId, i) => (
              <Text key={`${stopId}-${i}`} style={styles.itineraryStop} numberOfLines={1}>
                {i + 1}. {ports.data.find((p) => p.portId === stopId)?.portName ?? stopId}
                {i < pkg.stops.length - 1 ? '  ↓' : ''}
              </Text>
            ))}
          </View>
        )}

        {booking.status === 'accepted' && (
          <View style={styles.operator}>
            <Text style={styles.operatorLabel}>YOUR BANGKERO</Text>
            <Text style={styles.operatorName} numberOfLines={1}>{booking.operatorName}</Text>
            {!!booking.operatorBoatName && (
              <Text style={styles.operatorBoat}>{booking.operatorBoatName}</Text>
            )}
          </View>
        )}

        {!!sailReminder && (
          <View style={styles.reminder}>
            <Text style={styles.reminderText}>{sailReminder}</Text>
          </View>
        )}

        <View style={styles.details}>
          {booking.scheduledDate && (
            <Row
              label="Sailing schedule"
              value={`${new Date(`${booking.scheduledDate}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}${
                booking.scheduledTime ? ` · ${slotLabel(booking.scheduledTime)}` : ''
              }`}
              strong
            />
          )}
          <Row label="Passengers" value={String(booking.numOfPassenger)} />
          <Row label="Fare" value={`₱${booking.totalPrice}`} strong />
          <Row label="Payment" value={paymentLabel} />
          {downpayment ? (
            <Row
              label="Downpayment (50%)"
              value={`₱${downpayment.amount} · ${
                downpayment.status === 'approved'
                  ? 'confirmed by admin'
                  : downpayment.status === 'refunded'
                    ? 'refunded'
                    : 'awaiting admin confirmation'
              }`}
            />
          ) : (
            (booking.packageId || booking.scheduledDate) && (
              <Row
                label="Downpayment (50%)"
                value="Not recorded — keep your GCash reference and contact support."
              />
            )
          )}
          {!!pkg && <Row label="Package" value={pkg.packageName} />}
          <Row label="Booked by" value={booking.passengerName ?? ''} />
          <Row label="Contact" value={booking.passengerPhone ? formatPhone(booking.passengerPhone) : ''} />
        </View>

        {!!actionError && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>{actionError}</Text>
          </View>
        )}

        <View style={styles.actions}>
          {booking.status === 'pending' && (
            <>
              <Text style={styles.waiting}>
                Waiting for the admin to confirm your downpayment. This updates on its own.
              </Text>
              <PrimaryButton
                label="Cancel booking"
                variant="danger"
                onPress={cancel}
                loading={busy}
                disabled={acted}
              />
            </>
          )}

          {booking.status === 'open' && (
            <>
              <Text style={styles.waiting}>
                {waitQueue.data.length > 0
                  ? `Waiting for a bangkero — ${waitQueue.data.length} boat${waitQueue.data.length === 1 ? '' : 's'} waiting at ${booking.fromPortName}. This updates on its own.`
                  : 'Waiting for a bangkero to accept. This updates on its own.'}
              </Text>
              <PrimaryButton label="Cancel booking" variant="danger" onPress={cancel} loading={busy} disabled={acted} />
            </>
          )}

          {booking.status === 'accepted' && (
            <>
              <Text style={styles.waiting}>
                {booking.disputedAt
                  ? 'You reported that you were NOT on board. The trip continues for the rest of your group — the bangkero and Coastguard have been notified.'
                  : booking.onboardedAt
                    ? 'You are confirmed on board. Safe travels!'
                    : `Your bangkero is on the way. Meet them at ${booking.fromPortName}.`}
              </Text>
              <PrimaryButton
                label="View trip details"
                onPress={() => router.push(`/(passenger)/trip/${id}`)}
              />

              {/* One QR per rider — the bangkero scans them at boarding. */}
              <PrimaryButton
                label="Show boarding QR codes"
                variant="secondary"
                onPress={() =>
                  router.push({
                    pathname: '/(passenger)/boarding-pass',
                    params: { bookingId: booking.bookingId },
                  })
                }
                style={styles.secondaryAction}
              />

              {/* Live progress + SOS/contact — the en-route view. */}
              <PrimaryButton
                label="Track live trip"
                variant="secondary"
                onPress={() => router.push('/(passenger)/trip-en-route')}
                style={styles.secondaryAction}
              />

              {/* Escape valve: opens 10 minutes after accept, closes for good
                  the moment the bangkero confirms everyone is aboard — or the
                  passenger files the not-aboard dispute (the boat has left). */}
              {!booking.onboardedAt && !booking.disputedAt &&
                (escapeReady ? (
                  <PrimaryButton
                    label="I can't reach my boat"
                    variant="danger"
                    onPress={confirmEscape}
                    loading={busy}
                    disabled={acted}
                    style={styles.secondaryAction}
                  />
                ) : (
                  <Text style={styles.escapeWait}>
                    Can&apos;t reach the boat? Escape hatch opens in {escapeClock}
                  </Text>
                ))}

              {/* Once aboard, the only complaint left is "you left without me". */}
              {booking.onboardedAt && (
                <PrimaryButton
                  label="I'm NOT on board"
                  variant="danger"
                  onPress={confirmDispute}
                  loading={busy}
                  disabled={acted}
                  style={styles.secondaryAction}
                />
              )}
            </>
          )}

          {booking.status === 'completed' && (
            ratedScore !== null ? (
              <Text style={styles.waiting}>
                You rated this trip {ratedScore}★ — thanks for helping other passengers.
              </Text>
            ) : (
              <PrimaryButton
                label="Rate this trip"
                variant="secondary"
                onPress={() =>
                  router.push({
                    pathname: '/(passenger)/rate-trip',
                    params: {
                      bookingId: booking.bookingId,
                      bangkeroName: booking.operatorName ?? '',
                      boatName: booking.operatorBoatName ?? '',
                    },
                  })
                }
                style={{ marginTop: spacing.md }}
              />
            )
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
  ref: { flexShrink: 1, ...typography.h2, letterSpacing: 1 },

  pendingBanner: {
    backgroundColor: colors.warningTint,
    borderColor: colors.warning,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  pendingText: { color: colors.text, fontSize: 13, lineHeight: 19 },

  reminder: {
    backgroundColor: colors.primaryTint,
    borderColor: colors.primary,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  reminderText: { color: colors.primary, fontSize: 14, fontWeight: '700' },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.xl,
    alignItems: 'center',
  },
  route: { flexShrink: 1, color: colors.text, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  arrow: { color: colors.primary, fontSize: 18, marginVertical: spacing.sm },

  itinerary: {
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
  },
  itineraryLabel: { ...typography.label, marginBottom: spacing.sm },
  itineraryStop: { ...typography.caption, color: colors.text, fontWeight: '600', lineHeight: 20 },

  operator: {
    marginTop: spacing.lg,
    backgroundColor: colors.primaryTint,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.primary,
    padding: spacing.lg,
  },
  operatorLabel: { ...typography.label, color: colors.primary, marginBottom: spacing.sm },
  operatorName: { flexShrink: 1, color: colors.text, fontSize: 16, fontWeight: '700' },
  operatorBoat: { flexShrink: 1, ...typography.caption, marginTop: 2 },

  details: {
    marginTop: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm, gap: spacing.md },
  rowLabel: { flexShrink: 1, ...typography.caption },
  rowValue: { color: colors.text, fontSize: 13, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  rowValueStrong: { color: colors.primary, fontSize: 15, fontWeight: '700' },

  banner: {
    marginTop: spacing.lg,
    backgroundColor: colors.dangerTint,
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  bannerText: { flexShrink: 1, color: colors.danger, fontSize: 13, lineHeight: 18 },

  actions: { marginTop: spacing.xl },
  waiting: { ...typography.caption, textAlign: 'center', marginBottom: spacing.lg, lineHeight: 18 },
  secondaryAction: { marginTop: spacing.md },
  escapeWait: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
    lineHeight: 18,
  },
});
