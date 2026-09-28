import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { MapContainer } from '@/components/MapContainer';
import { PassengerScreenHeader } from '@/components/PassengerScreenHeader';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { ErrorState, LoadingState } from '@/components/States';
import { TextField } from '@/components/TextField';
import { useAuth } from '@/hooks/useAuth';
import { usePorts } from '@/hooks/useSupabase';
import { useRoutes } from '@/hooks/useRoutes';
import { getActiveBooking, getBookingBan, getMaxOnlineBangkaCapacity, routeIdFor } from '@/services/booking.service';
import { getQueuedSeatCeiling } from '@/services/queue.service';
import type { RouteDoc } from '@/types/models';
import { colors, elevation, radii, spacing, touchTarget, typography } from '@/theme/tokens';

/**
 * Everyone who rides under this booking. The booker is always passenger #1
 * (their name already lives on the booking row); each companion is captured
 * here and written to `passenger_details` after the booking is created.
 */
interface Companion {
  firstName: string;
  lastName: string;
  age?: number;
  sex?: string;
  contact?: string;
}

/** Ceiling while no boat reports a capacity (e.g. every bangkero offline). */
const FALLBACK_MAX_PAX = 12;

const initialsOf = (first: string, last: string) =>
  `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();

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
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [maxPax, setMaxPax] = useState(FALLBACK_MAX_PAX);

  const [modalOpen, setModalOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [blocked, setBlocked] = useState<{ bookingId: string; ref: string } | null>(null);
  const [ban, setBan] = useState<number | null>(null);
  const [draftFirst, setDraftFirst] = useState('');
  const [draftLast, setDraftLast] = useState('');
  const [draftAge, setDraftAge] = useState('');
  const [draftSex, setDraftSex] = useState('');
  const [draftContact, setDraftContact] = useState('');

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

  function removeCompanion(index: number) {
    setCompanions((prev) => prev.filter((_, i) => i !== index));
  }

  function addCompanion() {
    const first = draftFirst.trim();
    const last = draftLast.trim();
    if (!first || !last) return;
    const ageNum = parseInt(draftAge.trim(), 10);
    setCompanions((prev) => [
      ...prev,
      {
        firstName: first,
        lastName: last,
        age: Number.isFinite(ageNum) && ageNum > 0 ? ageNum : undefined,
        sex: draftSex || undefined,
        contact: draftContact.trim() || undefined,
      },
    ]);
    setDraftFirst('');
    setDraftLast('');
    setDraftAge('');
    setDraftSex('');
    setDraftContact('');
    setModalOpen(false);
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
      },
    });
  }

  if (ports.loading || routesLoading) {
    return <ScreenContainer><LoadingState label="Loading ports…" /></ScreenContainer>;
  }
  if (ports.error || routesError) {
    return <ScreenContainer><ErrorState message={ports.error ?? routesError ?? 'Could not load routes.'} /></ScreenContainer>;
  }

  const ready = !!fromId && !!toId && fromId !== toId && fare !== null;
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
                {toPort?.portName ?? 'Select a destination'}
              </Text>
            </View>

            <Pressable
              onPress={swap}
              disabled={!fromId && !toId}
              accessibilityRole="button"
              accessibilityLabel="Swap departure and destination"
              style={({ pressed }) => [
                styles.swapBtn,
                (!fromId && !toId) && styles.swapBtnOff,
                pressed && styles.swapBtnPressed,
              ]}
            >
              <Icon name="route" size={18} color={colors.primary} />
            </Pressable>
          </View>
        </View>

        <View style={styles.body}>
          <Text style={styles.sectionLabel}>DEPARTURE PORT</Text>
          <PortChips ports={ports.data} selected={fromId} disabled={toId} onSelect={setFromId} />

          <Text style={[styles.sectionLabel, styles.mtLg]}>DESTINATION PORT</Text>
          <PortChips
            ports={ports.data}
            selected={toId}
            disabled={fromId}
            isBlocked={(id) => !!fromId && id !== fromId && !routeFor(fromId, id)}
            onSelect={setToId}
          />

          {/* You are passenger #1; companions ride under your booking. */}
          <Text style={[styles.sectionLabel, styles.mtLg]}>PASSENGERS</Text>
          <View style={styles.paxCard}>
            <View style={styles.paxRow}>
              <View style={styles.paxAvatar}>
                <Text style={styles.paxAvatarText}>
                  {profile ? initialsOf(profile.firstName, profile.lastName) : 'Y'}
                </Text>
              </View>
              <View style={styles.paxInfo}>
                <Text style={styles.paxName} numberOfLines={1}>{bookerName}</Text>
                <Text style={styles.paxMeta} numberOfLines={1}>You — this booking is under your name</Text>
              </View>
            </View>

            {companions.map((c, i) => (
              <View key={`${c.lastName}-${c.firstName}-${i}`} style={[styles.paxRow, styles.paxRowDivided]}>
                <View style={[styles.paxAvatar, styles.paxAvatarAlt]}>
                  <Text style={[styles.paxAvatarText, styles.paxAvatarTextAlt]}>
                    {initialsOf(c.firstName, c.lastName)}
                  </Text>
                </View>
                <View style={styles.paxInfo}>
                  <Text style={styles.paxName} numberOfLines={1}>{c.firstName} {c.lastName}</Text>
                  <Text style={styles.paxMeta} numberOfLines={1}>
                    {[c.age ? `${c.age} yrs old` : null, c.sex ? c.sex.charAt(0).toUpperCase() + c.sex.slice(1) : null]
                      .filter(Boolean)
                      .join(' · ') || 'Companion'}
                  </Text>
                </View>
                <Pressable
                  onPress={() => removeCompanion(i)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${c.firstName}`}
                >
                  <Text style={styles.paxRemove}>✕</Text>
                </Pressable>
              </View>
            ))}

            <Pressable
              onPress={() => setModalOpen(true)}
              disabled={atCap}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.paxAdd,
                atCap && styles.paxAddOff,
                pressed && !atCap && styles.pressed,
              ]}
            >
              <Text style={[styles.paxAddText, atCap && styles.paxAddTextOff]}>+ Add passenger</Text>
            </Pressable>
          </View>
          <Text style={styles.paxHint}>
            {atCap
              ? ceilingFromQueue
                ? `Seat limit reached — ${maxPax} seats on the biggest boat waiting at ${fromPort?.portName ?? 'this port'}`
                : `Seat limit reached — ${maxPax} seats on the largest boat`
              : ceilingFromQueue
                ? `Up to ${maxPax} seats — biggest boat waiting at ${fromPort?.portName ?? 'this port'}`
                : fromPort
                  ? `Up to ${maxPax} seats — no boats waiting at ${fromPort.portName} yet; your request will wait in queue.`
                  : `Up to ${maxPax} seats — largest boat available right now`}
          </Text>
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
                : `${count} ${count === 1 ? 'passenger' : 'passengers'} · discounts on board`}
            </Text>
          </View>
          <Text style={[styles.fareValue, fare === null && styles.fareValueEmpty]} numberOfLines={1}>
            {fare !== null ? `₱${fare}` : '—'}
          </Text>
        </View>

        <PrimaryButton label="Proceed to Payment" onPress={proceed} disabled={!ready} loading={checking} />
      </View>

      <Modal
        visible={modalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setModalOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setModalOpen(false)}
            accessibilityLabel="Close"
          />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Passenger information</Text>
            <Text style={styles.modalHint}>
              They ride under your booking — the bangkero checks IDs for discounts on board.
            </Text>

            <TextField
              label="First name"
              value={draftFirst}
              onChangeText={setDraftFirst}
              placeholder="Juan"
              autoCapitalize="words"
            />
            <TextField
              label="Last name"
              value={draftLast}
              onChangeText={setDraftLast}
              placeholder="Dela Cruz"
              autoCapitalize="words"
            />
            <View style={styles.modalRow}>
              <View style={styles.modalHalf}>
                <TextField
                  label="Age"
                  value={draftAge}
                  onChangeText={setDraftAge}
                  placeholder="Optional"
                  keyboardType="number-pad"
                  maxLength={3}
                />
              </View>
              <View style={styles.modalHalf}>
                <TextField
                  label="Contact"
                  value={draftContact}
                  onChangeText={setDraftContact}
                  placeholder="Optional"
                  keyboardType="phone-pad"
                />
              </View>
            </View>

            <Text style={styles.modalFieldLabel}>SEX</Text>
            <View style={styles.sexRow}>
              {(['female', 'male'] as const).map((s) => {
                const active = draftSex === s;
                return (
                  <Pressable
                    key={s}
                    onPress={() => setDraftSex(s)}
                    style={({ pressed }) => [styles.sexChip, active && styles.sexChipActive, pressed && !active && styles.pressed]}
                  >
                    <Text style={[styles.sexChipText, active && styles.sexChipTextActive]}>
                      {s === 'female' ? 'Female' : 'Male'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.modalActions}>
              <View style={styles.modalActionBtn}>
                <PrimaryButton
                  label="Cancel"
                  variant="secondary"
                  onPress={() => setModalOpen(false)}
                />
              </View>
              <View style={styles.modalActionBtn}>
                <PrimaryButton
                  label="Add passenger"
                  onPress={addCompanion}
                  disabled={!draftFirst.trim() || !draftLast.trim()}
                />
              </View>
            </View>
          </View>
        </View>
      </Modal>

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

  // ---------- passengers ----------
  paxCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1, borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.lg,
  },
  paxRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: spacing.md,
  },
  paxRowDivided: { borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  paxAvatar: {
    width: 36, height: 36, borderRadius: radii.pill,
    backgroundColor: colors.primaryTint,
    alignItems: 'center', justifyContent: 'center',
  },
  paxAvatarAlt: { backgroundColor: colors.surfaceAlt },
  paxAvatarText: { ...typography.caption, color: colors.primary, fontWeight: '700', fontSize: 12 },
  paxAvatarTextAlt: { color: colors.textSecondary },
  paxInfo: { flex: 1, minWidth: 0 },
  paxName: { flexShrink: 1, ...typography.bodyStrong },
  paxMeta: { flexShrink: 1, ...typography.caption, color: colors.textMuted, fontSize: 11, marginTop: 2 },
  paxRemove: { flexShrink: 1, color: colors.danger, fontSize: 15, fontWeight: '700', paddingHorizontal: spacing.xs },
  paxAdd: {
    minHeight: touchTarget, alignItems: 'center', justifyContent: 'center',
    borderTopWidth: 1, borderTopColor: colors.borderSubtle,
    borderStyle: 'dashed',
  },
  paxAddOff: { opacity: 0.4 },
  paxAddText: { color: colors.primary, fontSize: 14, fontWeight: '600' },
  paxAddTextOff: { color: colors.textMuted },
  paxHint: { ...typography.caption, color: colors.textMuted, fontSize: 11, marginTop: spacing.sm },

  // ---------- companion modal ----------
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
  modalRow: { flexDirection: 'row', gap: spacing.md },
  modalHalf: { flex: 1 },
  modalFieldLabel: { ...typography.label, marginBottom: spacing.sm },
  sexRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xl },
  sexChip: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.borderSubtle,
    minHeight: 36, justifyContent: 'center',
  },
  sexChipActive: { backgroundColor: colors.primaryTint, borderColor: colors.primary },
  sexChipText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  sexChipTextActive: { color: colors.primary },
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
