import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { ScreenContainer } from '@/components/ScreenContainer';
import { ErrorState, LoadingState } from '@/components/States';
import { useRealtimeQuery } from '@/hooks/useRealtimeQuery';
import { bumpBatchCycle } from '@/services/parcel-batching.service';
import { PARCEL_RATES } from '@/services/parcel-pricing.service';
import { supabase } from '@/services/supabase';
import { colors, radii, spacing } from '@/theme/tokens';

export default function BatchedWaiting() {
  const params = useLocalSearchParams<{ parcelId?: string }>();
  const parcelId = params.parcelId ?? null;

  const [parcel, setParcel] = useState<any>(null);
  const [partners, setPartners] = useState(0);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());

  // Tick every second for countdown
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    if (!parcelId) return;
    const { data } = await supabase.from('parcels').select('*').eq('id', parcelId).maybeSingle();
    if (data) {
      setParcel(data);
      if (data.batching_route_key) {
        const { count } = await supabase
          .from('parcels')
          .select('id', { count: 'exact', head: true })
          .eq('batching_route_key', data.batching_route_key)
          .eq('batching_status', 'pending_batch');
        setPartners(Math.max(0, (count ?? 1) - 1)); // exclude self
      }
    }
    setLoading(false);
  }, [parcelId]);

  useEffect(() => { void load(); }, [load]);
  useRealtimeQuery(load, parcelId ? [{ table: 'parcels' }] : []);

  if (!parcelId) return <ErrorState message="Missing parcel ID" />;
  if (loading) return <LoadingState />;
  if (!parcel) return <ErrorState message="Parcel not found" />;

  const deadline = parcel.batching_deadline_at ? new Date(parcel.batching_deadline_at).getTime() : null;
  const secondsLeft = deadline ? Math.max(0, Math.floor((deadline - now) / 1000)) : 0;
  const isBatched = parcel.batching_status === 'batched';

  return (
    <ScreenContainer padded>
      <View style={styles.card}>
        <Text style={styles.title}>Waiting for batching</Text>
        <Text style={styles.subtitle}>
          {partners > 0 ? `${partners} other parcel${partners === 1 ? '' : 's'} joined` : 'No other parcels yet'}
        </Text>

        {isBatched ? (
          <Text style={styles.success}>✓ Batched — sailing with {partners + 1} parcels</Text>
        ) : secondsLeft > 0 ? (
          <>
            <Text style={styles.countdown}>
              {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')} left
            </Text>
            {parcel.estimated_arrival_at && (
              <Text style={styles.subtitle}>
                Estimated arrival: {new Date(parcel.estimated_arrival_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Text>
            )}
          </>
        ) : (
          <View>
            <Text style={styles.warning}>No other parcels joined</Text>
              <Pressable
                style={styles.primaryBtn}
                onPress={async () => {
                  if (!parcelId) return;
                  await bumpBatchCycle(parcelId);
                  // Immediately sail: flip status to solo with surcharge
                  await supabase
                    .from('parcels')
                    .update({ batching_status: 'solo', solo_surcharge: PARCEL_RATES.soloSurcharge })
                    .eq('id', parcelId);
                  void load();
                }}
              >
              <Text style={styles.primaryBtnText}>Pay ₱{PARCEL_RATES.soloSurcharge} and sail now (coming soon)</Text>
            </Pressable>
              <Pressable
                style={styles.secondaryBtn}
                onPress={async () => {
                  if (!parcelId) return;
                  await bumpBatchCycle(parcelId);
                  void load();
                }}
              >
              <Text style={styles.secondaryBtnText}>Wait another hour</Text>
            </Pressable>
          </View>
        )}
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, padding: spacing.lg, borderRadius: radii.md, marginTop: spacing.lg },
  title: { color: colors.text, fontSize: 18, fontWeight: '600' },
  subtitle: { color: colors.textMuted, marginTop: 6 },
  countdown: { color: colors.primary, fontSize: 32, fontWeight: '700', marginTop: 12, textAlign: 'center' },
  success: { color: colors.primary, fontSize: 16, marginTop: 12, textAlign: 'center' },
  warning: { color: colors.danger, fontSize: 14, marginTop: 12 },
  primaryBtn: { backgroundColor: colors.primary, paddingVertical: 12, borderRadius: radii.pill, alignItems: 'center', marginTop: 12 },
  primaryBtnText: { color: colors.bg, fontWeight: '600' },
  secondaryBtn: { borderWidth: 1, borderColor: colors.borderSubtle, paddingVertical: 12, borderRadius: radii.pill, alignItems: 'center', marginTop: 8 },
  secondaryBtnText: { color: colors.text },
});
