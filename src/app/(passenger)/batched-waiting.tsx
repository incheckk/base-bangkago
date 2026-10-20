import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { ScreenContainer } from '@/components/ScreenContainer';
import { PassengerScreenHeader } from '@/components/PassengerScreenHeader';
import { ErrorState, LoadingState } from '@/components/States';
import { useRealtimeQuery } from '@/hooks/useRealtimeQuery';
import {
  BATCH_THRESHOLD,
  bumpBatchCycle,
  releaseAbandonedBatch,
} from '@/services/parcel-batching.service';
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
  // Guards the one-shot deadline resolve against re-entry from the poll,
  // the realtime subscription and the 1s tick firing load() together.
  const resolveTriggeredRef = useRef(false);

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
        const { data: partnerCount } = await supabase.rpc('get_batch_partner_count', {
          p_route_key: data.batching_route_key,
          p_exclude_parcel_id: parcelId,
        });
        // Once resolved, the queue is empty (everyone is 'batched'), so the
        // live count would read 0 — use the snapshot written at sail.
        const snapshot =
          typeof data.batched_count_at_sail === 'number'
            ? Math.max(0, data.batched_count_at_sail - 1)
            : null;
        setPartners(
          data.batching_status === 'batched' && snapshot !== null
            ? snapshot
            : (partnerCount ?? 0),
        );

        // Deadline check: resolve the batch once the window has closed.
        // resolve_batch_rpc is idempotent server-side; the ref stops the
        // poll/realtime/tick from firing it several times at once.
        if (
          data.batching_status === 'pending_batch' &&
          data.batching_deadline_at &&
          Date.now() >= new Date(data.batching_deadline_at).getTime() &&
          !resolveTriggeredRef.current
        ) {
          resolveTriggeredRef.current = true;
          const { error: resolveError } = await supabase.rpc('resolve_batch_rpc', {
            p_route_key: data.batching_route_key,
            p_min_count: BATCH_THRESHOLD,
          });
          if (resolveError) {
            if (__DEV__) console.warn('[parcel] resolve_batch_rpc:', resolveError.message);
            // Allow a retry on the next load.
            resolveTriggeredRef.current = false;
          } else {
            setParcel((prev: any) =>
              prev
                ? {
                    ...prev,
                    batching_status: 'batched',
                    batched_count_at_sail: (partnerCount ?? 0) + 1,
                  }
                : prev,
            );
          }
        }
      }
    }
    setLoading(false);
  }, [parcelId]);

  useEffect(() => { void load(); }, [load]);
  // Polling fallback: RLS also filters Realtime events for other senders'
  // parcels, so the count would otherwise only refresh on focus/foreground.
  useEffect(() => {
    const id = setInterval(() => { void load(); }, 15_000);
    return () => clearInterval(id);
  }, [load]);
  useRealtimeQuery(load, parcelId ? [{ table: 'parcels' }] : []);

  if (!parcelId) {
    return (
      <ScreenContainer padded={false}>
        <PassengerScreenHeader title="Batched parcel" showDrawer={false} />
        <View style={styles.body}><ErrorState message="Missing parcel ID" /></View>
      </ScreenContainer>
    );
  }
  if (loading) {
    return (
      <ScreenContainer padded={false}>
        <PassengerScreenHeader title="Batched parcel" showDrawer={false} />
        <View style={styles.body}><LoadingState /></View>
      </ScreenContainer>
    );
  }
  if (!parcel) {
    return (
      <ScreenContainer padded={false}>
        <PassengerScreenHeader title="Batched parcel" showDrawer={false} />
        <View style={styles.body}><ErrorState message="Parcel not found" /></View>
      </ScreenContainer>
    );
  }

  const deadline = parcel.batching_deadline_at ? new Date(parcel.batching_deadline_at).getTime() : null;
  const secondsLeft = deadline ? Math.max(0, Math.floor((deadline - now) / 1000)) : 0;
  const isBatched = parcel.batching_status === 'batched';

  return (
    <ScreenContainer padded={false}>
      <PassengerScreenHeader title="Batched parcel" showDrawer={false} />
      <View style={styles.body}>
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
                  // Immediately sail: flip status to solo with surcharge.
                  // Restore the self-stub carrier so a batch link from an
                  // earlier resolve cannot keep this parcel attached.
                  await supabase
                    .from('parcels')
                    .update({
                      batching_status: 'solo',
                      solo_surcharge: PARCEL_RATES.soloSurcharge,
                      carrier_booking_id: parcel.booking_id ?? null,
                    })
                    .eq('id', parcelId);
                  if (parcel.batching_route_key) {
                    await releaseAbandonedBatch(parcel.batching_route_key);
                  }
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
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, paddingHorizontal: spacing.xl },
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
