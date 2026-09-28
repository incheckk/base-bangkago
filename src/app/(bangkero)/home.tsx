import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { BangkeroScreenHeader } from '@/components/BangkeroScreenHeader';
import { DemandBadge } from '@/components/DemandBadge';
import { EarningsCard } from '@/components/EarningsCard';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { Icon } from '@/components/Icon';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { StatusPill } from '@/components/StatusPill';
import { useAuth } from '@/hooks/useAuth';
import { useRefetchOnFocus } from '@/hooks/useRealtimeQuery';
import {
  useAcceptedBookings, useBangkero, useMyPortQueue, useMyTrips, useOpenRequests, usePorts,
} from '@/hooks/useSupabase';
import {
  acceptBooking, completeBooking, friendlyError, rejectBooking, setAvailability,
} from '@/services/booking.service';
import { createNotification, scheduleLocalNotification } from '@/services/notification.service';
import {
  DWELL_MS, endPortOf, formatDistance, getMyBangkaCapacity, getMyLastFix, haversineM, startPortOf,
} from '@/services/queue.service';
import { MIN_ACCEPT_RATING, getEffectiveRating } from '@/services/rating.service';
import { colors, elevation, radii, spacing, touchTarget, typography } from '@/theme/tokens';
import type { BookingDoc } from '@/types/models';
import { formatPhone } from '@/utils/phone';

