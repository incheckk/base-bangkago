import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { PassengerScreenHeader } from '@/components/PassengerScreenHeader';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { StarRating } from '@/components/StarRating';
import { StatusPill } from '@/components/StatusPill';
import { LoadingState, ErrorState } from '@/components/States';
import { useAuth } from '@/hooks/useAuth';
import { useBooking, usePorts } from '@/hooks/useSupabase';
import { getIslandPackage } from '@/services/island-package.service';
import { getRatingsByBooking } from '@/services/rating.service';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import type { IslandPackageDoc } from '@/types/models';

export default function TripDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { data: booking, loading, error } = useBooking(id ?? null);
  const [ratedScore, setRatedScore] = useState<number | null>(null);
  const ports = usePorts();
  const [pkg, setPkg] = useState<IslandPackageDoc | null>(null);

  // Package bookings show every stop of the hop, not just first → last.
  useEffect(() => {
    if (!booking?.packageId) return;
    let alive = true;
    getIslandPackage(booking.packageId)
      .then((p) => {
        if (alive) setPkg(p);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [booking?.packageId]);

  // Completed trips offer a rate action until one exists (013 guards
  // the race on the server).
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

  if (loading) {
    return (
      <ScreenContainer>
        <LoadingState label="Loading trip details…" />
      </ScreenContainer>
    );
  }

  if (error) {
    return (
      <ScreenContainer>
        <ErrorState message={error} />
      </ScreenContainer>
    );
  }

  if (!booking) {
    return (
      <ScreenContainer>
        <ErrorState message="Booking not found." />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padded={false}>
      <PassengerScreenHeader title="Trip Details" showDrawer={false} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.eyebrow}>TRIP DETAILS</Text>
        <Text style={styles.title}>{booking.ref}</Text>

        <View style={styles.statusRow}>
          <StatusPill status={booking.status} />
        </View>

        {/* Route */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>ROUTE</Text>
          <View style={styles.routeRow}>
            <Text style={styles.port} numberOfLines={2}>{booking.fromPortName}</Text>
            <View style={styles.routeToRow}>
              <Text style={styles.arrow}>→</Text>
              <Text style={styles.port} numberOfLines={2}>{booking.toPortName}</Text>
            </View>
          </View>
        </View>

        {/* Island-hop itinerary — every stop, in order. */}
        {!!pkg && pkg.stops.length > 1 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>ITINERARY · {pkg.packageName.toUpperCase()}</Text>
            {pkg.stops.map((stopId, i) => (
              <Text key={`${stopId}-${i}`} style={styles.itineraryStop} numberOfLines={1}>
                {i + 1}. {ports.data.find((p) => p.portId === stopId)?.portName ?? stopId}
                {i < pkg.stops.length - 1 ? '  ↓' : ''}
              </Text>
            ))}
          </View>
        )}

        {/* Schedule — rides are same-day, so a booking always has a date and
            the departure/arrival rows fill in live as the bangkero moves. */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>SCHEDULE</Text>
          <InfoRow label="Trip date" value={formatDate(booking.createdAt)} />
          <InfoRow
            label="Departure"
            value={
              booking.departTime
                ? formatDate(booking.departTime)
                : booking.status === 'open' || booking.status === 'accepted'
                  ? 'Not departed yet'
                  : '—'
            }
          />
          <InfoRow
            label="Arrival"
            value={
              booking.arrivalTime
                ? formatDate(booking.arrivalTime)
                : booking.status === 'completed'
                  ? 'Today (same day)'
                  : booking.status === 'open' || booking.status === 'accepted'
                    ? 'Expected today'
                    : '—'
            }
          />
        </View>

        {/* Passenger */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>PASSENGER INFO</Text>
          <InfoRow label="Passengers" value={`${booking.numOfPassenger} pax`} />
          <InfoRow label="Service" value={capitalize(booking.serviceType)} />
        </View>

        {/* Operator */}
        {booking.operatorName && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>OPERATOR</Text>
            <InfoRow label="Name" value={booking.operatorName} />
            {booking.operatorBoatName && (
              <InfoRow label="Boat" value={booking.operatorBoatName} />
            )}
          </View>
        )}

        {/* Fare */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>FARE BREAKDOWN</Text>
          <InfoRow label="Total fare" value={`₱${booking.totalPrice}`} highlight />
        </View>

        {/* Rating — completed trips only, until one exists (013). */}
        {booking.status === 'completed' && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>RATING</Text>
            {ratedScore !== null ? (
              <View style={styles.ratedRow}>
                <StarRating rating={ratedScore} size={18} />
                <Text style={styles.ratedText}>You rated this trip</Text>
              </View>
            ) : (
              <>
                <Text style={styles.rateHint}>
                  How was your ride with {booking.operatorName ?? 'your bangkero'}?
                </Text>
                <PrimaryButton
                  label="Rate this trip"
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
                  style={styles.rateBtn}
                />
              </>
            )}
          </View>
        )}

        {/* Cancel reason */}
        {booking.cancelReason && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>CANCELLATION</Text>
            <Text style={styles.cancelReason}>{booking.cancelReason}</Text>
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

function InfoRow({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={infoStyles.row}>
      <Text style={infoStyles.label}>{label}</Text>
      <Text style={[infoStyles.value, highlight && infoStyles.highlight]} numberOfLines={2}>{value}</Text>
    </View>
  );
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl, flexGrow: 1 },
  eyebrow: { ...typography.label, marginBottom: 2 },
  title: { flexShrink: 1, ...typography.h1, marginBottom: spacing.md },
  statusRow: { marginBottom: spacing.xl },
  section: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  sectionLabel: { ...typography.label, marginBottom: spacing.md },
  routeRow: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  routeToRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  port: { color: colors.text, fontSize: 18, fontWeight: '700', flexShrink: 1, minWidth: 0 },
  arrow: { color: colors.primary, fontSize: 18, fontWeight: '700' },
  itineraryStop: { color: colors.text, fontSize: 14, fontWeight: '600', lineHeight: 22 },
  cancelReason: { flexShrink: 1, color: colors.danger, fontSize: 14, lineHeight: 20 },
  ratedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  ratedText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
  rateHint: { color: colors.textSecondary, fontSize: 14, marginBottom: spacing.md },
  rateBtn: { marginTop: spacing.xs },
});

const infoStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    gap: spacing.md,
  },
  label: { color: colors.textSecondary, fontSize: 14, flexShrink: 0 },
  value: { color: colors.text, fontSize: 14, fontWeight: '600', flexShrink: 1, minWidth: 0, textAlign: 'right', marginLeft: spacing.md },
  highlight: { color: colors.primary, fontSize: 16 },
});
