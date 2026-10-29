import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CompanionForm, type Companion } from '@/components/CompanionForm';
import { PassengerScreenHeader } from '@/components/PassengerScreenHeader';
import { PrimaryButton } from '@/components/PrimaryButton';
import { RouteLegPicker } from '@/components/RouteLegPicker';
import { SchedulePicker, todayIso } from '@/components/SchedulePicker';
import { ScreenContainer } from '@/components/ScreenContainer';
import { ErrorState, LoadingState } from '@/components/States';
import { useAuth } from '@/hooks/useAuth';
import { usePorts } from '@/hooks/useSupabase';
import { useRoutes } from '@/hooks/useRoutes';
import { getActiveBooking, getBookingBan, getMaxOnlineBangkaCapacity, routeIdFor } from '@/services/booking.service';
import { getQueuedSeatCeiling } from '@/services/queue.service';
import type { RouteDoc } from '@/types/models';
import { colors, elevation, numeric, radii, spacing, typography } from '@/theme/tokens';

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
  // lock to that route, since the passenger already chose it on the way in.
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
          getActiveBooking(user.id, { scheduledDate, scheduledTime }),
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
            gives the choice a shape — you can see the crossing you just picked.
            Shared with Book Delivery so both forms ask the same way. */}
        <RouteLegPicker
          ports={ports.data}
          fromId={fromId}
          toId={toId}
          onChange={(leg, id) => (leg === 'from' ? setFromId(id) : setToId(id))}
          onSwap={swap}
          locked={routeLocked}
          destinationPorts={(from) =>
            ports.data.filter((p) => p.islandGroup !== from.islandGroup)
          }
          isDisabled={(id, leg) =>
            leg === 'to' && !routeFor(fromId, id)
              ? `No route from ${fromPort?.portName ?? 'your departure port'}`
              : null
          }
        />

        <View style={styles.body}>
          {/* Same-day rides leave whenever a boat is ready; a future date
              takes one of the four fixed slots and pays 50% up front (020). */}
          <Text style={styles.sectionLabel}>SAILING DATE</Text>
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
          <View style={styles.fareInfo}>
            <Text style={styles.fareLabel}>
              {fare !== null ? 'Fare estimate' : 'Fare'}
            </Text>
            <Text style={styles.fareNote} numberOfLines={2}>
              {fare === null
                ? 'Pick both ports'
                : `₱${route?.baseFare ?? 0} per passenger · ${count} ${count === 1 ? 'passenger' : 'passengers'}${advance ? ' · 50% GCash downpayment' : ' · discounts on board'}`}
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

const FOOTER_H = 132;

const styles = StyleSheet.create({
  scroll: {},
  body: { paddingHorizontal: spacing.xl },

  // ---------- shared ----------
  sectionLabel: { ...typography.label, marginBottom: spacing.md },
  mtLg: { marginTop: spacing.xl },

  // ---------- blocked / no-show dialogs ----------
  modalBackdrop: {
    flex: 1,
    backgroundColor: colors.backdrop,
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
  blockedRefValue: { ...typography.title, ...numeric, fontWeight: '700', letterSpacing: 1 },

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
  fareInfo: { flex: 1, minWidth: 0 },
  fareLabel: { flexShrink: 1, ...typography.label },
  fareNote: { flexShrink: 1, ...typography.caption, color: colors.textMuted, marginTop: spacing.xxs },
  // The price never shrinks; the note beside it does. flexShrink:1 here was
  // what turned a long note into "₱…".
  fareValue: { flexShrink: 0, ...typography.h1, ...numeric, color: colors.primary },
  fareValueEmpty: { color: colors.textMuted },
});
