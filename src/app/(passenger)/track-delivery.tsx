import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ScreenContainer } from '@/components/ScreenContainer';
import { PassengerScreenHeader } from '@/components/PassengerScreenHeader';
import { useChannelId } from '@/hooks/useChannelId';
import { supabase } from '@/services/supabase';
import { colors, radii, spacing, typography } from '@/theme/tokens';

const STATUS_STEPS = ['Booked', 'Picked Up', 'In Transit', 'Out for Delivery', 'Delivered'];

function stepForStatus(status?: string): number {
  if (status === 'pending') return 0;
  if (status === 'in_transit') return 2;
  if (status === 'delivered') return 4;
  if (status === 'returned') return 4;
  return 1;
}

export default function TrackDelivery() {
  const params = useLocalSearchParams<{
    parcelId?: string;
    status?: string;
    receiverName?: string;
    toPort?: string;
  }>();
  const [currentStep, setCurrentStep] = useState(stepForStatus(params.status));
  const [liveStatus, setLiveStatus] = useState<string | undefined>(params.status);
  const channelId = useChannelId();

  useEffect(() => {
    setCurrentStep(stepForStatus(liveStatus ?? params.status));
  }, [liveStatus, params.status]);

  useEffect(() => {
    const parcelId = params.parcelId;
    if (!parcelId) return;

    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase.channel(`parcel-${parcelId}-${channelId}`);
      channel
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'parcels', filter: `id=eq.${parcelId}` },
          (payload) => {
            const next = (payload.new as { status?: string }).status;
            if (next) setLiveStatus(next);
          }
        )
        .subscribe();
    } catch {
      // realtime unavailable — the screen keeps working without live updates
    }

    return () => { if (channel) supabase.removeChannel(channel); };
  }, [params.parcelId, channelId]);

  const status = liveStatus ?? params.status;

  return (
    <ScreenContainer padded={false}>
      <View style={styles.container}>
        <PassengerScreenHeader title="Track Delivery" />

        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.label}>Receiver</Text>
            <Text style={styles.value}>{params.receiverName ?? 'N/A'}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Destination</Text>
            <Text style={styles.value}>{params.toPort ?? 'N/A'}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Status</Text>
            <Text style={styles.value}>{(status ?? 'pending').replace('_', ' ')}</Text>
          </View>
        </View>

        <View style={styles.progressCard}>
          <Text style={styles.cardTitle}>Delivery Progress</Text>
          {STATUS_STEPS.map((step, idx) => (
            <View key={step} style={styles.stepRow}>
              <View style={[styles.dot, idx <= currentStep && styles.dotActive, idx < currentStep && styles.dotComplete]}>
                {idx < currentStep ? <Text style={styles.checkmark}>✓</Text> : null}
              </View>
              <View style={[styles.line, idx < currentStep && styles.lineActive]} />
              <Text style={[styles.stepLabel, idx <= currentStep && styles.stepLabelActive]}>{step}</Text>
            </View>
          ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Estimated Arrival</Text>
          <Text style={styles.eta}>{status === 'delivered' ? 'Delivered' : '1-2 business days'}</Text>
        </View>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  cardTitle: { ...typography.label, marginBottom: spacing.md },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs },
  label: { ...typography.caption },
  value: { flexShrink: 1, color: colors.text, fontSize: 14, fontWeight: '600' },

  progressCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  dot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 2,
    borderColor: colors.borderSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotActive: { borderColor: colors.primary },
  dotComplete: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkmark: { color: colors.primaryText, fontSize: 10, fontWeight: '700' },
  line: { width: 2, height: 16, backgroundColor: colors.borderSubtle },
  lineActive: { backgroundColor: colors.primary },
  stepLabel: { flexShrink: 1, color: colors.textMuted, fontSize: 13 },
  stepLabelActive: { color: colors.text, fontWeight: '600' },

  eta: { flexShrink: 1, color: colors.primary, fontSize: 18, fontWeight: '700' },
});
