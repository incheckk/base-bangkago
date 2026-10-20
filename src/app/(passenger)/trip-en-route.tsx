import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { MapContainer } from '@/components/MapContainer';
import { ScreenContainer } from '@/components/ScreenContainer';
import { StatusPill } from '@/components/StatusPill';
import { StarRating } from '@/components/StarRating';
import { PassengerScreenHeader } from '@/components/PassengerScreenHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { useAuth } from '@/hooks/useAuth';
import { useRefetchOnFocus } from '@/hooks/useRealtimeQuery';
import { useVesselTracking } from '@/hooks/useVesselTracking';
import { usePorts, useBooking } from '@/hooks/useSupabase';
import { getActiveBooking } from '@/services/booking.service';
import { fetchUserDoc } from '@/services/auth.service';
import { getAverageRating } from '@/services/rating.service';
import { endPortOf, startPortOf } from '@/services/queue.service';
import { getAllRoutes } from '@/services/route.service';
import { getBangkaIdForBangkero } from '@/services/tracking.service';
import { colors, elevation, radii, spacing, touchTarget, typography } from '@/theme/tokens';

/**
 * Three steps, not four.
 *
 * This read `['Boarded', 'En Route', 'Arriving', 'Arrived']`, but the booking
 * row only distinguishes three states — waiting, onboarded, completed — so
 * index 2 was unreachable and "Arriving" could never light up. A step that
 * never activates teaches passengers to distrust the whole rail.
 *
 * The labels are also written from the passenger's side now: what you do, not
 * what the record says.
 */
const STEPS = ['Meet at port', 'On the way', 'Arrived'];

/** Half a step's width, as a percentage — where the connector track starts. */
const TRACK_INSET = `${100 / (STEPS.length * 2)}%` as const;

/**
 * The live trip screen. The map shows the bangka's latest GPS fix in
 * realtime (B5: useVesselTracking on the operator's boat — bookings
 * never carry bangka_id, so it resolves through the bangkero). Steps,
 * bangkero, rating and route all come from the real active booking.
 */
