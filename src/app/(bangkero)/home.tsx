import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { DemandBadge } from '@/components/DemandBadge';
import { EarningsCard } from '@/components/EarningsCard';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { Icon } from '@/components/Icon';
import { SideDrawer } from '@/components/SideDrawer';
import { MENU_TITLE, menuFor } from '@/config/menu';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { StatusPill } from '@/components/StatusPill';
import { useAuth } from '@/hooks/useAuth';
import { useMyTrips, useOpenRequests, useBangkero } from '@/hooks/useSupabase';
import {
  acceptBooking, completeBooking, friendlyError, rejectBooking, setAvailability,
} from '@/services/booking.service';
import { colors, elevation, radii, spacing, touchTarget, typography } from '@/theme/tokens';
import type { BookingDoc } from '@/types/models';
import { formatPhone } from '@/utils/phone';

export default function BangkeroHome() {
  const { user, profile } = useAuth();
  const uid = user?.id ?? null;

  const bangkero = useBangkero(uid);
  const requests = useOpenRequests(uid);
  const trips = useMyTrips(uid);

  const [pending, setPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const available = bangkero.data?.isAvailable ?? false;

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
    if (!uid || !bangkero.data) return;
    setPending(b.bookingId);
    setActionError(null);
    try {
      await acceptBooking(b.bookingId, {
        uid,
        displayName: bangkero.data.displayName,
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
  const todayEarnings = trips.data
    .filter((t) => t.status === 'completed')
    .reduce((sum, t) => sum + t.totalPrice, 0);

  return (
    <ScreenContainer padded={false}>
      <SideDrawer
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={MENU_TITLE.bangkero}
        items={menuFor('bangkero')}
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable
            onPress={() => setDrawerOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Open menu"
            style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
          >
            <Icon name="menu" size={22} color={colors.text} />
          </Pressable>

          <View style={styles.headerText}>
            <Text style={styles.eyebrow}>BANGKERO</Text>
            <Text style={styles.greeting} numberOfLines={1}>
              {profile ? `Kumusta, ${profile.firstName}` : 'Kumusta'}
            </Text>
          </View>

          <Pressable
            onPress={() => router.push('/(bangkero)/profile')}
            accessibilityRole="button"
            accessibilityLabel="Profile"
            style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
          >
            <Icon name="profile" size={22} color={colors.text} />
          </Pressable>
        </View>

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
              disabled={bangkero.loading || !bangkero.data}
              trackColor={{ false: colors.border, true: colors.primaryDark }}
              thumbColor={available ? colors.primary : colors.textMuted}
            />
          </View>

          <Text style={styles.statusHint}>
            {available
              ? 'You are receiving booking requests.'
              : 'Turn on to start receiving booking requests.'}
          </Text>

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
              ₱{todayEarnings * 5}
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
          requests.data.map((b) => (
            <View key={b.bookingId} style={styles.request}>
              <RequestBody booking={b} />
              {/* Accept is the intended action and carries twice the width;
                  giving a decline equal weight makes operators hesitate. */}
              <View style={styles.actions}>
                <PrimaryButton
                  label="Decline"
                  variant="secondary"
                  onPress={() => decline(b)}
                  disabled={pending === b.bookingId}
                  style={styles.declineBtn}
                />
                <PrimaryButton
                  label="Accept"
                  onPress={() => accept(b)}
                  loading={pending === b.bookingId}
                  style={styles.acceptBtn}
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
  header: {
    flexDirection: 'row', alignItems: 'center',
    marginBottom: spacing.xl, gap: spacing.sm,
    marginHorizontal: -spacing.sm, // let the 44pt targets sit flush to the edge
  },
  iconBtn: {
    width: touchTarget, height: touchTarget,
    alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill,
  },
  iconBtnPressed: { backgroundColor: colors.surface },
  headerText: { flex: 1 },
  eyebrow: { ...typography.label, marginBottom: spacing.xxs },
  greeting: { ...typography.h2 },

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
  statusWord: { ...typography.label, color: colors.textMuted, fontSize: 13 },
  statusWordOn: { color: colors.primary },
  statusSpacer: { flex: 1 },
  statusHint: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.sm },

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
  bannerText: { ...typography.caption, color: colors.danger, lineHeight: 18 },

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
  countPillText: { ...typography.label, color: colors.textSecondary, letterSpacing: 0 },
  countPillLive: { backgroundColor: colors.primary },
  countPillTextLive: { ...typography.label, color: colors.primaryText, letterSpacing: 0 },

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
  earningsValue: { ...typography.display, fontSize: 24, color: colors.primary },
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
  requestTop: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: spacing.md, gap: spacing.sm,
  },
  requestRef: { ...typography.label, color: colors.textMuted, letterSpacing: 0.5 },

  routeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rail: { alignItems: 'center' },
  railDot: { width: 8, height: 8, borderRadius: radii.pill, backgroundColor: colors.primary },
  railDotEnd: { borderRadius: radii.xs, backgroundColor: colors.textSecondary },
  railLine: { width: 2, height: 18, backgroundColor: colors.border, marginVertical: spacing.xxs },
  routeText: { flex: 1 },
  routePort: { ...typography.bodyStrong },
  routePortTo: { marginTop: spacing.md },
  fareWrap: { alignItems: 'flex-end' },
  fare: { ...typography.h2, color: colors.primary },
  fareUnit: { ...typography.label, letterSpacing: 0, fontSize: 10 },

  passengerRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    marginTop: spacing.lg, paddingTop: spacing.md,
    borderTopWidth: 1, borderTopColor: colors.borderSubtle,
  },
  passenger: { ...typography.caption, color: colors.textMuted, flex: 1 },

  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  declineBtn: { flex: 1 },
  acceptBtn: { flex: 2 },
});
