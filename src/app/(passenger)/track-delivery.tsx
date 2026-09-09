import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ScreenContainer } from '@/components/ScreenContainer';
import { colors, radii, spacing, typography } from '@/theme/tokens';

const STATUS_STEPS = ['Booked', 'Picked Up', 'In Transit', 'Out for Delivery', 'Delivered'];

export default function TrackDelivery() {
  const params = useLocalSearchParams<{ parcelId?: string; status?: string; receiverName?: string; toPort?: string }>();
  const [currentStep, setCurrentStep] = useState(2);

  useEffect(() => {
    const s = params.status;
    if (s === 'pending') setCurrentStep(0);
    else if (s === 'in_transit') setCurrentStep(2);
    else if (s === 'delivered') setCurrentStep(4);
    else setCurrentStep(1);
  }, [params.status]);

  return (
    <ScreenContainer padded={false}>
      <View style={styles.container}>
        <Text style={styles.back} onPress={() => router.back()}>← Back</Text>
        <Text style={styles.title}>Track Delivery</Text>

        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.label}>Receiver</Text>
            <Text style={styles.value}>{params.receiverName ?? 'N/A'}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Destination</Text>
            <Text style={styles.value}>{params.toPort ?? 'N/A'}</Text>
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
          <Text style={styles.eta}>{params.status === 'delivered' ? 'Delivered' : '1-2 business days'}</Text>
        </View>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  back: { color: colors.primary, fontSize: 14, fontWeight: '600', marginBottom: spacing.lg },
  title: { ...typography.h1, marginBottom: spacing.xl },

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
  value: { color: colors.text, fontSize: 14, fontWeight: '600' },

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
  stepLabel: { color: colors.textMuted, fontSize: 13 },
  stepLabelActive: { color: colors.text, fontWeight: '600' },

  eta: { color: colors.primary, fontSize: 18, fontWeight: '700' },
});
