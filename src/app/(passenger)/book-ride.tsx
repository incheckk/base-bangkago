import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/components/Icon';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { SeaMap } from '@/components/SeaMap';
import { ErrorState, LoadingState } from '@/components/States';
import { TextField } from '@/components/TextField';
import { usePorts } from '@/hooks/useSupabase';
import { colors, elevation, radii, spacing, touchTarget, typography } from '@/theme/tokens';

type PassengerType = 'regular' | 'senior' | 'student' | 'child';
type ServiceType = 'passenger' | 'cargo';

const PASSENGER_TYPES: { key: PassengerType; label: string; discount: number }[] = [
  { key: 'regular', label: 'Regular', discount: 0 },
  { key: 'senior', label: 'Senior', discount: 20 },
  { key: 'student', label: 'Student', discount: 15 },
  { key: 'child', label: 'Child', discount: 50 },
];

const SERVICE_TYPES: { key: ServiceType; label: string; icon: IconName; hint: string }[] = [
  { key: 'passenger', label: 'Passenger', icon: 'people', hint: 'Standard seat' },
  { key: 'cargo', label: 'Cargo', icon: 'parcel', hint: '1.5× base rate' },
];

const MAX_PASSENGERS = 12;
const BASE_FARE = 85;

export default function BookRide() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ from?: string; fromId?: string }>();
  const ports = usePorts();

  const [fromId, setFromId] = useState<string | null>(params.fromId ?? null);
  const [toId, setToId] = useState<string | null>(null);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [count, setCount] = useState(1);
  const [passengerType, setPassengerType] = useState<PassengerType>('regular');
  const [serviceType, setServiceType] = useState<ServiceType>('passenger');

  useEffect(() => {
    if (params.fromId) setFromId(params.fromId);
  }, [params.fromId]);

  const fromPort = ports.data.find((p) => p.portId === fromId);
  const toPort = ports.data.find((p) => p.portId === toId);
  const typeInfo = PASSENGER_TYPES.find((t) => t.key === passengerType)!;

  const fare = (() => {
    if (!fromPort || !toPort || fromId === toId) return null;
    const base = serviceType === 'cargo' ? BASE_FARE * 1.5 : BASE_FARE;
    const discounted = base * (1 - typeInfo.discount / 100);
    return Math.round(discounted * count);
  })();

  function swap() {
    const tempFrom = fromId;
    setFromId(toId);
    setToId(tempFrom);
  }

  function proceed() {
    if (!fromPort || !toPort || fare === null) return;
    router.push({
      pathname: '/(passenger)/payment',
      params: {
        fromId: fromPort.portId,
        fromName: fromPort.portName,
        toId: toPort.portId,
        toName: toPort.portName,
        date,
        time,
        count: String(count),
        passengerType,
        serviceType,
        fare: String(fare),
      },
    });
  }

  if (ports.loading) {
    return <ScreenContainer><LoadingState label="Loading ports…" /></ScreenContainer>;
  }
  if (ports.error) {
    return <ScreenContainer><ErrorState message={ports.error} /></ScreenContainer>;
  }

  const ready = !!fromId && !!toId && fromId !== toId && fare !== null;

  return (
    <ScreenContainer padded={false}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={({ pressed }) => [styles.backBtn, pressed && styles.backBtnPressed]}
        >
          <Icon name="back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>Book a Ride</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: FOOTER_H + insets.bottom + spacing.xl }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* The route reads as one object, not two unrelated chip grids. The map
            gives the choice a shape — you can see the crossing you just picked. */}
        <View style={styles.routeCard}>
          <View style={styles.mapWrap}>
            <SeaMap ports={ports.data} fromPortId={fromId} toPortId={toId} height={150} />
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
          <PortChips ports={ports.data} selected={toId} disabled={fromId} onSelect={setToId} />

          <Text style={[styles.sectionLabel, styles.mtLg]}>DATE & TIME</Text>
          <View style={styles.row}>
            <View style={styles.halfField}>
              <TextField label="Date" value={date} onChangeText={setDate} placeholder="MM/DD/YYYY" />
            </View>
            <View style={styles.halfField}>
              <TextField label="Time" value={time} onChangeText={setTime} placeholder="HH:MM" />
            </View>
          </View>

          <Text style={styles.sectionLabel}>PASSENGERS</Text>
          <View style={styles.stepperCard}>
            <StepButton icon="close" onPress={() => setCount((c) => Math.max(1, c - 1))} disabled={count <= 1} />
            <View style={styles.stepValueWrap}>
              <Text style={styles.stepValue}>{count}</Text>
              <Text style={styles.stepUnit}>{count === 1 ? 'passenger' : 'passengers'}</Text>
            </View>
            <StepButton icon="check" onPress={() => setCount((c) => Math.min(MAX_PASSENGERS, c + 1))} disabled={count >= MAX_PASSENGERS} />
          </View>

          <Text style={[styles.sectionLabel, styles.mtLg]}>PASSENGER TYPE</Text>
          <View style={styles.typeGrid}>
            {PASSENGER_TYPES.map((t) => {
              const active = passengerType === t.key;
              return (
                <Pressable
                  key={t.key}
                  onPress={() => setPassengerType(t.key)}
                  style={({ pressed }) => [
                    styles.typeChip, active && styles.typeChipActive, pressed && !active && styles.pressed,
                  ]}
                >
                  <Text style={[styles.typeLabel, active && styles.typeLabelActive]}>{t.label}</Text>
                  {t.discount > 0 && (
                    <Text style={[styles.typeDiscount, active && styles.typeDiscountActive]}>
                      −{t.discount}%
                    </Text>
                  )}
                </Pressable>
              );
            })}
          </View>

          <Text style={[styles.sectionLabel, styles.mtLg]}>SERVICE TYPE</Text>
          <View style={styles.serviceRow}>
            {SERVICE_TYPES.map((s) => {
              const active = serviceType === s.key;
              return (
                <Pressable
                  key={s.key}
                  onPress={() => setServiceType(s.key)}
                  style={({ pressed }) => [
                    styles.serviceCard, active && styles.serviceCardActive, pressed && !active && styles.pressed,
                  ]}
                >
                  <Icon name={s.icon} size={22} color={active ? colors.primary : colors.textMuted} />
                  <Text style={[styles.serviceLabel, active && styles.serviceLabelActive]}>{s.label}</Text>
                  <Text style={styles.serviceHint}>{s.hint}</Text>
                </Pressable>
              );
            })}
          </View>
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
                : `${typeInfo.discount > 0 ? `${typeInfo.discount}% ${passengerType} · ` : ''}${count} pax${serviceType === 'cargo' ? ' · Cargo' : ''}`}
            </Text>
          </View>
          <Text style={[styles.fareValue, fare === null && styles.fareValueEmpty]}>
            {fare !== null ? `₱${fare}` : '—'}
          </Text>
        </View>

        <PrimaryButton label="Proceed to Payment" onPress={proceed} disabled={!ready} />
      </View>
    </ScreenContainer>
  );
}

