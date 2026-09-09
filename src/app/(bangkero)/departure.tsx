import { router } from 'expo-router';
import { useState } from 'react';
import {
  ScrollView, StyleSheet, Text, View,
} from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { ProgressBar } from '@/components/ProgressBar';
import { ScreenContainer } from '@/components/ScreenContainer';
import { useAuth } from '@/hooks/useAuth';
import { useTripManifest } from '@/hooks/useTripManifest';
import { useWeatherData } from '@/hooks/useWeatherData';
import { colors, radii, spacing, typography } from '@/theme/tokens';

const CHECKLIST_ITEMS = [
  { key: 'lifeJackets', label: 'Life jackets accounted for', icon: '🦺' },
  { key: 'firstAid', label: 'First aid kit present', icon: '🩹' },
  { key: 'fuel', label: 'Fuel level sufficient', icon: '⛽' },
  { key: 'radio', label: 'Radio / communication device', icon: '📻' },
  { key: 'manifest', label: 'Passenger manifest verified', icon: '📋' },
];

export default function DepartureScreen() {
  const { user } = useAuth();
  const bangkeroId = user?.id ?? null;
  const { manifest, passengers, parcels, loading, finalizeManifest } = useTripManifest(bangkeroId);
  const { data: weather, loading: weatherLoading } = useWeatherData('p1');

  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [finalizing, setFinalizing] = useState(false);
  const [departing, setDeparting] = useState(false);

  const allChecked = CHECKLIST_ITEMS.every((item) => checked[item.key]);
  const manifestFinalized = manifest?.status === 'finalized';

  function toggleCheck(key: string) {
    setChecked((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function handleFinalize() {
    setFinalizing(true);
    await finalizeManifest();
    setFinalizing(false);
  }

  function handleDepart() {
    setDeparting(true);
    setTimeout(() => {
      router.push('/(bangkero)/arrived');
    }, 1000);
  }

  const steps = ['Manifest', 'Checklist', 'Weather', 'Ready'];
  const currentStep = manifestFinalized ? (allChecked ? 3 : 2) : 0;

  return (
    <ScreenContainer padded={false}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.back} onPress={() => router.back()}>← Back</Text>

        <Text style={styles.eyebrow}>DEPARTURE</Text>
        <Text style={styles.title}>Prepare to Depart</Text>

        <ProgressBar steps={steps} current={currentStep} />

        {loading ? (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderText}>Loading manifest…</Text>
          </View>
        ) : manifest ? (
          <>
            <Text style={styles.sectionLabel}>TRIP INFO</Text>
            <View style={styles.tripCard}>
              <View style={styles.tripRow}>
                <Text style={styles.tripLabel}>Reference</Text>
                <Text style={styles.tripValue}>{manifest.manifestId}</Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.tripRow}>
                <Text style={styles.tripLabel}>Passengers</Text>
                <Text style={styles.tripValue}>{passengers.length} ({manifest.totalPassengersOnBoard} pax)</Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.tripRow}>
                <Text style={styles.tripLabel}>Parcels</Text>
                <Text style={styles.tripValue}>{parcels.length} ({manifest.totalParcelsOnBoard} items)</Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.tripRow}>
                <Text style={styles.tripLabel}>Manifest Status</Text>
                <Text style={[styles.tripValue, manifestFinalized && styles.tripValueOk]}>
                  {manifestFinalized ? 'Finalized' : 'Draft'}
                </Text>
              </View>
            </View>

            {!manifestFinalized && (
              <PrimaryButton
                label="Finalize Manifest"
                onPress={handleFinalize}
                loading={finalizing}
                disabled={finalizing}
                style={styles.mt}
              />
            )}

            <Text style={styles.sectionLabel}>WEATHER CHECK</Text>
            <View style={styles.weatherCard}>
              {weatherLoading ? (
                <Text style={styles.weatherText}>Checking conditions…</Text>
              ) : weather ? (
                <View style={styles.weatherRow}>
                  <Text style={styles.weatherIcon}>{weather.isSafe ? '☀️' : '⛈️'}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.weatherLabel}>
                      {weather.weatherCondition ?? 'Unknown'}
                    </Text>
                    <Text style={[styles.weatherStatus, weather.isSafe ? styles.weatherSafe : styles.weatherUnsafe]}>
                      {weather.isSafe ? 'Conditions are safe for departure' : 'Unsafe conditions — consider delaying'}
                    </Text>
                  </View>
                </View>
              ) : (
                <Text style={styles.weatherText}>Weather data unavailable</Text>
              )}
            </View>

            <Text style={styles.sectionLabel}>SAFETY CHECKLIST</Text>
            <View style={styles.checklist}>
              {CHECKLIST_ITEMS.map((item) => {
                const isChecked = !!checked[item.key];
                return (
                  <Text
                    key={item.key}
                    onPress={() => toggleCheck(item.key)}
                    style={[styles.checkItem, isChecked && styles.checkItemDone]}
                  >
                    <Text style={styles.checkIcon}>{isChecked ? '✅' : item.icon}</Text>
                    {' '}{item.label}
                  </Text>
                );
              })}
            </View>

            <View style={styles.footer}>
              <PrimaryButton
                label="Ready to Depart"
                onPress={handleDepart}
                loading={departing}
                disabled={!manifestFinalized || !allChecked || departing}
              />
            </View>
          </>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  back: { color: colors.primary, fontSize: 14, fontWeight: '600', marginBottom: spacing.lg },
  eyebrow: { ...typography.label, marginBottom: 2 },
  title: { ...typography.h1, marginBottom: spacing.xl },
  mt: { marginTop: spacing.lg },

  placeholder: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.xl,
    alignItems: 'center',
  },
  placeholderText: { color: colors.textMuted, fontSize: 14 },

  sectionLabel: { ...typography.label, marginTop: spacing.xxl, marginBottom: spacing.md },

  tripCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
  },
  tripRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  tripLabel: { color: colors.textSecondary, fontSize: 14 },
  tripValue: { color: colors.text, fontSize: 14, fontWeight: '600' },
  tripValueOk: { color: colors.primary },
  divider: { height: 1, backgroundColor: colors.borderSubtle },

  weatherCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
  },
  weatherRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  weatherIcon: { fontSize: 28 },
  weatherLabel: { color: colors.text, fontSize: 15, fontWeight: '700' },
  weatherStatus: { fontSize: 12, marginTop: 2 },
  weatherSafe: { color: colors.primary },
  weatherUnsafe: { color: colors.danger },
  weatherText: { color: colors.textMuted, fontSize: 14 },

  checklist: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
  },
  checkItem: {
    color: colors.textSecondary,
    fontSize: 14,
    paddingVertical: spacing.sm,
    lineHeight: 22,
  },
  checkItemDone: {
    color: colors.primary,
  },
  checkIcon: { fontSize: 14 },

  footer: { marginTop: spacing.xxl },
});
