import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CompanionForm, type Companion } from '@/components/CompanionForm';
import { Icon } from '@/components/Icon';
import { MapContainer } from '@/components/MapContainer';
import { PassengerScreenHeader } from '@/components/PassengerScreenHeader';
import { PrimaryButton } from '@/components/PrimaryButton';
import { SchedulePicker, todayIso } from '@/components/SchedulePicker';
import { ScreenContainer } from '@/components/ScreenContainer';
import { ErrorState, LoadingState } from '@/components/States';
import { useAuth } from '@/hooks/useAuth';
import { usePorts } from '@/hooks/useSupabase';
import { useRoutes } from '@/hooks/useRoutes';
import { getActiveBooking, getBookingBan, getMaxOnlineBangkaCapacity, routeIdFor } from '@/services/booking.service';
import { getQueuedSeatCeiling } from '@/services/queue.service';
import type { RouteDoc } from '@/types/models';
import { colors, elevation, radii, spacing, touchTarget, typography } from '@/theme/tokens';

/** Ceiling while no boat reports a capacity (e.g. every bangkero offline). */
const FALLBACK_MAX_PAX = 12;

export default function BookRide() {
  const insets = useSafeAreaInsets();
  const { user, profile } = useAuth();
  const params = useLocalSearchParams<{
    from?: string; fromId?: string; to?: string; toId?: string;
  }>();
  const ports = usePorts();
  const { data: routes, loading: routesLoading, error: routesError } = useRoutes();

  const [fromId, setFromId] = useState<string | null>(params.fromId ?? null);
  const [toId, setToId] = useState<string | null>(params.toId ?? null);
  // Arriving with BOTH ports = a popular route from quick-ride: the pickers
  // lock to that route and the chip grids step out of the way.
  const [routeLocked] = useState(!!(params.fromId && params.toId));
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [scheduledDate, setScheduledDate] = useState(todayIso());
  const [scheduledTime, setScheduledTime] = useState<string | null>(null);
  const [maxPax, setMaxPax] = useState(FALLBACK_MAX_PAX);

  const [checking, setChecking] = useState(false);
  const [blocked, setBlocked] = useState<{ bookingId: string; ref: string } | null>(null);
  const [ban, setBan] = useState<number | null>(null);

  useEffect(() => {
    if (params.fromId) setFromId(params.fromId);
    if (params.toId) setToId(params.toId);
  }, [params.fromId, params.toId]);

  // Seat ceiling: the biggest boat WAITING (listed, dwell passed,
  // online) at the selected departure port — Phase 2's GPS gate (008).
  // While no port is queued (or pre-008), fall back to the biggest
  // online boat so booking never dead-ends.
  const [ceilingFromQueue, setCeilingFromQueue] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      let cap: number | null = null;
      try {
        cap = await getQueuedSeatCeiling(fromId || null);
      } catch {
        cap = null; // pre-008 (no port_queue table) → fallback path
      }
      if (!alive) return;
      if (cap) {
        setMaxPax(cap);
        setCeilingFromQueue(true);
        return;
      }
      setCeilingFromQueue(false);
      try {
        const online = await getMaxOnlineBangkaCapacity();
        if (alive && online) setMaxPax(online);
      } catch {
        // keep the fallback ceiling — booking still works offline
      }
    })();
    return () => {
      alive = false;
    };
  }, [fromId]);

  const activeRoutes = routes.filter((r) => r.isActive);
  const routeFor = (from: string | null, to: string | null): RouteDoc | null => {
    if (!from || !to) return null;
    const id = routeIdFor(from, to);
    return activeRoutes.find((r) => r.routeId === id) ?? null;
  };

  // Only validated once routes have loaded — on the very first pass `routes`
  // is still empty, and clearing here used to wipe a pre-filled destination
  // coming from quick-ride before it ever rendered.
  useEffect(() => {
    if (routesLoading || !fromId || !toId) return;
    const id = routeIdFor(fromId, toId);
    if (!routes.some((r) => r.isActive && r.routeId === id)) setToId(null);
  }, [fromId, toId, routes, routesLoading]);

  const fromPort = ports.data.find((p) => p.portId === fromId);
  const toPort = ports.data.find((p) => p.portId === toId);
  const route = routeFor(fromId, toId);

  const count = 1 + companions.length;
  const atCap = count >= maxPax;

  // Same-day rides at regular fare — senior/student/child discounts are
  // settled in cash on board where the bangkero can check IDs.
  const fare = route ? Math.round(route.baseFare * count) : null;

  function swap() {
    const tempFrom = fromId;
    setFromId(toId);
    setToId(tempFrom);
  }

  async function proceed() {
    if (!fromPort || !toPort || fare === null || checking) return;
    // No-show ban first, then one active booking at a time. On a failed
    // check we still proceed — createBooking re-checks at the pay step.
    if (user) {
      setChecking(true);
      try {
        const [active, banInfo] = await Promise.all([
          getActiveBooking(user.id),
          getBookingBan(user.id),
        ]);
        if (banInfo) {
          setBan(banInfo.minutesLeft);
          setChecking(false);
          return;
        }
        if (active) {
          setBlocked(active);
          setChecking(false);
          return;
        }
      } catch {
        // network hiccup — the payment step's createBooking is the backstop
      }
      setChecking(false);
    }
    router.push({
      pathname: '/(passenger)/payment',
      params: {
        fromId: fromPort.portId,
        fromName: fromPort.portName,
        toId: toPort.portId,
        toName: toPort.portName,
        count: String(count),
        serviceType: 'passenger',
        fare: String(fare),
        companionsJson: JSON.stringify(companions),
        scheduledDate,
        scheduledTime: scheduledTime ?? '',
      },
    });
  }

  if (ports.loading || routesLoading) {
    return <ScreenContainer><LoadingState label="Loading ports…" /></ScreenContainer>;
  }
  if (ports.error || routesError) {
    return <ScreenContainer><ErrorState message={ports.error ?? routesError ?? 'Could not load routes.'} /></ScreenContainer>;
  }

  const advance = scheduledDate > todayIso();
  const ready = !!fromId && !!toId && fromId !== toId && fare !== null && (!advance || !!scheduledTime);
  const bookerName = profile ? `${profile.firstName} ${profile.lastName}`.trim() : 'You';

  return (
    <ScreenContainer padded={false}>
      <PassengerScreenHeader title="Book a Ride" />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: FOOTER_H + insets.bottom + spacing.xl }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* The route reads as one object, not two unrelated chip grids. The map
            gives the choice a shape — you can see the crossing you just picked. */}
        <View style={styles.routeCard}>
          <View style={styles.mapWrap}>
            <MapContainer ports={ports.data} fromPortId={fromId} toPortId={toId} height={150} />
          </View>

          <View style={styles.legs}>
            <View style={styles.legRail}>
              <View style={[styles.legDot, !!fromId && styles.legDotOn]} />
              <View style={styles.legLine} />
              <View style={[styles.legDot, styles.legDotEnd, !!toId && styles.legDotOn]} />
            </View>

            <View style={styles.legBody}>
              <Text style={styles.legLabel}>FROM</Text>
              <Text style={[styles.legValue, !fromPort && styles.legValueEmpty]} numberOfLines={1}>
                {fromPort?.portName ?? 'Select a departure port'}
              </Text>

              <View style={styles.legDivider} />

              <Text style={styles.legLabel}>TO</Text>
              <Text style={[styles.legValue, !toPort && styles.legValueEmpty]} numberOfLines={1}>
                {toPort?.portName ?? (fromId ? 'Select a destination' : 'Pick a departure first')}
              </Text>
            </View>

            <Pressable
              onPress={swap}
              disabled={routeLocked || (!fromId && !toId)}
              accessibilityRole="button"
              accessibilityLabel="Swap departure and destination"
              style={({ pressed }) => [
                styles.swapBtn,
                (routeLocked || (!fromId && !toId)) && styles.swapBtnOff,
                pressed && styles.swapBtnPressed,
              ]}
            >
              <Icon name="route" size={18} color={colors.primary} />
            </Pressable>
          </View>
        </View>

        <View style={styles.body}>
          {/* Locked route from quick-ride — the summary above already shows
              both ports; the chip grids would only offer ways to break it. */}
          {!routeLocked && (
            <>
              <Text style={styles.sectionLabel}>DEPARTURE PORT</Text>
              <PortChips ports={ports.data} selected={fromId} disabled={toId} onSelect={setFromId} />

              {/* Destination only exists once a departure is picked — two grids
                  at once made people pick them in the wrong order. */}
              {!!fromId && (
                <>
                  <Text style={[styles.sectionLabel, styles.mtLg]}>DESTINATION PORT</Text>
                  <PortChips
                    ports={ports.data}
                    selected={toId}
                    disabled={fromId}
                    isBlocked={(id) => !!fromId && id !== fromId && !routeFor(fromId, id)}
                    onSelect={setToId}
                  />
                </>
              )}
            </>
          )}

          {/* Same-day rides leave whenever a boat is ready; a future date
              takes one of the four fixed slots and pays 50% up front (020). */}
          <Text style={[styles.sectionLabel, styles.mtLg]}>SAILING DATE</Text>
          <SchedulePicker
            date={scheduledDate}
            time={scheduledTime}
            onDate={setScheduledDate}
            onTime={setScheduledTime}
          />

          {/* You are passenger #1; companions ride under your booking. */}
          <Text style={[styles.sectionLabel, styles.mtLg]}>PASSENGERS</Text>
          <CompanionForm
            companions={companions}
            onChange={setCompanions}
            maxCount={maxPax}
            bookerName={bookerName}
            hint={
              atCap
                ? ceilingFromQueue
                  ? `Seat limit reached — ${maxPax} seats on the biggest boat waiting at ${fromPort?.portName ?? 'this port'}`
                  : `Seat limit reached — ${maxPax} seats on the largest boat`
                : ceilingFromQueue
                  ? `Up to ${maxPax} seats — biggest boat waiting at ${fromPort?.portName ?? 'this port'}`
                  : fromPort
                    ? `Up to ${maxPax} seats — no boats waiting at ${fromPort.portName} yet; your request will wait in queue.`
                    : `Up to ${maxPax} seats — largest boat available right now`
            }
          />
        </View>
      </ScrollView>

      {/* Fare and the action stay on screen. Burying the total under a scroll
          means deciding without seeing the price. */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <View style={styles.fareRow}>
          <View>
            <Text style={styles.fareLabel}>
              {fare !== null ? 'Fare estimate' : 'Fare'}
            </Text>
            <Text style={styles.fareNote} numberOfLines={1}>
              {fare === null
                ? 'Pick both ports'
                : advance
                  ? `${count} ${count === 1 ? 'passenger' : 'passengers'} · 50% GCash downpayment to confirm`
                  : `${count} ${count === 1 ? 'passenger' : 'passengers'} · discounts on board`}
            </Text>
          </View>
          <Text style={[styles.fareValue, fare === null && styles.fareValueEmpty]} numberOfLines={1}>
            {fare !== null ? `₱${fare}` : '—'}
          </Text>
        </View>

        <PrimaryButton label="Proceed to Payment" onPress={proceed} disabled={!ready} loading={checking} />
      </View>

      {/* One active trip at a time — the pending booking is offered directly
          so the passenger never has to hunt for it. */}
      <Modal
        visible={!!blocked}
        transparent
        animationType="fade"
        onRequestClose={() => setBlocked(null)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setBlocked(null)}
            accessibilityLabel="Close"
          />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>You already have a pending booking</Text>
            <Text style={styles.modalHint}>
              Only one active booking at a time. View it to track or cancel it.
            </Text>
            <View style={styles.blockedRef}>
              <Text style={styles.blockedRefLabel}>PENDING BOOKING</Text>
              <Text style={styles.blockedRefValue}>{blocked?.ref}</Text>
            </View>
            <View style={styles.modalActions}>
              <View style={styles.modalActionBtn}>
                <PrimaryButton label="Close" variant="secondary" onPress={() => setBlocked(null)} />
              </View>
              <View style={styles.modalActionBtn}>
                <PrimaryButton
                  label="View booking"
                  onPress={() => {
                    const target = blocked;
                    setBlocked(null);
                    if (target) router.push(`/(passenger)/booking/${target.bookingId}`);
                  }}
                />
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* No-show ban: booking is refused until the timer runs out. Close only
          — there is nothing to view or override. */}
      <Modal
        visible={ban !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setBan(null)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setBan(null)}
            accessibilityLabel="Close"
          />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>You were marked as a no-show</Text>
            <Text style={styles.modalHint}>
              You were told to board and the boat left without you. You can&apos;t
              book again for {ban} minute{ban === 1 ? '' : 's'} — the ban lifts on
              its own.
            </Text>
            <View style={styles.modalActions}>
              <View style={styles.modalActionBtn}>
                <PrimaryButton label="Close" variant="secondary" onPress={() => setBan(null)} />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

