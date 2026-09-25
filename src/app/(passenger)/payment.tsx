import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PassengerScreenHeader } from '@/components/PassengerScreenHeader';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { useAuth } from '@/hooks/useAuth';
import { createBooking, friendlyError } from '@/services/booking.service';
import { createParcel } from '@/services/parcel.service';
import { createPayment } from '@/services/payment.service';
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
  const { profile, profileLoading } = useAuth();
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
    receiverName?: string;
    receiverContact?: string;
    itemsJson?: string;
  }>();

  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const paxCount = parseInt(params.count ?? '1', 10);
  const fare = parseInt(params.fare ?? '0', 10);
  const serviceType = params.serviceType === 'cargo' ? 'cargo' : 'passenger';

  async function confirm() {
    if (busy || !profile || profileLoading) return;
    if (!params.fromId || !params.toId || !params.fromName || !params.toName) {
      setError('Missing trip details. Go back and pick your ports again.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { bookingId, ref } = await createBooking({
        passenger: profile,
        fromPort: { portId: params.fromId, portName: params.fromName },
        toPort: { portId: params.toId, portName: params.toName },
        passengerCount: serviceType === 'cargo' ? 1 : paxCount,
        serviceType,
        totalFare: fare,
      });

      await createPayment(bookingId, fare, method);

      if (serviceType === 'cargo' && params.receiverName) {
        let items: { itemName: string; quantity: number; kilogram: number }[] = [];
        if (params.itemsJson) {
          try {
            const parsed = JSON.parse(params.itemsJson) as {
              itemName: string;
              quantity: string | number;
              kilogram: string | number;
            }[];
            items = parsed
              .filter((i) => i.itemName?.trim())
              .map((i) => ({
                itemName: i.itemName.trim(),
                quantity: Number(i.quantity) || 1,
                kilogram: Number(i.kilogram) || 1,
              }));
          } catch {
            items = [];
          }
        }
        await createParcel({
          receiverName: params.receiverName,
          receiverContact: params.receiverContact || undefined,
          totalPrice: fare,
          userId: profile.uid,
          bookingId,
          items,
        });
      }

      router.push({
        pathname: '/(passenger)/booking-confirmed',
        params: {
          ...params,
          paymentMethod: method,
          bookingId,
          ref,
        },
      });
    } catch (e) {
      setError(friendlyError(e));
      setBusy(false);
    }
  }

  return (
    <ScreenContainer padded={false}>
      <PassengerScreenHeader title="Payment" />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
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

          {!!error && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <View style={styles.bottomPad}>
            <PrimaryButton
              label="Confirm Booking"
              onPress={confirm}
              loading={busy}
              disabled={busy || profileLoading || !profile}
            />
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: spacing.xxl },
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
  summaryRowValue: { flexShrink: 1, color: colors.text, fontSize: 13, fontWeight: '600' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { color: colors.text, fontSize: 15, fontWeight: '700' },
  totalValue: { flexShrink: 1, color: colors.primary, fontSize: 22, fontWeight: '700' },

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
  methodIcon: { flexShrink: 1, fontSize: 28 },
  methodInfo: { flex: 1 },
  methodName: { flexShrink: 1, color: colors.text, fontSize: 15, fontWeight: '600' },
  methodNameActive: { color: colors.primary },
  methodDesc: { flexShrink: 1, color: colors.textMuted, fontSize: 12, marginTop: 2 },
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

  errorBanner: {
    backgroundColor: colors.dangerTint,
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  errorText: { flexShrink: 1, color: colors.danger, fontSize: 13, lineHeight: 18 },
});
