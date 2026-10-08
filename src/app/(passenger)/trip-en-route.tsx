import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
import { getBangkaIdForBangkero } from '@/services/tracking.service';
import { colors, radii, spacing, touchTarget } from '@/theme/tokens';

const STEPS = ['Boarded', 'En Route', 'Arriving', 'Arrived'];

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
          icon="⛵"
          title="No trip in progress"
          message="You have no active booking right now. Book a ride and it will show up here."
        />
        <Pressable
          style={styles.sosButton}
          onPress={() => router.replace('/(passenger)/home')}
        >
          <Text style={styles.sosText}>Back to Home</Text>
        </Pressable>
      </ScreenContainer>
    );
  }

  // Real progress from the booking row — boarding, then underway.
  const currentStep = booking.completedAt
    ? 3
    : booking.onboardedAt
      ? 1
      : 0;
  const initials = initialsOf(booking.operatorName ?? '');

  return (
    <ScreenContainer>
      <PassengerScreenHeader title="Trip En Route" showDrawer={false} />
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Map area — live vessel marker when a fix has been reported. */}
        <View style={styles.mapArea}>
          <MapContainer
            ports={ports.data}
            height={260}
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
        </View>

        <View style={styles.content}>
          {/* Status pill */}
          <View style={styles.statusRow}>
            <StatusPill status={booking.status} />
            <Text style={styles.eta}>
              {booking.completedAt
                ? 'Trip completed'
                : booking.onboardedAt
                  ? 'On the way'
                  : `Meet at ${booking.fromPortName}`}
            </Text>
          </View>

          {/* Bangkero info card */}
          <View style={styles.card}>
            <View style={styles.bangkeroRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initials}</Text>
              </View>
              <View style={styles.bangkeroInfo}>
                <Text style={styles.bangkeroName}>{booking.operatorName ?? 'Unassigned bangkero'}</Text>
                {!!booking.operatorBoatName && (
                  <Text style={styles.boatName}>Boat: {booking.operatorBoatName}</Text>
                )}
                {avgRating !== null && <StarRating rating={avgRating} />}
              </View>
            </View>
          </View>

          {/* Trip progress */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Trip Progress</Text>
            <View style={styles.stepsContainer}>
              {STEPS.map((step, i) => (
                <View key={step} style={styles.stepItem}>
                  <View style={[styles.stepDot, i <= currentStep && styles.stepDotActive]}>
                    <Text style={[styles.stepDotText, i <= currentStep && styles.stepDotTextActive]}>
                      {i < currentStep ? '✓' : i + 1}
                    </Text>
                  </View>
                  <Text style={[styles.stepLabel, i <= currentStep && styles.stepLabelActive]}>
                    {step}
                  </Text>
                  {i < STEPS.length - 1 && (
                    <View style={[styles.stepLine, i < currentStep && styles.stepLineActive]} />
                  )}
                </View>
              ))}
            </View>
          </View>

          {/* Action buttons */}
          <View style={styles.actions}>
            <Pressable
              style={styles.sosButton}
              onPress={() => router.push('/(passenger)/report-issue')}
            >
              <Text style={styles.sosText}>SOS — Emergency</Text>
            </Pressable>

            <Pressable
              style={[styles.contactButton, !operatorPhone && styles.contactDisabled]}
              disabled={!operatorPhone}
              onPress={() => {
                if (!operatorPhone) return;
                void router.push(`tel:${operatorPhone.replace('+', '')}`);
              }}
            >
              <Text style={styles.contactText}>
                {operatorPhone ? 'Contact Bangkero' : 'Contact unavailable'}
              </Text>
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

const styles = StyleSheet.create({
  scroll: { paddingBottom: spacing.xxl },
  mapArea: {
    height: 260,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderBottomLeftRadius: radii.lg,
    borderBottomRightRadius: radii.lg,
  },
  content: { padding: spacing.lg, gap: spacing.lg },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  eta: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '600',
    flexShrink: 1,
    textAlign: 'right',
  },
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: radii.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  bangkeroRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: colors.primaryText,
    fontSize: 15,
    fontWeight: '700',
  },
  bangkeroInfo: { gap: 2 },
  bangkeroName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  boatName: {
    color: colors.textSecondary,
    fontSize: 11,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
    marginBottom: spacing.md,
  },
  stepsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stepItem: {
    alignItems: 'center',
    flex: 1,
  },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
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
  stepDotText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  stepDotTextActive: {
    color: colors.primaryText,
  },
  stepLabel: { flexShrink: 1,
    color: colors.textMuted,
    fontSize: 10,
    marginTop: spacing.xs,
  },
  stepLabelActive: {
    color: colors.primary,
  },
  stepLine: {
    position: 'absolute',
    top: 14,
    left: '60%',
    right: '-60%',
    height: 2,
    backgroundColor: colors.border,
  },
  stepLineActive: {
    backgroundColor: colors.primary,
  },
  actions: { gap: spacing.md },
  sosButton: { minHeight: touchTarget, justifyContent: 'center',
    backgroundColor: colors.danger,
    borderRadius: radii.pill,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  sosText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  contactButton: { minHeight: touchTarget, justifyContent: 'center',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.pill,
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  contactDisabled: { opacity: 0.5 },
  contactText: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '600',
  },
});