function PortChips({
  ports, selected, disabled, isBlocked, onSelect,
}: {
  ports: { portId: string; portName: string }[];
  selected: string | null;
  disabled: string | null;
  isBlocked?: (portId: string) => boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <View style={styles.chips}>
      {ports.map((p) => {
        const active = p.portId === selected;
        const off = p.portId === disabled || !!isBlocked?.(p.portId);
        return (
          <Pressable
            key={p.portId}
            onPress={() => onSelect(p.portId)}
            disabled={off}
            style={({ pressed }) => [
              styles.portChip,
              active && styles.portChipActive,
              off && styles.portChipOff,
              pressed && !active && !off && styles.pressed,
            ]}
          >
            {active && <Icon name="check" size={13} color={colors.primary} />}
            <Text
              style={[
                styles.portChipText,
                active && styles.portChipTextActive,
                off && styles.portChipTextOff,
              ]}
            >
              {p.portName}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const FOOTER_H = 132;

const styles = StyleSheet.create({
  scroll: {},
  body: { paddingHorizontal: spacing.xl },

  // ---------- route summary ----------
  routeCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.xl,
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    borderWidth: 1, borderColor: colors.borderSubtle,
    overflow: 'hidden',
    ...elevation.e2,
  },
  mapWrap: { borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },

  legs: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg, gap: spacing.md },
  legRail: { alignItems: 'center', paddingVertical: spacing.xs },
  legDot: {
    width: 10, height: 10, borderRadius: radii.pill,
    borderWidth: 2, borderColor: colors.textMuted, backgroundColor: 'transparent',
  },
  legDotOn: { borderColor: colors.primary, backgroundColor: colors.primary },
  legDotEnd: { borderRadius: radii.xs },
  legLine: { width: 2, flex: 1, minHeight: 28, backgroundColor: colors.border, marginVertical: spacing.xxs },
  legBody: { flex: 1 },
  legLabel: { ...typography.label, marginBottom: spacing.xxs },
  legValue: { flexShrink: 1, ...typography.bodyStrong },
  legValueEmpty: { color: colors.textMuted, fontWeight: '400' },
  legDivider: { height: 1, backgroundColor: colors.borderSubtle, marginVertical: spacing.md },

  swapBtn: {
    width: touchTarget, height: touchTarget, borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  swapBtnOff: { opacity: 0.35 },
  swapBtnPressed: { borderColor: colors.primary },

  // ---------- shared ----------
  sectionLabel: { ...typography.label, marginBottom: spacing.md },
  mtLg: { marginTop: spacing.xl },
  pressed: { opacity: 0.75 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  portChip: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    borderWidth: 1, borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    minHeight: 36,
  },
  portChipActive: { backgroundColor: colors.primaryTint, borderColor: colors.primary },
  portChipOff: { opacity: 0.3 },
  portChipText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  portChipTextActive: { color: colors.primary },
  portChipTextOff: { color: colors.textMuted },

  // ---------- companion modal (kept for the blocked/no-show dialogs) ----------
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1, borderColor: colors.borderSubtle,
    padding: spacing.xl,
    ...elevation.e3,
  },
  modalTitle: { ...typography.title, marginBottom: spacing.xs },
  modalHint: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.lg },
  modalActions: { flexDirection: 'row', gap: spacing.md },
  modalActionBtn: { flex: 1 },
  blockedRef: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.md,
    marginBottom: spacing.xl,
    alignItems: 'center',
  },
  blockedRefLabel: { ...typography.label, color: colors.textMuted, marginBottom: spacing.xxs },
  blockedRefValue: { color: colors.text, fontSize: 16, fontWeight: '700', letterSpacing: 1 },

  // ---------- sticky footer ----------
  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: colors.bgElevated,
    borderTopWidth: 1, borderTopColor: colors.border,
    paddingHorizontal: spacing.xl, paddingTop: spacing.md,
    ...elevation.e3,
  },
  fareRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: spacing.md, marginBottom: spacing.md,
  },
  fareLabel: { flexShrink: 1, ...typography.label },
  fareNote: { flexShrink: 1, ...typography.caption, color: colors.textMuted, marginTop: spacing.xxs },
  fareValue: { flexShrink: 1, ...typography.display, fontSize: 26, color: colors.primary },
  fareValueEmpty: { color: colors.textMuted },
});
