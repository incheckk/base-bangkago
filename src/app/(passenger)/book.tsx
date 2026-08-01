import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { SeaMap } from '@/components/SeaMap';
import { ErrorState, LoadingState } from '@/components/States';
import { useAuth } from '@/hooks/useAuth';
import { usePiers } from '@/hooks/useFirestore';
import { createBooking, fetchRoute, friendlyError } from '@/services/booking.service';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import type { RouteDoc } from '@/types/models';

const MAX_PASSENGERS = 12;

export default function BookTrip() {
  const { profile } = useAuth();
  const piers = usePiers();

  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(null);
  const [count, setCount] = useState(1);

  const [route, setRoute] = useState<RouteDoc | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Fare is looked up the moment both piers are chosen, so the passenger never
  // reaches a summary screen and then learns the price.
  useEffect(() => {
    if (!fromId || !toId || fromId === toId) { setRoute(null); setRouteError(null); return; }

    let cancelled = false;
    setRouteLoading(true);
    setRouteError(null);

    fetchRoute(fromId, toId)
      .then((r) => {
        if (cancelled) return;
        if (!r) setRouteError('No route runs between those two piers.');
        else if (!r.isActive) setRouteError('That route is not running right now.');
        setRoute(r && r.isActive ? r : null);
      })
      .catch((e) => { if (!cancelled) setRouteError(friendlyError(e)); })
      .finally(() => { if (!cancelled) setRouteLoading(false); });

    return () => { cancelled = true; };
  }, [fromId, toId]);

  function swap() {
    setFromId(toId);
    setToId(fromId);
  }

  async function confirm() {
    const fromPier = piers.data.find((p) => p.pierId === fromId);
    const toPier = piers.data.find((p) => p.pierId === toId);
    if (!profile || !fromPier || !toPier) return;

    setBusy(true);
    setFormError(null);
    try {
      const id = await createBooking({ passenger: profile, fromPier, toPier, passengerCount: count });
      router.replace(`/(passenger)/booking/${id}`);
    } catch (e) {
      setFormError(friendlyError(e));
      setBusy(false);
    }
  }

  if (piers.loading) {
    return <ScreenContainer><LoadingState label="Loading piers…" /></ScreenContainer>;
  }
  if (piers.error) {
    return <ScreenContainer><ErrorState message={piers.error} /></ScreenContainer>;
  }

  const ready = !!route && !!fromId && !!toId && fromId !== toId;

  return (
    <ScreenContainer padded={false}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Text style={styles.back}>← Back</Text>
          </Pressable>
          <Text style={styles.title}>Book a boat ride</Text>
        </View>

        <View style={styles.mapWrap}>
          <SeaMap piers={piers.data} fromPierId={fromId} toPierId={toId} height={190} />
        </View>

        <View style={styles.body}>
          <View style={styles.pickRow}>
            <Text style={styles.sectionLabel}>PICKUP</Text>
            {!!fromId && !!toId && (
              <Pressable onPress={swap} hitSlop={8}>
                <Text style={styles.swap}>⇅ Swap</Text>
              </Pressable>
            )}
          </View>
          <PierChips piers={piers.data} selected={fromId} disabled={toId} onSelect={setFromId} />

          <Text style={[styles.sectionLabel, styles.spaced]}>DESTINATION</Text>
          <PierChips piers={piers.data} selected={toId} disabled={fromId} onSelect={setToId} />

          <Text style={[styles.sectionLabel, styles.spaced]}>PASSENGERS</Text>
          <View style={styles.stepper}>
            <StepButton label="−" onPress={() => setCount((c) => Math.max(1, c - 1))} disabled={count <= 1} />
            <Text style={styles.stepValue}>{count}</Text>
            <StepButton
              label="+"
              onPress={() => setCount((c) => Math.min(MAX_PASSENGERS, c + 1))}
              disabled={count >= MAX_PASSENGERS}
            />
          </View>

          <View style={styles.summary}>
            {routeLoading ? (
              <Text style={styles.summaryMuted}>Checking fare…</Text>
            ) : routeError ? (
              <Text style={styles.summaryError}>{routeError}</Text>
            ) : route ? (
              <>
                <SummaryRow label="Fare per trip" value={`₱${route.fare}`} strong />
                <SummaryRow label="Estimated time" value={`${route.estimatedMinutes} min`} />
                <SummaryRow label="Passengers" value={String(count)} />
                <SummaryRow label="Payment" value="Cash on board" />
              </>
            ) : (
              <Text style={styles.summaryMuted}>Choose a pickup and destination to see the fare.</Text>
            )}
          </View>

          {!!formError && (
            <View style={styles.banner}>
              <Text style={styles.bannerText}>{formError}</Text>
            </View>
          )}

          <PrimaryButton
            label={route ? `Request boat · ₱${route.fare}` : 'Request boat'}
            onPress={confirm}
            loading={busy}
            disabled={!ready}
          />
          <Text style={styles.note}>
            Your request goes to every available bangkero. The first to accept takes the trip.
          </Text>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

function PierChips({
  piers, selected, disabled, onSelect,
}: {
  piers: { pierId: string; name: string; island: string }[];
  selected: string | null;
  disabled: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <View style={styles.chips}>
      {piers.map((p) => {
        const active = p.pierId === selected;
        const off = p.pierId === disabled;
        return (
          <Pressable
            key={p.pierId}
            onPress={() => onSelect(p.pierId)}
            disabled={off}
            style={({ pressed }) => [
              styles.chip,
              active && styles.chipActive,
              off && styles.chipOff,
              pressed && !active && !off && styles.chipPressed,
            ]}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive, off && styles.chipTextOff]}>
              {p.name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function StepButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.stepBtn, disabled && styles.stepBtnOff, pressed && !disabled && styles.chipPressed]}
    >
      <Text style={[styles.stepBtnText, disabled && styles.chipTextOff]}>{label}</Text>
    </Pressable>
  );
}

function SummaryRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.sumRow}>
      <Text style={styles.sumLabel}>{label}</Text>
      <Text style={[styles.sumValue, strong && styles.sumValueStrong]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: spacing.xxl },
  header: { paddingHorizontal: spacing.xl, paddingBottom: spacing.lg },
  back: { color: colors.primary, fontSize: 14, fontWeight: '600', marginBottom: spacing.md },
  title: { ...typography.h2 },
  mapWrap: { paddingHorizontal: spacing.xl },
  body: { paddingHorizontal: spacing.xl, paddingTop: spacing.xl },

  pickRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionLabel: { ...typography.label, marginBottom: spacing.md },
  spaced: { marginTop: spacing.xl },
  swap: { color: colors.primary, fontSize: 12, fontWeight: '700', marginBottom: spacing.md },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  chipActive: { backgroundColor: colors.surfaceAlt, borderColor: colors.primary },
  chipOff: { opacity: 0.35 },
  chipPressed: { opacity: 0.75 },
  chipText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: colors.primary },
  chipTextOff: { color: colors.textMuted },

  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  stepBtn: {
    width: 44, height: 44, borderRadius: radii.md,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSubtle,
    alignItems: 'center', justifyContent: 'center',
  },
  stepBtnOff: { opacity: 0.4 },
  stepBtnText: { color: colors.text, fontSize: 20, fontWeight: '700' },
  stepValue: { ...typography.h2, minWidth: 32, textAlign: 'center' },

  summary: {
    marginTop: spacing.xl,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  summaryMuted: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
  summaryError: { color: colors.warning, fontSize: 13, textAlign: 'center' },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
  sumLabel: { ...typography.caption },
  sumValue: { color: colors.text, fontSize: 13, fontWeight: '600' },
  sumValueStrong: { color: colors.primary, fontSize: 16, fontWeight: '700' },

  banner: {
    backgroundColor: 'rgba(224,82,82,0.12)',
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  bannerText: { color: colors.danger, fontSize: 13, lineHeight: 18 },
  note: { ...typography.caption, color: colors.textMuted, textAlign: 'center', marginTop: spacing.md },
});