export default function TripEnRoute() {
  const { user } = useAuth();
  const ports = usePorts();

  // Resolve the one open/accepted booking first, then load it fully.
  const [activeId, setActiveId] = useState<string | null | undefined>(undefined);
  const loadActive = useCallback(async () => {
    if (!user?.id) {
      setActiveId(null);
      return;
    }
    try {
      const active = await getActiveBooking(user.id);
      setActiveId(active?.bookingId ?? null);
    } catch {
      setActiveId(null);
    }
  }, [user?.id]);

  useEffect(() => {
    void loadActive();
  }, [loadActive]);
  useRefetchOnFocus(loadActive);

  const { data: booking, loading, error } = useBooking(activeId ?? null);
  const [avgRating, setAvgRating] = useState<number | null>(null);
  // The booking row keeps only the operator's name — the number lives on users.
  const [operatorPhone, setOperatorPhone] = useState<string | null>(null);

  // Which boat to watch: bookings never carry bangka_id (accept only
  // records the operator), so resolve it through the bangkero's fleet.
  const [bangkaId, setBangkaId] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!booking?.operatorId) {
      setBangkaId(null);
      return;
    }
    getBangkaIdForBangkero(booking.operatorId)
      .then((id) => { if (alive) setBangkaId(id); })
      .catch(() => { if (alive) setBangkaId(null); });
    return () => { alive = false; };
  }, [booking?.operatorId]);

  // Latest fix first (getTrackingByBangka orders desc), refreshed live.
  const { data: positions } = useVesselTracking(bangkaId);
  const vessel = positions[0] ?? null;

  // Route estimate for the "On the way" ETA line — one fetch per route.
  const [routeMins, setRouteMins] = useState<number | null>(null);
  useEffect(() => {
    if (!booking?.routeId) return;
    let alive = true;
    getAllRoutes()
      .then((routes) => {
        if (!alive) return;
        setRouteMins(routes.find((r) => r.routeId === booking.routeId)?.estimatedMinutes ?? null);
      })
      .catch(() => {
        if (alive) setRouteMins(null);
      });
    return () => {
      alive = false;
    };
  }, [booking?.routeId]);

  // Live clock for the "last seen" age — a render must not call Date.now,
  // so the age reads off this ticker (runs only while underway).
  const [now, setNow] = useState(() => Date.now());
  const underway = !!booking?.departTime && !booking?.completedAt;
  useEffect(() => {
    if (!underway) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [underway]);

  useEffect(() => {
    let alive = true;
    if (!booking?.operatorId) {
      setOperatorPhone(null);
      return;
    }
    fetchUserDoc(booking.operatorId)
      .then((u) => { if (alive) setOperatorPhone(u?.phone ?? null); })
      .catch(() => { if (alive) setOperatorPhone(null); });
    return () => { alive = false; };
  }, [booking?.operatorId]);

  useEffect(() => {
    let alive = true;
    if (!booking?.operatorId) {
      setAvgRating(null);
      return;
    }
    getAverageRating(booking.operatorId)
      .then((avg) => {
        if (alive) setAvgRating(avg);
      })
      .catch(() => {
        if (alive) setAvgRating(null);
      });
    return () => {
      alive = false;
    };
  }, [booking?.operatorId]);

  if (activeId === undefined || (activeId !== null && loading)) {
    return (
      <ScreenContainer>
        <PassengerScreenHeader title="Trip En Route" showDrawer={false} />
        <LoadingState label="Loading your trip…" />
      </ScreenContainer>
    );
  }

  if (error && activeId) {
    return (
      <ScreenContainer>
        <PassengerScreenHeader title="Trip En Route" showDrawer={false} />
        <ErrorState message={error} />
      </ScreenContainer>
    );
  }

  if (!booking) {
    return (
      <ScreenContainer>
        <PassengerScreenHeader title="Trip En Route" showDrawer={false} />
        <EmptyState
          icon="boat"
          title="No trip in progress"
          message="You have no active booking. New bookings will appear here."
        />
        {/* This used to reuse the SOS button's style, so the empty state
            offered a danger-red "Back to Home". Going home is not an
            emergency. */}
        <View style={styles.emptyAction}>
          <Pressable
            onPress={() => router.replace('/(passenger)/home')}
            accessibilityRole="button"
            style={({ pressed }) => [styles.secondaryBtn, pressed && styles.secondaryBtnPressed]}
          >
            <Text style={styles.secondaryBtnText}>Back to Home</Text>
          </Pressable>
        </View>
      </ScreenContainer>
    );
  }

  // Real progress from the booking row. "On the way" keys off depart_time —
  // the boat actually leaving — not off boarding, which can happen long
  // before the sails are up.
  const currentStep = booking.completedAt ? 2 : booking.departTime ? 1 : 0;
  const initials = initialsOf(booking.operatorName ?? '');

  // Underway facts: ETA from the departure stamp + route estimate, and how
  // stale the boat's GPS is — quiet while the fix is fresh, a warning when
  // the position has gone silent mid-voyage.
  const enRoute = underway;
  const etaClock =
    enRoute && booking.departTime && routeMins != null
      ? new Date(Date.parse(booking.departTime) + routeMins * 60_000).toLocaleTimeString('en-PH', {
          hour: '2-digit',
          minute: '2-digit',
        })
      : null;
  const fixAgeMs = vessel ? now - Date.parse(vessel.recordedAt) : null;
  const stale = fixAgeMs != null && fixAgeMs > 5 * 60_000;
  const fixAgeLabel =
    fixAgeMs == null
      ? ''
      : fixAgeMs < 60_000
        ? 'just now'
        : `${Math.round(fixAgeMs / 60_000)} min ago`;

  return (
    <ScreenContainer>
      <PassengerScreenHeader title="Trip En Route" showDrawer={false} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Map runs full-bleed. It used to sit in a wrapper that restated its
            height and painted a surface behind it — two containers, one job. */}
        <MapContainer
          ports={ports.data}
          fromPortId={startPortOf(booking.routeId)}
          toPortId={endPortOf(booking.routeId)}
          height={260}
          // Inside a ScrollView: one-finger drag has to stay with the page or
          // the map becomes a dead zone you cannot scroll past. Pinch and the
          // zoom buttons still work.
          draggable={false}
          vessels={
            vessel
              ? [{
                  latitude: vessel.latitude,
                  longitude: vessel.longitude,
                  speed: vessel.speed,
                  bangkaId: vessel.bangkaId,
                }]
              : []
          }
        />

        <View style={styles.content}>
          {/* One card for one trip.
              Status, progress and crew were three separate cards stacked down
              the page, which read as three unrelated things — they are three
              facts about the same journey, so they share a card and are split
              by rules instead of by gaps. */}
          <View style={styles.card}>
            <View style={styles.statusRow}>
              <StatusPill status={booking.status} />
              <Text style={styles.eta} numberOfLines={1}>
                {booking.completedAt
                  ? 'Trip completed'
                  : enRoute
                    ? `On the way${etaClock ? ` · ETA ~${etaClock}` : ''}`
                    : booking.onboardedAt
                      ? 'Boarded — about to sail'
                      : `Meet at ${booking.fromPortName}`}
              </Text>
            </View>

            {enRoute && (
              <Text style={[styles.lastSeen, stale && styles.lastSeenStale]} numberOfLines={1}>
                {vessel
                  ? `Boat last seen ${fixAgeLabel}${stale ? ' — signal may be out' : ''}`
                  : 'Waiting for the boat’s GPS…'}
              </Text>
            )}

            <View style={styles.divider} />

            {/* Progress rail. The connector is one track inset by half a step
                either side, rather than a per-step absolute segment at
                `right: -60%` — that overflowed the card on long labels. */}
            <View style={styles.steps}>
              <View style={styles.stepTrack} />
              <View
                style={[
                  styles.stepTrackFill,
                  { width: `${(currentStep / STEPS.length) * 100}%` },
                ]}
              />
              {STEPS.map((step, i) => {
                const done = i < currentStep;
                const active = i <= currentStep;
                return (
                  <View key={step} style={styles.stepItem}>
                    <View style={[styles.stepDot, active && styles.stepDotActive]}>
                      {done ? (
                        <Icon name="check" size={16} color={colors.primaryText} />
                      ) : (
                        <Text style={[styles.stepDotText, active && styles.stepDotTextActive]}>
                          {i + 1}
                        </Text>
                      )}
                    </View>
                    <Text
                      style={[styles.stepLabel, active && styles.stepLabelActive]}
                      numberOfLines={2}
                    >
                      {step}
                    </Text>
                  </View>
                );
              })}
            </View>

            <View style={styles.divider} />

            <View style={styles.bangkeroRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initials}</Text>
              </View>
              <View style={styles.bangkeroInfo}>
                <Text style={styles.bangkeroName} numberOfLines={1}>
                  {booking.operatorName ?? 'Unassigned bangkero'}
                </Text>
                {!!booking.operatorBoatName && (
                  <Text style={styles.boatName} numberOfLines={1}>
                    {booking.operatorBoatName}
                  </Text>
                )}
                {avgRating !== null && <StarRating rating={avgRating} />}
              </View>
            </View>
          </View>

          {/* Contact is the primary action and SOS is the exception.
              SOS was a filled danger-red bar sitting ABOVE Contact, making the
              emergency control the biggest, highest target on a screen you
              open to reach your bangkero. It keeps full width so it is still
              easy to hit under pressure, but it no longer outranks the thing
              you actually came here to do. */}
          <View style={styles.actions}>
            <Pressable
              style={({ pressed }) => [styles.primaryBtn, pressed && styles.primaryBtnPressed]}
              accessibilityRole="button"
              onPress={() => {
                if (!operatorPhone) {
                  Alert.alert(
                    'Contact bangkero',
                    'The number is still loading. Ask the crew on board, or try again in a moment.'
                  );
                  return;
                }
                void router.push(`tel:${operatorPhone.replace('+', '')}`);
              }}
            >
              <Icon name="bell" size={18} color={colors.primaryText} />
              <Text style={styles.primaryBtnText}>Contact bangkero</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.sosBtn, pressed && styles.sosBtnPressed]}
              accessibilityRole="button"
              accessibilityLabel="Report an emergency"
              onPress={() => router.push('/(passenger)/report-issue')}
            >
              <Icon name="sos" size={18} color={colors.danger} />
              <Text style={styles.sosText}>SOS — Emergency</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'BG';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Dot diameter, and the track's vertical centre derived from it. */
