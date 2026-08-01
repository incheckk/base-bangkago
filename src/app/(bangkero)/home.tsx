import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { StatusPill } from '@/components/StatusPill';
import { useAuth } from '@/hooks/useAuth';
import { useMyTrips, useOpenRequests, useOperator } from '@/hooks/useFirestore';
import {
  acceptBooking, completeBooking, friendlyError, rejectBooking, setAvailability,
} from '@/services/booking.service';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import type { BookingDoc } from '@/types/models';
import { formatPhone } from '@/utils/phone';

export default function BangkeroHome() {
  const { user, profile } = useAuth();
  const uid = user?.uid ?? null;

  const operator = useOperator(uid);
  const requests = useOpenRequests(uid);
  const trips = useMyTrips(uid);

  const [pending, setPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const available = operator.data?.isAvailable ?? false;

  async function toggle(next: boolean) {
    if (!uid) return;
    setActionError(null);
    try {
      await setAvailability(uid, next);
    } catch (e) {
      setActionError(friendlyError(e));
    }
  }

  async function accept(b: BookingDoc) {
    if (!uid || !operator.data) return;
    setPending(b.bookingId);
    setActionError(null);
    try {
      await acceptBooking(b.bookingId, {
        uid,
        displayName: operator.data.displayName,
        boatName: operator.data.boatName,
      });
    } catch (e) {
      // Most likely another bangkero accepted first — the rule denies the write.
      setActionError(
        friendlyError(e) === 'You do not have permission to do that.'
          ? 'Another bangkero already took that trip.'
          : friendlyError(e)
      );
    }
    setPending(null);
  }

  async function decline(b: BookingDoc) {
    if (!uid) return;
    setPending(b.bookingId);
    setActionError(null);
    try {
      await rejectBooking(b.bookingId, uid);
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
    } catch (e) {
      setActionError(friendlyError(e));
    }
    setPending(null);
  }

  const activeTrips = trips.data.filter((t) => t.status === 'accepted');

  return (
    <ScreenContainer padded={false}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.eyebrow}>BANGKERO</Text>
            <Text style={styles.greeting}>
              {profile ? `Kumusta, ${profile.firstName}` : 'Kumusta'}
            </Text>
          </View>
          <Pressable onPress={() => router.push('/(bangkero)/profile')} hitSlop={8}>
            <Text style={styles.profileLink}>Profile</Text>
          </Pressable>
        </View>

        <View style={styles.boatCard}>
          <View style={styles.boatInfo}>
            <Text style={styles.boatName}>
              {operator.data?.boatName ?? 'No boat name set'}
            </Text>
            <Text style={styles.boatMeta}>
              {operator.data?.capacity ? `${operator.data.capacity} passenger capacity` : 'Capacity not set'}
            </Text>
          </View>
          <View style={styles.toggleWrap}>
            <Text style={[styles.toggleLabel, available && styles.toggleLabelOn]}>
              {available ? 'Online' : 'Offline'}
            </Text>
            <Switch
              value={available}
              onValueChange={toggle}
              disabled={operator.loading || !operator.data}
              trackColor={{ false: colors.border, true: colors.primaryDark }}
              thumbColor={available ? colors.primary : colors.textMuted}
            />
          </View>
        </View>

        {!!actionError && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>{actionError}</Text>
          </View>
        )}

        {activeTrips.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>YOUR ACTIVE TRIPS</Text>
            {activeTrips.map((b) => (
              <View key={b.bookingId} style={[styles.request, styles.activeTrip]}>
                <RequestBody booking={b} />
                <PrimaryButton
                  label="Mark completed"
                  onPress={() => complete(b)}
                  loading={pending === b.bookingId}
                  style={{ marginTop: spacing.md }}
                />
              </View>
            ))}
          </>
        )}

        <Text style={styles.sectionLabel}>INCOMING REQUESTS</Text>

        {!available ? (
          <View style={styles.offlineBox}>
            <Text style={styles.offlineTitle}>You are offline</Text>
            <Text style={styles.offlineText}>
              Turn Online above to start receiving booking requests.
            </Text>
          </View>
        ) : requests.loading ? (
          <View style={styles.stateBox}><LoadingState label="Listening for requests…" /></View>
        ) : requests.error ? (
          <View style={styles.stateBox}><ErrorState message={requests.error} /></View>
        ) : requests.data.length === 0 ? (
          <View style={styles.stateBox}>
            <EmptyState
              icon="📡"
              title="No requests right now"
              message="New bookings appear here the moment a passenger sends one."
            />
          </View>
        ) : (
          requests.data.map((b) => (
            <View key={b.bookingId} style={styles.request}>
              <RequestBody booking={b} />
              <View style={styles.actions}>
                <PrimaryButton
                  label="Decline"
                  variant="secondary"
                  onPress={() => decline(b)}
                  disabled={pending === b.bookingId}
                  style={styles.actionBtn}
                />
                <PrimaryButton
                  label="Accept"
                  onPress={() => accept(b)}
                  loading={pending === b.bookingId}
                  style={styles.actionBtn}
                />
              </View>
            </View>
          ))
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
      <Text style={styles.requestRoute}>
        {booking.fromPierName} → {booking.toPierName}
      </Text>
      <View style={styles.requestMeta}>
        <Text style={styles.metaItem}>
          {booking.passengerCount} pax · ₱{booking.fare} · {booking.estimatedMinutes} min
        </Text>
      </View>
      <Text style={styles.passenger}>
        {booking.passengerName} · {formatPhone(booking.passengerPhone)}
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  header: {
    flexDirection: 'row', alignItems: 'flex-start',
    justifyContent: 'space-between', marginBottom: spacing.lg,
  },
  headerText: { flex: 1 },
  eyebrow: { ...typography.label, marginBottom: 2 },
  greeting: { ...typography.h2 },
  profileLink: { color: colors.primary, fontSize: 14, fontWeight: '600', paddingTop: spacing.md },

  boatCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    gap: spacing.md,
  },
  boatInfo: { flex: 1 },
  boatName: { color: colors.text, fontSize: 15, fontWeight: '700' },
  boatMeta: { ...typography.caption, marginTop: 2 },
  toggleWrap: { alignItems: 'center', gap: 4 },
  toggleLabel: { ...typography.caption, color: colors.textMuted, fontSize: 11, fontWeight: '700' },
  toggleLabelOn: { color: colors.primary },

  banner: {
    marginTop: spacing.lg,
    backgroundColor: 'rgba(224,82,82,0.12)',
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  bannerText: { color: colors.danger, fontSize: 13, lineHeight: 18 },

  sectionLabel: { ...typography.label, marginTop: spacing.xxl, marginBottom: spacing.md },

  offlineBox: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.xl,
    alignItems: 'center',
  },
  offlineTitle: { color: colors.textSecondary, fontSize: 15, fontWeight: '700', marginBottom: spacing.xs },
  offlineText: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },

  stateBox: { minHeight: 180 },

  request: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  activeTrip: { borderColor: colors.primary },
  requestTop: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: spacing.md, gap: spacing.sm,
  },
  requestRef: { ...typography.caption, color: colors.textMuted, fontSize: 11, letterSpacing: 0.5 },
  requestRoute: { color: colors.text, fontSize: 15, fontWeight: '700' },
  requestMeta: { marginTop: spacing.xs },
  metaItem: { ...typography.caption, color: colors.primary, fontWeight: '600' },
  passenger: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm },

  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  actionBtn: { flex: 1 },
});
