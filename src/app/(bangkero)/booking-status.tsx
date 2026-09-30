import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BangkeroScreenHeader } from '@/components/BangkeroScreenHeader';
import { Icon } from '@/components/Icon';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { LoadingState, ErrorState, EmptyState } from '@/components/States';
import { StatusPill } from '@/components/StatusPill';
import { useAuth } from '@/hooks/useAuth';
import { useBangkero, useBooking, usePorts } from '@/hooks/useSupabase';
import {
  acceptBooking, rejectBooking, friendlyError, noShowPassenger, setOnboarded,
} from '@/services/booking.service';
import { getIslandPackage } from '@/services/island-package.service';
import { createNotification, scheduleLocalNotification } from '@/services/notification.service';
import { getPassengerDetailsByBooking } from '@/services/passenger-detail.service';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import type { IslandPackageDoc, PassengerDetailDoc } from '@/types/models';
import { formatPhone } from '@/utils/phone';
import { safeBack } from '@/utils/navigation';

export default function BookingStatus() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const { user } = useAuth();
  const { data: booking, loading, error } = useBooking(bookingId ?? null);
  const bangkero = useBangkero(user?.id ?? null);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const uid = user?.id ?? null;
  const ports = usePorts();

  // Island-hop bookings: show every stop so the crew knows the full run.
  const [pkg, setPkg] = useState<IslandPackageDoc | null>(null);
  useEffect(() => {
    if (!booking?.packageId) return;
    let alive = true;
    getIslandPackage(booking.packageId)
      .then((p) => { if (alive) setPkg(p); })
      .catch(() => {});
    return () => { alive = false; };
  }, [booking?.packageId]);

  // Companions ride under the booker as one boarding group.
  const [companions, setCompanions] = useState<PassengerDetailDoc[]>([]);
  useEffect(() => {
    if (!bookingId) return;
    let alive = true;
    getPassengerDetailsByBooking(bookingId)
      .then((rows) => { if (alive) setCompanions(rows); })
      .catch(() => {
        // the tree still renders the booker without names
      });
    return () => { alive = false; };
  }, [bookingId]);

  // Optimistic boarding state; the server value catches up through realtime.
  const [boardOverride, setBoardOverride] = useState<boolean | null>(null);
  useEffect(() => { setBoardOverride(null); }, [booking?.onboardedAt]);
  const boarded = boardOverride ?? !!booking?.onboardedAt;
  const [boardPending, setBoardPending] = useState(false);
  /**
   * Latched the moment a no-show lands. The row flips to cancelled a beat
   * later through realtime — without this, a second tap re-runs the RPC.
   */
  const [noShowDone, setNoShowDone] = useState(false);

  const isCargo = booking?.serviceType === 'cargo';

  async function handleAccept() {
    if (!uid || !booking) return;
    setPending(true);
    setActionError(null);
    try {
      await acceptBooking(booking.bookingId, {
        uid,
        displayName: bangkero.data?.displayName ?? '',
      });
      if (booking.userId) {
        createNotification(
          booking.userId,
          'Booking Accepted',
          `Your trip ${booking.ref} was accepted.`
        ).catch(() => {});
      }
      // People are standing at the pier — ping the phone even if the app
      // gets backgrounded a second later.
      scheduleLocalNotification(
        'Passengers are waiting',
        `Your passengers are waiting at ${booking.fromPortName}. Stay online to reach them.`
      ).catch(() => {});
    } catch (e) {
      setActionError(friendlyError(e));
    }
    setPending(false);
  }

  async function toggleBoarded(next: boolean) {
    if (!booking) return;
    setBoardPending(true);
    setActionError(null);
    try {
      await setOnboarded(booking.bookingId, next);
      setBoardOverride(next);
      if (next) {
        // Confirmation both ways: if the passenger is actually still on the
        // pier, this is their cue to shout before the boat leaves.
        createNotification(
          booking.userId,
          'You are confirmed on board',
          `The crew confirmed everyone on ${booking.ref} is aboard. If you are NOT on board, open this booking and tap "I'm NOT on board" right away.`
        ).catch(() => {});
        scheduleLocalNotification(
          'Passengers confirmed aboard',
          `Everyone on ${booking.ref} is on board — you're clear to depart.`
        ).catch(() => {});
      }
    } catch (e) {
      setActionError(friendlyError(e));
    }
    setBoardPending(false);
  }

  function confirmNoShow() {
    if (!booking || noShowDone) return;
    Alert.alert(
      'Passenger(s) didn’t board',
      `Mark ${booking.ref} as a no-show? The boat leaves with everyone who boarded, and the no-showed passenger is banned from booking for a while.`,
      [
        { text: 'Go back', style: 'cancel' },
        { text: 'Mark no-show', style: 'destructive', onPress: () => void handleNoShow() },
      ]
    );
  }

  async function handleNoShow() {
    if (!booking || noShowDone) return;
    setBoardPending(true);
    setActionError(null);
    try {
      await noShowPassenger(booking);
      setNoShowDone(true);
    } catch (e) {
      setActionError(friendlyError(e));
    }
    setBoardPending(false);
  }

  async function handleDecline() {
    if (!uid || !booking) return;
    setPending(true);
    setActionError(null);
    try {
      await rejectBooking(booking.bookingId);
      safeBack('/(bangkero)/home');
    } catch (e) {
      setActionError(friendlyError(e));
    }
    setPending(false);
  }

  async function handleStartTrip() {
    router.push('/(bangkero)/departure');
  }

  function handleContactPassenger() {
    if (booking?.passengerPhone) {
      const phone = booking.passengerPhone.replace('+', '');
      router.push(`tel:${phone}`);
    }
  }

  return (
    <ScreenContainer padded={false}>
      <BangkeroScreenHeader title="Booking Status" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

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
                <Text style={styles.refPort} numberOfLines={1}>{booking.fromPortName}</Text>
                <Text style={styles.refArrow}>→</Text>
                <Text style={styles.refPort} numberOfLines={1}>{booking.toPortName}</Text>
              </View>
            </View>

            {!!pkg && pkg.stops.length > 1 && (
              <View style={styles.card}>
                <Text style={styles.cardLabel}>ITINERARY · {pkg.packageName.toUpperCase()}</Text>
                {pkg.stops.map((stopId, i) => (
                  <Text key={`${stopId}-${i}`} style={styles.itineraryStop} numberOfLines={1}>
                    {i + 1}. {ports.data.find((p) => p.portId === stopId)?.portName ?? stopId}
                  </Text>
                ))}
              </View>
            )}

            <View style={styles.card}>
              <Text style={styles.cardLabel}>PASSENGER INFO</Text>
              <Text style={styles.cardValue} numberOfLines={1}>{booking.passengerName ?? 'N/A'}</Text>
              <Text style={styles.cardSub}>
                {booking.passengerPhone ? formatPhone(booking.passengerPhone) : ''}
              </Text>
              <Text style={styles.cardSub} numberOfLines={1}>{booking.numOfPassenger} pax · ₱{booking.totalPrice}</Text>
            </View>

            {!!actionError && (
              <View style={styles.banner}>
                <Text style={styles.bannerText}>{actionError}</Text>
              </View>
            )}

            {booking.status === 'accepted' && (
              <View style={styles.card}>
                <Text style={styles.cardLabel}>{isCargo ? 'CARGO READY' : 'PASSENGERS ON BOARD'}</Text>
                {/* One checkbox for the whole party — the booker speaks for
                    everyone, companions are just names on the same ticket. */}
                <Pressable
                  onPress={() => toggleBoarded(!boarded)}
                  disabled={boardPending}
                  style={({ pressed }) => [styles.boardRow, pressed && styles.boardRowPressed]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: boarded }}
                  accessibilityLabel={isCargo ? 'Cargo loaded' : 'Passengers on board'}
                >
                  <View style={[styles.checkbox, boarded && styles.checkboxOn]}>
                    {boarded && <Icon name="check" size={14} color={colors.primaryText} />}
                  </View>
                  <View style={styles.boardText}>
                    <Text style={styles.boardName} numberOfLines={1}>
                      {booking.passengerName ?? 'Passengers'}
                    </Text>
                    <Text style={styles.boardSub}>
                      {isCargo
                        ? `Cargo trip · ${boarded ? 'loaded' : 'not loaded yet'}`
                        : `${booking.numOfPassenger} pax · ${boarded ? 'confirmed aboard' : 'not confirmed yet'}`}
                    </Text>
                  </View>
                </Pressable>
                {companions.map((c) => (
                  <Text key={c.passengerId} style={styles.companion} numberOfLines={1}>
                    {c.firstName} {c.lastName}
                    {c.passengerType !== 'regular' ? ` (${c.passengerType})` : ''}
                  </Text>
                ))}
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
                    disabled={!boarded}
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

            {booking.status === 'accepted' && !boarded && (
              <>
                <Text style={styles.gateHint}>
                  {isCargo
                    ? 'Confirm the cargo is loaded to start the trip.'
                    : 'Confirm everyone is on board to start the trip.'}
                </Text>
                <PrimaryButton
                  label={noShowDone ? 'No-show marked' : 'Passenger(s) didn’t board'}
                  variant="danger"
                  onPress={confirmNoShow}
                  loading={boardPending}
                  disabled={noShowDone}
                  style={styles.noShowBtn}
                />
              </>
            )}
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },

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
  refText: { flexShrink: 1, color: colors.textMuted, fontSize: 11, letterSpacing: 0.5 },
  refRoute: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  refPort: { flexShrink: 1, color: colors.text, fontSize: 15, fontWeight: '700' },
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
  cardValue: { flexShrink: 1, color: colors.text, fontSize: 15, fontWeight: '700' },
  cardSub: { flexShrink: 1, ...typography.caption, color: colors.textMuted, marginTop: spacing.xs },
  itineraryStop: { flexShrink: 1, color: colors.text, fontSize: 14, fontWeight: '600', lineHeight: 22 },

  banner: {
    backgroundColor: colors.dangerTint,
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  bannerText: { flexShrink: 1, color: colors.danger, fontSize: 13, lineHeight: 18 },

  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
  actionBtn: { flex: 1 },

  // ---------- boarding checkbox ----------
  boardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  boardRowPressed: { opacity: 0.7 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: radii.xs,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  boardText: { flex: 1, minWidth: 0 },
  boardName: { flexShrink: 1, color: colors.text, fontSize: 15, fontWeight: '700' },
  boardSub: { flexShrink: 1, ...typography.caption, color: colors.textMuted, marginTop: 2 },
  companion: {
    ...typography.caption,
    color: colors.textSecondary,
    marginLeft: spacing.xl + 24 + spacing.md,
    marginTop: spacing.xxs,
  },

  gateHint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  noShowBtn: { marginTop: spacing.sm },
});
