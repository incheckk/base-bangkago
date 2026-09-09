import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { TextField } from '@/components/TextField';
import { usePorts } from '@/hooks/useSupabase';
import { colors, radii, spacing, typography } from '@/theme/tokens';

type PassengerType = 'regular' | 'senior' | 'student' | 'child';
type ServiceType = 'passenger' | 'cargo';

const PASSENGER_TYPES: { key: PassengerType; label: string; discount: number }[] = [
  { key: 'regular', label: 'Regular', discount: 0 },
  { key: 'senior', label: 'Senior', discount: 20 },
  { key: 'student', label: 'Student', discount: 15 },
  { key: 'child', label: 'Child', discount: 50 },
];

const SERVICE_TYPES: { key: ServiceType; label: string; icon: string }[] = [
  { key: 'passenger', label: 'Passenger', icon: '🧑‍🤝‍🧑' },
  { key: 'cargo', label: 'Cargo', icon: '📦' },
];

const MAX_PASSENGERS = 12;
const BASE_FARE = 85;

export default function BookRide() {
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
    return (
      <ScreenContainer>
        <Text style={styles.loadingText}>Loading ports…</Text>
      </ScreenContainer>
    );
  }

  const ready = !!fromId && !!toId && fromId !== toId && fare !== null;

  return (
    <ScreenContainer padded={false}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Text style={styles.back}>← Back</Text>
          </Pressable>
          <Text style={styles.title}>Book a Ride</Text>
        </View>

        <View style={styles.body}>
          <Text style={styles.sectionLabel}>FROM</Text>
          <PortChips ports={ports.data} selected={fromId} disabled={toId} onSelect={setFromId} />

          <View style={styles.swapRow}>
            <Pressable onPress={swap} disabled={!fromId && !toId} style={styles.swapBtn}>
              <Text style={styles.swapIcon}>⇅</Text>
            </Pressable>
          </View>

          <Text style={styles.sectionLabel}>TO</Text>
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

          <Text style={[styles.sectionLabel, styles.mtLg]}>PASSENGERS</Text>
          <View style={styles.stepper}>
            <StepButton label="−" onPress={() => setCount((c) => Math.max(1, c - 1))} disabled={count <= 1} />
            <Text style={styles.stepValue}>{count}</Text>
            <StepButton label="+" onPress={() => setCount((c) => Math.min(MAX_PASSENGERS, c + 1))} disabled={count >= MAX_PASSENGERS} />
          </View>

          <Text style={[styles.sectionLabel, styles.mtLg]}>PASSENGER TYPE</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {PASSENGER_TYPES.map((t) => (
              <Pressable
                key={t.key}
                onPress={() => setPassengerType(t.key)}
                style={[styles.chip, passengerType === t.key && styles.chipActive]}
              >
                <Text style={[styles.chipLabel, passengerType === t.key && styles.chipLabelActive]}>
                  {t.label}{t.discount > 0 ? ` (${t.discount}% off)` : ''}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          <Text style={[styles.sectionLabel, styles.mtLg]}>SERVICE TYPE</Text>
          <View style={styles.serviceRow}>
            {SERVICE_TYPES.map((s) => (
              <Pressable
                key={s.key}
                onPress={() => setServiceType(s.key)}
                style={[styles.serviceCard, serviceType === s.key && styles.serviceCardActive]}
              >
                <Text style={styles.serviceIcon}>{s.icon}</Text>
                <Text style={[styles.serviceLabel, serviceType === s.key && styles.serviceLabelActive]}>
                  {s.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.fareCard}>
            {fare !== null ? (
              <>
                <View style={styles.fareRow}>
                  <Text style={styles.fareLabel}>Fare estimate</Text>
                  <Text style={styles.fareValue}>₱{fare}</Text>
                </View>
                <Text style={styles.fareNote}>
                  {typeInfo.discount > 0
                    ? `${typeInfo.discount}% ${passengerType} discount applied`
                    : 'Standard fare'}
                  {serviceType === 'cargo' ? ' · Cargo rate' : ''}
                </Text>
              </>
            ) : (
              <Text style={styles.fareEmpty}>Select ports to see fare estimate</Text>
            )}
          </View>

          <PrimaryButton
            label={fare !== null ? `Proceed to Payment · ₱${fare}` : 'Proceed to Payment'}
            onPress={proceed}
            disabled={!ready}
          />
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

function PortChips({
  ports,
  selected,
  disabled,
  onSelect,
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
              pressed && !active && !off && styles.chipPressed,
            ]}
          >
            <Text style={[styles.portChipText, active && styles.portChipTextActive, off && styles.portChipTextOff]}>
              {p.portName}
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

const styles = StyleSheet.create({
  scroll: { paddingBottom: spacing.xxl },
  header: { paddingHorizontal: spacing.xl, paddingBottom: spacing.lg },
  back: { color: colors.primary, fontSize: 14, fontWeight: '600', marginBottom: spacing.md },
  title: { ...typography.h2 },
  body: { paddingHorizontal: spacing.xl },

  sectionLabel: { ...typography.label, marginBottom: spacing.md },
  mtLg: { marginTop: spacing.xl },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  portChip: {
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  portChipActive: { backgroundColor: colors.surfaceAlt, borderColor: colors.primary },
  portChipOff: { opacity: 0.35 },
  chipPressed: { opacity: 0.75 },
  portChipText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  portChipTextActive: { color: colors.primary },
  portChipTextOff: { color: colors.textMuted },

  swapRow: { alignItems: 'center', marginVertical: spacing.sm },
  swapBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swapIcon: { color: colors.primary, fontSize: 18, fontWeight: '700' },

  row: { flexDirection: 'row', gap: spacing.md },
  halfField: { flex: 1 },

  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  stepBtn: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnOff: { opacity: 0.4 },
  stepBtnText: { color: colors.text, fontSize: 20, fontWeight: '700' },
  stepValue: { ...typography.h2, minWidth: 32, textAlign: 'center' },

  chipRow: { gap: spacing.sm, paddingVertical: spacing.sm },
  chip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  chipLabelActive: { color: colors.primaryText },

  serviceRow: { flexDirection: 'row', gap: spacing.md },
  serviceCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
  },
  serviceCardActive: { backgroundColor: colors.surfaceAlt, borderColor: colors.primary },
  serviceIcon: { fontSize: 24 },
  serviceLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  serviceLabelActive: { color: colors.primary },

  fareCard: {
    marginTop: spacing.xl,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  fareRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fareLabel: { ...typography.caption },
  fareValue: { color: colors.primary, fontSize: 20, fontWeight: '700' },
  fareNote: { color: colors.textMuted, fontSize: 12, marginTop: spacing.xs },
  fareEmpty: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },

  loadingText: { color: colors.textMuted, fontSize: 14, textAlign: 'center', marginTop: spacing.xxl },
  chipTextOff: { color: colors.textMuted },
});