const DOT = 30;

const styles = StyleSheet.create({
  scroll: { paddingBottom: spacing.xxl },
  content: { padding: spacing.lg, gap: spacing.lg },

  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    ...elevation.e1,
  },
  divider: {
    height: 1,
    backgroundColor: colors.borderSubtle,
    marginVertical: spacing.lg,
  },

  // ---------- status ----------
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  // Neutral on purpose. The StatusPill beside it already carries the colour;
  // a second teal string next to it just dilutes what teal means.
  eta: { flexShrink: 1, ...typography.caption, textAlign: 'right' },

  // GPS staleness while underway — quiet until the fix goes silent.
  lastSeen: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
  lastSeenStale: { color: colors.warning },

  // ---------- progress rail ----------
  steps: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  stepTrack: {
    position: 'absolute',
    top: DOT / 2 - 1,
    left: TRACK_INSET,
    right: TRACK_INSET,
    height: 2,
    backgroundColor: colors.border,
  },
  stepTrackFill: {
    position: 'absolute',
    top: DOT / 2 - 1,
    left: TRACK_INSET,
    height: 2,
    backgroundColor: colors.primary,
  },
  stepItem: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.sm,
  },
  stepDot: {
    width: DOT,
    height: DOT,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 2,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepDotActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  stepDotText: { ...typography.micro, color: colors.textMuted },
  stepDotTextActive: { color: colors.primaryText },
  stepLabel: {
    flexShrink: 1,
    ...typography.label,
    letterSpacing: 0,
    textAlign: 'center',
  },
  stepLabelActive: { color: colors.primary },

  // ---------- bangkero ----------
  bangkeroRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: { ...typography.bodyStrong, color: colors.primaryText, fontWeight: '700' },
  bangkeroInfo: { flex: 1, minWidth: 0, gap: spacing.xxs },
  bangkeroName: { flexShrink: 1, ...typography.bodyStrong, lineHeight: 20 },
  boatName: { flexShrink: 1, ...typography.label, fontWeight: '400', letterSpacing: 0 },

  // ---------- actions ----------
  actions: { gap: spacing.md },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm,
    minHeight: touchTarget + 8,
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
  },
  primaryBtnPressed: { backgroundColor: colors.primaryDark },
  primaryBtnOff: { backgroundColor: colors.surfaceAlt },
  primaryBtnText: { ...typography.bodyStrong, color: colors.primaryText, fontWeight: '700' },
  btnTextOff: { color: colors.textOnDisabled },

  // Outlined, not filled: unmistakably the danger control without being the
  // loudest thing on the screen.
  sosBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm,
    minHeight: touchTarget,
    backgroundColor: colors.dangerTintSoft,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    paddingHorizontal: spacing.lg,
  },
  sosBtnPressed: { backgroundColor: colors.dangerTint, borderColor: colors.danger },
  sosText: { ...typography.bodyStrong, color: colors.danger, fontWeight: '700' },

  // ---------- empty state ----------
  emptyAction: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl },
  secondaryBtn: {
    minHeight: touchTarget,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  secondaryBtnPressed: { borderColor: colors.primary, backgroundColor: colors.surface },
  secondaryBtnText: { ...typography.bodyStrong, color: colors.textSecondary },
});
