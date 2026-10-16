import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ScreenContainer } from '@/components/ScreenContainer';
import { PassengerScreenHeader } from '@/components/PassengerScreenHeader';
import { useRealtimeQuery } from '@/hooks/useRealtimeQuery';
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
  const [liveExtra, setLiveExtra] = useState<{
    deliveryType?: string | null;
    approvalStatus?: string | null;
    approvalDeadlineAt?: string | null;
  } | null>(null);
  const parcelId = params.parcelId ?? null;
  const seq = useRef(0);

  useEffect(() => {
    setCurrentStep(stepForStatus(liveStatus ?? params.status));
  }, [liveStatus, params.status]);

  const load = useCallback(async () => {
    if (!parcelId) return;
    const id = ++seq.current;
    try {
      const { data, error } = await supabase
        .from('parcels')
        .select('status, delivery_type, approval_status, approval_deadline_at, piggyback_booking_id')
        .eq('id', parcelId)
        .maybeSingle();
      if (id !== seq.current) return;
      if (!error && data?.status) setLiveStatus(data.status);
      if (!error && data) {
        setLiveExtra({
          deliveryType: data.delivery_type ?? null,
          approvalStatus: data.approval_status ?? null,
          approvalDeadlineAt: data.approval_deadline_at ?? null,
        });
      }
    } catch {
      // keep the last known status when the refresh fails
    }
  }, [parcelId]);

  useEffect(() => { void load(); }, [load]);
  useRealtimeQuery(
    load,
    parcelId ? [{ table: 'parcels', filter: `id=eq.${parcelId}` }] : [],
  );

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

        {liveExtra?.deliveryType === 'piggyback' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Piggyback Status</Text>
            <View style={styles.row}>
              <Text style={styles.label}>Delivery mode</Text>
              <Text style={styles.value}>Piggyback</Text>
            </View>
            {liveExtra.approvalStatus === 'pending' && (
              <View style={styles.row}>
                <Text style={styles.label}>Approval</Text>
                <Text style={styles.value}>
                  Waiting for bangkero approval…
                  {liveExtra.approvalDeadlineAt &&
                    ` (by ${new Date(liveExtra.approvalDeadlineAt).toLocaleTimeString()})`}
                </Text>
              </View>
            )}
            {liveExtra.approvalStatus === 'accepted' && (
              <View style={styles.row}>
                <Text style={styles.label}>Approval</Text>
                <Text style={[styles.value, { color: colors.primary }]}>
                  Accepted — will ride with a passenger trip
                </Text>
              </View>
            )}
            {(liveExtra.approvalStatus === 'rejected' ||
              liveExtra.approvalStatus === 'timeout') && (
              <>
                <View style={styles.row}>
                  <Text style={styles.label}>Approval</Text>
                  <Text style={[styles.value, { color: colors.danger }]}>
                    {liveExtra.approvalStatus === 'rejected'
                      ? 'Declined by bangkero'
                      : 'No response in time'}
                  </Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.label}>Next step</Text>
                  <Text style={styles.value}>Batched delivery (coming soon)</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.label}>Next step</Text>
                  <Text style={styles.value}>Solo delivery (coming soon)</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.label}>Next step</Text>
                  <Text style={styles.value}>Or contact support to cancel</Text>
                </View>
              </>
            )}
          </View>
        )}
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
