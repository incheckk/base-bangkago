import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { colors, radii, spacing, typography } from '@/theme/tokens';

type PaymentMethod = 'cash' | 'gcash' | 'maya' | 'bank_transfer';

const PAYMENT_METHODS: {
  key: PaymentMethod;
  label: string;
  icon: string;
  description: string;
}[] = [
  { key: 'cash', label: 'Cash', icon: '💵', description: 'Pay onboard to the bangkero' },
  { key: 'gcash', label: 'GCash', icon: '📱', description: 'Send payment via GCash' },
  { key: 'maya', label: 'Maya', icon: '💳', description: 'Pay through Maya wallet' },
  { key: 'bank_transfer', label: 'Bank Transfer', icon: '🏦', description: 'Transfer via your bank app' },
];

export default function PaymentScreen() {
  const params = useLocalSearchParams<{
    fromId: string;
    fromName: string;
    toId: string;
    toName: string;
    date: string;
    time: string;
    count: string;
    passengerType: string;
    serviceType: string;
    fare: string;
  }>();

  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [busy, setBusy] = useState(false);

  const paxCount = parseInt(params.count ?? '1', 10);
  const fare = parseInt(params.fare ?? '0', 10);

  function confirm() {
    setBusy(true);
    router.push({
      pathname: '/(passenger)/booking-confirmed',
      params: {
        ...params,
        paymentMethod: method,
      },
    });
  }

  return (
    <ScreenContainer padded={false}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Text style={styles.back}>← Back</Text>
          </Pressable>
          <Text style={styles.title}>Payment</Text>
        </View>

        <View style={styles.body}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>BOOKING SUMMARY</Text>
            <View style={styles.routeRow}>
              <Text style={styles.routeText} numberOfLines={1}>
                {params.fromName ?? '—'}
              </Text>
              <Text style={styles.routeArrow}> → </Text>
              <Text style={styles.routeText} numberOfLines={1}>
                {params.toName ?? '—'}
              </Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryRow}>
              <Text style={styles.summaryRowLabel}>Date</Text>
              <Text style={styles.summaryRowValue}>{params.date ?? '—'}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryRowLabel}>Time</Text>
              <Text style={styles.summaryRowValue}>{params.time ?? '—'}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryRowLabel}>Passengers</Text>
              <Text style={styles.summaryRowValue}>{paxCount}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryRowLabel}>Type</Text>
              <Text style={styles.summaryRowValue}>
                {(params.passengerType ?? 'Regular').charAt(0).toUpperCase() +
                  (params.passengerType ?? 'Regular').slice(1)}
              </Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryRowLabel}>Service</Text>
              <Text style={styles.summaryRowValue}>
                {(params.serviceType ?? 'passenger').charAt(0).toUpperCase() +
                  (params.serviceType ?? 'passenger').slice(1)}
              </Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalValue}>₱{fare}</Text>
            </View>
          </View>

          <Text style={[styles.sectionLabel, styles.mtLg]}>PAYMENT METHOD</Text>
          <View style={styles.methodList}>
            {PAYMENT_METHODS.map((m) => {
              const active = m.key === method;
              return (
                <Pressable
                  key={m.key}
                  onPress={() => setMethod(m.key)}
                  style={({ pressed }) => [
                    styles.methodCard,
                    active && styles.methodCardActive,
                    pressed && !active && styles.methodPressed,
                  ]}
                >
                  <Text style={styles.methodIcon}>{m.icon}</Text>
                  <View style={styles.methodInfo}>
                    <Text style={[styles.methodName, active && styles.methodNameActive]}>
                      {m.label}
                    </Text>
                    <Text style={styles.methodDesc}>{m.description}</Text>
                  </View>
                  <View style={[styles.radio, active && styles.radioActive]}>
                    {active && <View style={styles.radioDot} />}
                  </View>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.bottomPad}>
            <PrimaryButton
              label="Confirm Booking"
              onPress={confirm}
              loading={busy}
            />
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: spacing.xxl },
  header: { paddingHorizontal: spacing.xl, paddingBottom: spacing.lg },
  back: { color: colors.primary, fontSize: 14, fontWeight: '600', marginBottom: spacing.md },
  title: { ...typography.h2 },
  body: { paddingHorizontal: spacing.xl },

  summaryCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
  },
  summaryLabel: { ...typography.label, marginBottom: spacing.md },
  routeRow: { flexDirection: 'row', alignItems: 'center' },
  routeText: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '600' },
  routeArrow: { color: colors.primary, fontSize: 15, fontWeight: '700' },
  summaryDivider: { height: 1, backgroundColor: colors.borderSubtle, marginVertical: spacing.md },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
  summaryRowLabel: { ...typography.caption },
  summaryRowValue: { color: colors.text, fontSize: 13, fontWeight: '600' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { color: colors.text, fontSize: 15, fontWeight: '700' },
  totalValue: { color: colors.primary, fontSize: 22, fontWeight: '700' },

  sectionLabel: { ...typography.label, marginBottom: spacing.md },
  mtLg: { marginTop: spacing.xl },

  methodList: { gap: spacing.md },
  methodCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    gap: spacing.md,
  },
  methodCardActive: { borderColor: colors.primary, backgroundColor: colors.surfaceAlt },
  methodPressed: { opacity: 0.8 },
  methodIcon: { fontSize: 28 },
  methodInfo: { flex: 1 },
  methodName: { color: colors.text, fontSize: 15, fontWeight: '600' },
  methodNameActive: { color: colors.primary },
  methodDesc: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: { borderColor: colors.primary },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },

  bottomPad: { marginTop: spacing.xl },
});
