import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ScrollView, StyleSheet, Text, View,
} from 'react-native';

import { BangkeroScreenHeader } from '@/components/BangkeroScreenHeader';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ProgressBar } from '@/components/ProgressBar';
import { ScreenContainer } from '@/components/ScreenContainer';
import { useAuth } from '@/hooks/useAuth';
import { useTripManifest } from '@/hooks/useTripManifest';
import { useWeatherData } from '@/hooks/useWeatherData';
import { friendlyError } from '@/services/booking.service';
import { createManifest } from '@/services/manifest.service';
import { createNotification } from '@/services/notification.service';
import { supabase } from '@/services/supabase';
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
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [routeContext, setRouteContext] = useState<{ from: string; to: string } | null>(null);
  const [hasBangka, setHasBangka] = useState<boolean | null>(null);

  const allChecked = CHECKLIST_ITEMS.every((item) => checked[item.key]);
  const manifestFinalized = manifest?.status === 'finalized';

  useEffect(() => {
    if (!bangkeroId) return;
    let cancelled = false;
    (async () => {
      try {
        const [bangkaRes, bookingRes] = await Promise.all([
          supabase.from('bangkas').select('id').eq('bangkero_id', bangkeroId).maybeSingle(),
          supabase
            .from('bookings')
            .select('route_id')
            .eq('operator_id', bangkeroId)
            .eq('trip_stat', 'accepted')
            .order('accepted_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);
        if (cancelled) return;
        setHasBangka(!!bangkaRes.data);
        if (bookingRes.data?.route_id) {
          const [from, to] = bookingRes.data.route_id.split('__');
          if (from && to) setRouteContext({ from, to });
        }
      } catch {
        if (!cancelled) setHasBangka(false);
      }
    })();
    return () => { cancelled = true; };
  }, [bangkeroId]);

  function toggleCheck(key: string) {
    setChecked((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function handleGenerate() {
    if (!bangkeroId || generating) return;
    setGenerating(true);
    setGenError(null);
    try {
      const { data: bangka } = await supabase
        .from('bangkas')
        .select('id')
        .eq('bangkero_id', bangkeroId)
        .maybeSingle();
      if (!bangka) throw new Error('Set up your boat in Profile first.');
      if (!routeContext) {
        throw new Error('No active accepted trip found for this route.');
      }
      await createManifest({
        bangkaId: bangka.id,
        bangkeroId,
        departurePortId: routeContext.from,
        arrivalPortId: routeContext.to,
      });
    } catch (e) {
      setGenError(friendlyError(e));
    }
    setGenerating(false);
  }

  async function handleFinalize() {
    setFinalizing(true);
    await finalizeManifest();
    setFinalizing(false);
  }

  function handleDepart() {
    setDeparting(true);
    if (bangkeroId) {
      supabase
        .from('bookings')
        .select('id, ref, user_id')
        .eq('operator_id', bangkeroId)
        .eq('trip_stat', 'accepted')
        .then(({ data }) => {
          (data ?? []).forEach((b) => {
            if (b.user_id) {
              createNotification(
                b.user_id,
                'Trip Departed',
                `Boat for trip ${b.ref} has departed.`
              ).catch(() => {});
            }
          });
        });
    }
    setTimeout(() => {
      router.push('/(bangkero)/arrived');
    }, 1000);
  }

  const steps = ['Manifest', 'Checklist', 'Weather', 'Ready'];
  const currentStep = manifestFinalized ? (allChecked ? 3 : 2) : 0;

  return (
    <ScreenContainer padded={false}>
      <BangkeroScreenHeader title="Departure" subtitle="MANIFEST & CHECKLIST" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

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
                <Text style={styles.tripValue} numberOfLines={1}>{passengers.length} ({manifest.totalPassengersOnBoard} pax)</Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.tripRow}>
                <Text style={styles.tripLabel}>Parcels</Text>
                <Text style={styles.tripValue} numberOfLines={1}>{parcels.length} ({manifest.totalParcelsOnBoard} items)</Text>
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

            {manifestFinalized && (
              <PrimaryButton
                label="View Passenger List"
                variant="secondary"
                onPress={() => router.push('/(bangkero)/passenger-list')}
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
        ) : (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTitle}>No manifest yet</Text>
            <Text style={styles.emptyText}>
              Generate a manifest for your accepted trip before departure.
            </Text>
            {!!genError && (
              <View style={styles.banner}>
                <Text style={styles.bannerText}>{genError}</Text>
              </View>
            )}
            <PrimaryButton
              label="Generate Manifest"
              onPress={handleGenerate}
              loading={generating}
              disabled={generating || hasBangka === false || !routeContext}
            />
            {hasBangka === false && (
              <Text style={styles.emptyHint}>Set up your boat in Profile first.</Text>
            )}
            {!routeContext && hasBangka !== false && (
              <Text style={styles.emptyHint}>Accept a booking trip to load its route.</Text>
            )}
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
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

  emptyBox: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: spacing.xs },
  emptyText: { color: colors.textMuted, fontSize: 13, textAlign: 'center', marginBottom: spacing.lg },
  emptyHint: { color: colors.textMuted, fontSize: 12, marginTop: spacing.md, textAlign: 'center' },

  banner: {
    backgroundColor: colors.dangerTint,
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    width: '100%',
  },
  bannerText: { flexShrink: 1, color: colors.danger, fontSize: 13, lineHeight: 18 },

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
  tripValue: { flexShrink: 1, color: colors.text, fontSize: 14, fontWeight: '600' },
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
  weatherIcon: { flexShrink: 1, fontSize: 28 },
  weatherLabel: { flexShrink: 1, color: colors.text, fontSize: 15, fontWeight: '700' },
  weatherStatus: { flexShrink: 1, fontSize: 12, marginTop: 2 },
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
  checkIcon: { flexShrink: 1, fontSize: 14 },

  footer: { marginTop: spacing.xxl },
});