function PortChips({
  ports, selected, disabled, onSelect,
}: {
  ports: { portId: string; portName: string }[];
  selected: string | null;
  disabled: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <View style={styles.chips}>
      {ports.map((p) => {
        const active = p.portId === selected;
        const off = p.portId === disabled;
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

/** `close` and `check` stand in for − and + — Ionicons has no clean plus/minus. */
function StepButton({ icon, onPress, disabled }: { icon: IconName; onPress: () => void; disabled: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [styles.stepBtn, disabled && styles.stepBtnOff, pressed && !disabled && styles.pressed]}
    >
      <Text style={[styles.stepBtnText, disabled && styles.stepBtnTextOff]}>
        {icon === 'close' ? '−' : '+'}
      </Text>
    </Pressable>
  );
}

const FOOTER_H = 132;

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
  },
  backBtn: {
    width: touchTarget, height: touchTarget,
    alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill,
  },
  backBtnPressed: { backgroundColor: colors.surface },
  title: { ...typography.h2 },

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
  legValue: { ...typography.bodyStrong },
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

  row: { flexDirection: 'row', gap: spacing.md },
  halfField: { flex: 1 },

  // ---------- stepper ----------
  stepperCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1, borderColor: colors.borderSubtle,
    padding: spacing.sm,
  },
  stepBtn: {
    width: touchTarget, height: touchTarget, borderRadius: radii.md,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center', justifyContent: 'center',
  },
  stepBtnOff: { opacity: 0.35 },
  stepBtnText: { ...typography.h2, color: colors.primary, lineHeight: 26 },
  stepBtnTextOff: { color: colors.textMuted },
  stepValueWrap: { alignItems: 'center' },
  stepValue: { ...typography.h2 },
  stepUnit: { ...typography.caption, color: colors.textMuted, fontSize: 11 },

  // ---------- passenger type ----------
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  typeChip: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.borderSubtle,
    minHeight: 36,
  },
  typeChipActive: { backgroundColor: colors.primaryTint, borderColor: colors.primary },
  typeLabel: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  typeLabelActive: { color: colors.primary },
  typeDiscount: { ...typography.label, color: colors.success, letterSpacing: 0 },
  typeDiscountActive: { color: colors.success },

  // ---------- service type ----------
  serviceRow: { flexDirection: 'row', gap: spacing.md },
  serviceCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1, borderColor: colors.borderSubtle,
    paddingVertical: spacing.lg, paddingHorizontal: spacing.sm,
    alignItems: 'center', gap: spacing.xs,
  },
  serviceCardActive: { backgroundColor: colors.primaryTint, borderColor: colors.primary },
  serviceLabel: { ...typography.bodyStrong, color: colors.textSecondary },
  serviceLabelActive: { color: colors.primary },
  serviceHint: { ...typography.caption, color: colors.textMuted, fontSize: 11 },

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
  fareLabel: { ...typography.label },
  fareNote: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xxs },
  fareValue: { ...typography.display, fontSize: 26, color: colors.primary },
  fareValueEmpty: { color: colors.textMuted },
});