/** 45000 → "0:45" — the hold and dwell countdowns. */
const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export default function BangkeroHome() {
  const { user, profile } = useAuth();
  const uid = user?.id ?? null;

  const bangkero = useBangkero(uid);
  const requests = useOpenRequests(uid);
  const trips = useMyTrips(uid);
  // The working set (accepted only, no 10-row cap) drives active trips and
  // the offline gate; `trips` stays for earnings history.
  const accepted = useAcceptedBookings(uid);

  const [pending, setPending] = useState<string | null>(null);
  /**
   * Bookings already acted on in this session. Realtime removes the row a
   * moment after the write lands, and in that gap `pending` has already been
   * cleared — leaving Accept / Decline / Mark completed live on a booking that
   * is no longer actionable. This keeps them disabled until the row leaves.
   */
  const [acted, setActed] = useState<Set<string>>(new Set());
  const markActed = (id: string) => setActed((prev) => new Set(prev).add(id));
  const [actionError, setActionError] = useState<string | null>(null);

  /**
   * Availability flips locally the instant the switch moves; the server value
   * catches up through realtime. The override is dropped as soon as the two
   * agree (or the write fails, which reverts the switch immediately).
   */
  const [availOverride, setAvailOverride] = useState<boolean | null>(null);
  const serverAvailable = bangkero.data?.isAvailable ?? false;
  const available = availOverride ?? serverAvailable;

  useEffect(() => {
    if (availOverride !== null && availOverride === serverAvailable) setAvailOverride(null);
  }, [availOverride, serverAvailable]);

  const activeTrips = accepted.data;
  const hasActiveTrip = activeTrips.length > 0;

  // Port-queue presence + the clocks the chips tick against. `now`
  // advances every second; the boat's own fix is re-read every 15s so
  // the distance badge tracks the boat as it moves.
  const ports = usePorts();
  const myQueue = useMyPortQueue(uid);
  const [now, setNow] = useState(() => Date.now());
  const [myFix, setMyFix] = useState<{ latitude: number; longitude: number } | null>(null);
  const lastFixFetchRef = useRef(0);
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
      if (uid && Date.now() - lastFixFetchRef.current > 15_000) {
        lastFixFetchRef.current = Date.now();
        getMyLastFix(uid)
          .then((f) => setMyFix(f ? { latitude: f.latitude, longitude: f.longitude } : null))
          .catch(() => {});
      }
    }, 1000);
    return () => clearInterval(id);
  }, [uid]);

  // Client-side fit-check chip: this boat's capacity vs. everything
  // already accepted (mirrors fits_booking in 008).
  const [myCapacity, setMyCapacity] = useState<number | null>(null);
  useEffect(() => {
    if (!uid) return;
    getMyBangkaCapacity(uid).then(setMyCapacity).catch(() => {});
  }, [uid]);
  const acceptedLoad = activeTrips.reduce((sum, t) => sum + t.numOfPassenger, 0);
  // Destinations of trips already accepted — the route lock (008).
  const activeDests = [...new Set(activeTrips.map((t) => endPortOf(t.routeId)))];

  // Effective rating = passenger average minus penalties; the accept gate in
  // acceptBooking enforces the same floor server-side. Re-read on focus so a
  // fresh penalty never lingers on screen after navigating back.
  const [effectiveRating, setEffectiveRating] = useState<number | null>(null);
  const loadRating = useCallback(() => {
    if (!uid) return;
    getEffectiveRating(uid)
      .then(setEffectiveRating)
      .catch(() => {});
  }, [uid]);
  useEffect(() => { loadRating(); }, [loadRating]);
  useRefetchOnFocus(loadRating);
  const ratingBlocked =
    effectiveRating !== null && effectiveRating <= MIN_ACCEPT_RATING;

  /**
   * One request card's dispatch state — a client mirror of the gates
   * accept_booking_hold enforces (008). The server is authoritative;
   * this only decides what the chip says and whether Accept is armed.
   */
  function chipFor(b: BookingDoc): {
    text: string; tone: 'live' | 'wait' | 'block'; canAccept: boolean; distance: string | null;
  } {
    const depPort = startPortOf(b.routeId);
    const destPort = endPortOf(b.routeId);
    const dep = ports.data.find((p) => p.portId === depPort);
    const distance =
      myFix && dep?.latitude != null && dep.longitude != null
        ? formatDistance(haversineM(myFix.latitude, myFix.longitude, dep.latitude, dep.longitude))
        : null;

    // Route lock: one destination at a time (and a mixed legacy set
    // locks the boat out entirely until those trips clear).
    if (activeDests.length > 1 || (activeDests.length === 1 && activeDests[0] !== destPort)) {
      return {
        text: 'Locked to your current destination — finish those trips first',
        tone: 'block', canAccept: false, distance,
      };
    }

    const entry = myQueue.data.entry;
    if (entry?.portId !== depPort) {
      return {
        text: `Not queued at ${b.fromPortName ?? 'this port'}`,
        tone: 'block', canAccept: false, distance,
      };
    }
    const dwellLeft = DWELL_MS - (now - new Date(entry.enteredAt).getTime());
    if (dwellLeft > 0) {
      return { text: `Entering queue… ${clock(dwellLeft)}`, tone: 'wait', canAccept: false, distance };
    }
    if (!available) {
      return { text: 'Offline — turn on to accept', tone: 'block', canAccept: false, distance };
    }
    if (
      b.serviceType !== 'rental' &&
      myCapacity !== null &&
      b.numOfPassenger + acceptedLoad > myCapacity
    ) {
      return {
        text: `Boat full — ${acceptedLoad + b.numOfPassenger}/${myCapacity} pax`,
        tone: 'block', canAccept: false, distance,
      };
    }

    const holdLeft = b.holdExpiresAt ? new Date(b.holdExpiresAt).getTime() - now : null;
    if (b.heldBy === uid) {
      if (holdLeft !== null && holdLeft > 0) {
        return { text: `Offered to you · ${clock(holdLeft)} left`, tone: 'live', canAccept: true, distance };
      }
      return { text: 'Offer expired — waiting for the next boat', tone: 'wait', canAccept: false, distance };
    }
    if (b.heldBy) {
      return { text: 'Offered to another boat', tone: 'wait', canAccept: false, distance };
    }
    return { text: 'Waiting for your offer…', tone: 'wait', canAccept: true, distance };
  }

  /** The queue line under the availability switch. */
  const qEntry = myQueue.data.entry;
  const qPortName = qEntry
    ? ports.data.find((p) => p.portId === qEntry.portId)?.portName ?? 'the port'
    : null;
  const queueLabel = !qEntry
    ? 'Not in any port queue — park inside a port perimeter to line up for requests.'
    : (() => {
        const dwellLeft = DWELL_MS - (now - new Date(qEntry.enteredAt).getTime());
        const rank = myQueue.data.rank ? `#${myQueue.data.rank}` : '';
        if (dwellLeft > 0) return `${rank} at ${qPortName} — joining the list in ${clock(dwellLeft)}`;
        return `${rank} of ${myQueue.data.total} at ${qPortName}${available ? '' : ' · listed but offline'}`;
      })();

  async function toggle(next: boolean) {
    if (!uid) return;
    // Blocked while a trip is accepted — the server-side guard repeats this.
    if (!next && hasActiveTrip) {
      setActionError('You have an active trip. You cannot go offline until it completes.');
      return;
    }
    setActionError(null);
    setAvailOverride(next);
    try {
      await setAvailability(uid, next);
    } catch (e) {
      setAvailOverride(null);
      setActionError(friendlyError(e));
    }
  }

  async function accept(b: BookingDoc) {
    if (!uid || !bangkero.data) return;
    setPending(b.bookingId);
    setActionError(null);
    try {
      await acceptBooking(b.bookingId, {
        uid,
        displayName: bangkero.data.displayName,
      });
      // Accepted work requires the operator reachable — force online in the
      // same flow so a stale switch can never leave passengers hanging.
      if (!available) await setAvailability(uid, true).catch(() => {});
      markActed(b.bookingId);
      // The phone may be face-down in a pocket — a local ping is the fastest
      // way to say "people are standing at the pier right now".
      scheduleLocalNotification(
        'Passengers are waiting',
        `Your passengers are waiting at ${b.fromPortName}. Stay online to reach them.`
      ).catch(() => {});
      createNotification(
        b.userId,
        'Booking Accepted',
        `Your trip ${b.ref} (${b.fromPortName} → ${b.toPortName}) was accepted by ${bangkero.data.displayName}.`
      ).catch(() => {});
      router.push({
        pathname: '/(bangkero)/booking-status',
        params: { bookingId: b.bookingId },
      });
    } catch (e) {
      setActionError(
        friendlyError(e) === 'You do not have permission to do that.'
          ? 'Another bangkero already took that trip.'
          : friendlyError(e)
      );
    }
    setPending(null);
  }

  async function decline(b: BookingDoc) {
    setPending(b.bookingId);
    setActionError(null);
    try {
      // One RPC: append me + hand the offer to the next boat in line.
      await rejectBooking(b.bookingId);
      markActed(b.bookingId);
    } catch (e) {
      setActionError(friendlyError(e));
    }
    setPending(null);
  }

  async function complete(b: BookingDoc) {
    setPending(b.bookingId);
    setActionError(null);
    try {
      await completeBooking(b.bookingId);
      markActed(b.bookingId);
      createNotification(
        b.userId,
        'Trip Completed',
        `Your trip ${b.ref} has been completed. Safe travels!`
      ).catch(() => {});
    } catch (e) {
      setActionError(friendlyError(e));
    }
    setPending(null);
  }

  // Earnings count only trips that actually completed, bucketed by when
  // they completed — TODAY and THIS WEEK are real windows, not a guess.
  const completedTrips = trips.data.filter((t) => t.status === 'completed' && t.completedAt);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const weekAgoMs = Date.now() - 7 * 86400000;
  const todayEarnings = completedTrips
    .filter((t) => new Date(t.completedAt as string).getTime() >= todayStart.getTime())
    .reduce((sum, t) => sum + t.totalPrice, 0);
  const weekEarnings = completedTrips
    .filter((t) => new Date(t.completedAt as string).getTime() >= weekAgoMs)
    .reduce((sum, t) => sum + t.totalPrice, 0);

  return (
    <ScreenContainer padded={false}>
      <BangkeroScreenHeader
        eyebrow="BANGKERO"
        title={profile ? `Kumusta, ${profile.firstName}` : 'Kumusta'}
        showBack={false}
        right={
          <Pressable
            onPress={() => router.replace('/(bangkero)/profile')}
            accessibilityRole="button"
            accessibilityLabel="Profile"
            style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
          >
            <Icon name="profile" size={20} color={colors.text} />
          </Pressable>
        }
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Availability is the control the whole screen depends on, so it reads
            as the primary object and changes colour with its state — you can
            tell across a room whether this operator is receiving work. */}
        <View style={[styles.statusCard, available && styles.statusCardOn]}>
          <View style={styles.statusTop}>
            <View style={[styles.statusDot, available ? styles.statusDotOn : styles.statusDotOff]} />
            <Text style={[styles.statusWord, available && styles.statusWordOn]}>
              {available ? 'ONLINE' : 'OFFLINE'}
            </Text>
            <View style={styles.statusSpacer} />
            <Switch
              value={available}
              onValueChange={toggle}
              disabled={bangkero.loading || !bangkero.data || hasActiveTrip}
              trackColor={{ false: colors.border, true: colors.primaryDark }}
              thumbColor={available ? colors.primary : colors.textMuted}
            />
          </View>

          <Text style={styles.statusHint}>
            {hasActiveTrip
              ? 'You have an active trip — stay online until it is completed.'
              : available
                ? 'You are receiving booking requests.'
                : 'Turn on to start receiving booking requests.'}
          </Text>

          {/* FCFS place in line (008) — the whole dispatch model in one row. */}
          <View style={styles.queueWrap}>
            <Text style={[styles.queueText, qEntry && styles.queueTextOn]} numberOfLines={2}>
              {myQueue.loading ? 'Checking the port queue…' : queueLabel}
            </Text>
            {!myFix && !myQueue.loading && (
              <Text style={styles.queueGps}>
                No GPS fix yet — keep location on so your boat can join a port queue.
              </Text>
            )}
          </View>

          <View style={styles.boatRow}>
            <Icon name="boat" size={18} color={colors.textSecondary} />
            <Text style={styles.boatName} numberOfLines={1}>
              {bangkero.data?.displayName ?? 'No boat name set'}
            </Text>
            {bangkero.data?.verificationStat === 'verified' ? (
              <View style={styles.verifiedPill}>
                <Icon name="check" size={12} color={colors.success} />
                <Text style={styles.verifiedText}>Verified</Text>
              </View>
            ) : (
              <View style={styles.pendingPill}>
                <Text style={styles.pendingText}>Pending</Text>
              </View>
            )}
          </View>
        </View>

        {!!actionError && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>{actionError}</Text>
          </View>
        )}

        {ratingBlocked && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>
              Your rating is {effectiveRating?.toFixed(1)}★ — 3.0 or below. You cannot
              accept new bookings until passengers rate your trips back up.
            </Text>
          </View>
        )}

        <Text style={styles.sectionLabel}>AI DEMAND TODAY</Text>
        <View style={styles.demandRow}>
          <DemandBadge level="high" predictedPassengers={32} />
          <DemandBadge level="medium" predictedPassengers={18} />
          <DemandBadge level="low" predictedPassengers={8} />
        </View>

        <Text style={styles.sectionLabel}>EARNINGS</Text>
        <View style={styles.earningsRow}>
          <View style={styles.earningsItem}>
            <Icon name="cash" size={16} color={colors.primary} />
            <Text style={styles.earningsValue}>₱{todayEarnings}</Text>
            <Text style={styles.earningsLabel}>TODAY</Text>
          </View>
          <View style={styles.earningsItem}>
            <Icon name="receipt" size={16} color={colors.textSecondary} />
            <Text style={[styles.earningsValue, styles.earningsValueMuted]}>
              ₱{weekEarnings}
            </Text>
            <Text style={styles.earningsLabel}>THIS WEEK</Text>
          </View>
        </View>

        {activeTrips.length > 0 && (
          <>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionLabelInline}>ACTIVE TRIPS</Text>
              <View style={styles.countPill}>
                <Text style={styles.countPillText}>{activeTrips.length}</Text>
              </View>
            </View>
            {activeTrips.map((b) => (
              <Pressable
                key={b.bookingId}
                onPress={() => router.push({
                  pathname: '/(bangkero)/booking-status',
                  params: { bookingId: b.bookingId },
                })}
                style={({ pressed }) => [styles.request, styles.activeTrip, pressed && styles.requestPressed]}
              >
                <RequestBody booking={b} />
                {/* Completing requires everyone aboard (complete_trip raises
                    otherwise) — until then the button routes to the boarding
                    card instead of pretending the trip can close. */}
                <PrimaryButton
                  label={
                    acted.has(b.bookingId)
                      ? 'Completed'
                      : b.onboardedAt
                        ? 'Mark completed'
                        : 'Open trip to confirm boarding'
                  }
                  onPress={() => {
                    if (acted.has(b.bookingId)) return;
                    if (b.onboardedAt) {
                      void complete(b);
                    } else {
                      router.push({
                        pathname: '/(bangkero)/booking-status',
                        params: { bookingId: b.bookingId },
                      });
                    }
                  }}
                  loading={pending === b.bookingId}
                  disabled={acted.has(b.bookingId)}
                  style={{ marginTop: spacing.md }}
                />
              </Pressable>
            ))}
          </>
        )}

        <View style={styles.sectionHead}>
          <Text style={styles.sectionLabelInline}>INCOMING REQUESTS</Text>
          {available && requests.data.length > 0 && (
            <View style={[styles.countPill, styles.countPillLive]}>
              <Text style={styles.countPillTextLive}>{requests.data.length}</Text>
            </View>
          )}
        </View>

        {!available ? (
          <View style={styles.offlineBox}>
            <View style={styles.offlineIconRing}>
              <Icon name="boat" size={24} color={colors.textMuted} />
            </View>
            <Text style={styles.offlineTitle}>You are offline</Text>
            <Text style={styles.offlineText}>
              Turn on availability above to start receiving booking requests.
            </Text>
          </View>
        ) : requests.loading ? (
          <View style={styles.stateBox}><LoadingState label="Listening for requests…" /></View>
        ) : requests.error ? (
          <View style={styles.stateBox}><ErrorState message={requests.error} /></View>
        ) : requests.data.length === 0 ? (
          <View style={styles.stateBox}>
            <EmptyState
              icon="bell"
              title="No requests right now"
              message="New bookings appear here the moment a passenger sends one."
            />
          </View>
        ) : (
          requests.data.map((b) => {
            const chip = chipFor(b);
            return (
              <View key={b.bookingId} style={styles.request}>
                <RequestBody booking={b} />
                {/* Dispatch state (008): whose offer it is, why Accept
                    may be locked, and how far the boat still is. */}
                <View style={styles.chipRow}>
                  <View
                    style={[
                      styles.holdChip,
                      chip.tone === 'live' && styles.holdChipLive,
                      chip.tone === 'block' && styles.holdChipBlock,
                    ]}
                  >
                    <Text
                      style={[
                        styles.holdChipText,
                        chip.tone === 'live' && styles.holdChipTextLive,
                        chip.tone === 'block' && styles.holdChipTextBlock,
                      ]}
                      numberOfLines={2}
                    >
                      {chip.text}
                    </Text>
                  </View>
                  {chip.distance && <Text style={styles.chipDistance}>{chip.distance}</Text>}
                </View>
                {/* Accept is the intended action and carries twice the width;
                    giving a decline equal weight makes operators hesitate. */}
                <View style={styles.actions}>
                  <PrimaryButton
                    label="Decline"
                    variant="secondary"
                    onPress={() => decline(b)}
                    disabled={pending === b.bookingId || acted.has(b.bookingId)}
                    style={styles.declineBtn}
                  />
                  <PrimaryButton
                    label="Accept"
                    onPress={() => accept(b)}
                    loading={pending === b.bookingId}
                    disabled={acted.has(b.bookingId) || ratingBlocked || !chip.canAccept}
                    style={styles.acceptBtn}
                  />
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

function RequestBody({ booking }: { booking: BookingDoc }) {
  return (
    <>
      <View style={styles.requestTop}>
        <Text style={styles.requestRef}>{booking.ref}</Text>
        <StatusPill status={booking.status} />
      </View>

      {/* Same origin/destination rail the passenger sees, so both sides of the
          demo describe a trip the same way. */}
      <View style={styles.routeRow}>
        <View style={styles.rail}>
          <View style={styles.railDot} />
          <View style={styles.railLine} />
          <View style={[styles.railDot, styles.railDotEnd]} />
        </View>
        <View style={styles.routeText}>
          <Text style={styles.routePort} numberOfLines={1}>{booking.fromPortName}</Text>
          <Text style={[styles.routePort, styles.routePortTo]} numberOfLines={1}>
            {booking.toPortName}
          </Text>
        </View>
        <View style={styles.fareWrap}>
          <Text style={styles.fare}>₱{booking.totalPrice}</Text>
          <Text style={styles.fareUnit}>{booking.numOfPassenger} pax</Text>
        </View>
      </View>

      <View style={styles.passengerRow}>
        <Icon name="profile" size={14} color={colors.textMuted} />
        <Text style={styles.passenger} numberOfLines={1}>
          {booking.passengerName}
          {booking.passengerPhone ? ` · ${formatPhone(booking.passengerPhone)}` : ''}
        </Text>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.huge },

  // ---------- header ----------
  iconBtn: {
    width: touchTarget, height: touchTarget,
    alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill,
  },
  iconBtnPressed: { backgroundColor: colors.surface },

  // ---------- availability hero ----------
  statusCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg,
    ...elevation.e2,
  },
  statusCardOn: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
  statusTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statusDot: { width: 10, height: 10, borderRadius: radii.pill },
  statusDotOn: { backgroundColor: colors.primary },
  statusDotOff: { backgroundColor: colors.textMuted },
  statusWord: { flexShrink: 1, ...typography.label, color: colors.textMuted, fontSize: 13 },
  statusWordOn: { color: colors.primary },
  statusSpacer: { flex: 1 },
  statusHint: { flexShrink: 1, ...typography.caption, color: colors.textSecondary, marginTop: spacing.sm },

  // ---------- port-queue chip (008) ----------
  queueWrap: {
    marginTop: spacing.md, paddingTop: spacing.md,
    borderTopWidth: 1, borderTopColor: colors.borderSubtle,
    gap: spacing.xxs,
  },
  queueText: { flexShrink: 1, ...typography.caption, color: colors.textMuted, lineHeight: 18 },
  queueTextOn: { color: colors.primary, fontWeight: '600' },
  queueGps: { flexShrink: 1, ...typography.micro, color: colors.warning, lineHeight: 16 },

  boatRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginTop: spacing.lg, paddingTop: spacing.lg,
    borderTopWidth: 1, borderTopColor: colors.borderSubtle,
  },
  boatName: { ...typography.bodyStrong, flex: 1 },
  verifiedPill: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xxs,
    backgroundColor: colors.successTint, borderRadius: radii.pill,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs,
  },
  verifiedText: { ...typography.label, color: colors.success, letterSpacing: 0 },
  pendingPill: {
    backgroundColor: colors.warningTint, borderRadius: radii.pill,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs,
  },
  pendingText: { ...typography.label, color: colors.warning, letterSpacing: 0 },

  // ---------- error banner ----------
  banner: {
    marginTop: spacing.lg,
    backgroundColor: colors.dangerTint,
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  bannerText: { flexShrink: 1, ...typography.caption, color: colors.danger, lineHeight: 18 },

  // ---------- sections ----------
  sectionLabel: { ...typography.label, marginTop: spacing.huge, marginBottom: spacing.md },
  sectionHead: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginTop: spacing.huge, marginBottom: spacing.md,
  },
  sectionLabelInline: { ...typography.label },
  countPill: {
    minWidth: 20, height: 20, borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xs,
  },
  countPillText: { flexShrink: 1, ...typography.label, color: colors.textSecondary, letterSpacing: 0 },
  countPillLive: { backgroundColor: colors.primary },
  countPillTextLive: { flexShrink: 1, ...typography.label, color: colors.primaryText, letterSpacing: 0 },

  demandRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },

  // ---------- earnings ----------
  earningsRow: { flexDirection: 'row', gap: spacing.md },
  earningsItem: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1, borderColor: colors.borderSubtle,
    paddingVertical: spacing.lg, paddingHorizontal: spacing.md,
    alignItems: 'center', gap: spacing.xs,
    ...elevation.e1,
  },
  earningsValue: { flexShrink: 1, ...typography.display, fontSize: 24, color: colors.primary },
  earningsValueMuted: { color: colors.textSecondary },
  earningsLabel: { ...typography.label },

  // ---------- offline ----------
  offlineBox: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1, borderColor: colors.borderSubtle,
    borderStyle: 'dashed',
    padding: spacing.xl,
    alignItems: 'center',
  },
  offlineIconRing: {
    width: 56, height: 56, borderRadius: radii.pill,
    borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.md,
  },
  offlineTitle: { ...typography.bodyStrong, color: colors.textSecondary, marginBottom: spacing.xs },
  offlineText: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },

  stateBox: { minHeight: 200 },

  // ---------- request cards ----------
  request: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1, borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...elevation.e1,
  },
  activeTrip: { borderColor: colors.primary, backgroundColor: colors.surfaceAlt },
  requestPressed: { borderColor: colors.primary, backgroundColor: colors.surfaceAlt },
  requestTop: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: spacing.md, gap: spacing.sm,
  },
  requestRef: { flexShrink: 1, ...typography.label, color: colors.textMuted, letterSpacing: 0.5 },

  routeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rail: { alignItems: 'center' },
  railDot: { width: 8, height: 8, borderRadius: radii.pill, backgroundColor: colors.primary },
  railDotEnd: { borderRadius: radii.xs, backgroundColor: colors.textSecondary },
  railLine: { width: 2, height: 18, backgroundColor: colors.border, marginVertical: spacing.xxs },
  routeText: { flex: 1 },
  routePort: { flexShrink: 1, ...typography.bodyStrong },
  routePortTo: { marginTop: spacing.md },
  fareWrap: { alignItems: 'flex-end' },
  fare: { flexShrink: 1, ...typography.h2, color: colors.primary },
  fareUnit: { flexShrink: 1, ...typography.label, letterSpacing: 0, fontSize: 10 },

  passengerRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    marginTop: spacing.lg, paddingTop: spacing.md,
    borderTopWidth: 1, borderTopColor: colors.borderSubtle,
  },
  passenger: { ...typography.caption, color: colors.textMuted, flex: 1 },

  // ---------- dispatch chips (008) ----------
  chipRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: spacing.sm, marginTop: spacing.md, flexWrap: 'wrap',
  },
  holdChip: {
    flexShrink: 1,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.pill,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xxs,
  },
  holdChipLive: { backgroundColor: colors.successTint, borderColor: colors.success },
  holdChipBlock: { backgroundColor: colors.dangerTint, borderColor: colors.danger },
  holdChipText: { flexShrink: 1, ...typography.label, color: colors.textSecondary, letterSpacing: 0 },
  holdChipTextLive: { color: colors.success },
  holdChipTextBlock: { color: colors.danger },
  chipDistance: { flexShrink: 1, ...typography.label, color: colors.textMuted, letterSpacing: 0 },

  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  declineBtn: { flex: 1 },
  acceptBtn: { flex: 2 },
});
