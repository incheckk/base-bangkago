import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PassengerScreenHeader } from '@/components/PassengerScreenHeader';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { useAuth } from '@/hooks/useAuth';
import { createBooking, friendlyError } from '@/services/booking.service';
import { createParcel } from '@/services/parcel.service';
import { createPassengerDetail } from '@/services/passenger-detail.service';
import { createPayment } from '@/services/payment.service';
import { colors, radii, spacing, typography } from '@/theme/tokens';

type PaymentMethod = 'cash' | 'gcash';

const PAYMENT_METHODS: {
  key: PaymentMethod;
  label: string;
  icon: string;
  description: string;
}[] = [
  { key: 'cash', label: 'Cash', icon: '💵', description: 'Pay onboard to the bangkero' },
  { key: 'gcash', label: 'GCash', icon: '📱', description: 'Pay via GCash on board' },
];

/** Rides happen the day you book them — there is no date to pick. */
const todayLabel = () =>
  `Today · ${new Date().toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}`;

export default function PaymentScreen() {
  const { profile, profileLoading } = useAuth();
  const params = useLocalSearchParams<{
    fromId: string;
    fromName: string;
    toId: string;
    toName: string;
    count: string;
    serviceType: string;
    fare: string;
    companionsJson?: string;
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

      // Companions ride under this booking. A failed insert must never block
      // the confirmation screen — the booking itself already exists.
      if (serviceType === 'passenger' && params.companionsJson) {
        try {
          const companions = JSON.parse(params.companionsJson) as {
            firstName: string; lastName: string; age?: number; sex?: string; contact?: string;
          }[];
          await Promise.all(
            companions.map((c) =>
              createPassengerDetail({
                firstName: c.firstName,
                lastName: c.lastName,
                age: c.age,
                sex: c.sex,
                contactNumber: c.contact,
                passengerType: 'regular',
                bookingId,
              }).catch(() => null),
            ),
          );
        } catch {
          if (__DEV__) console.warn('[payment] companions json malformed');
        }
      }

      await createPayment(bookingId, fare, method);

      let parcelId: string | undefined;
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
        const parcel = await createParcel({
          receiverName: params.receiverName,
          receiverContact: params.receiverContact || undefined,
          totalPrice: fare,
          userId: profile.uid,
          bookingId,
          items,
        });
        parcelId = parcel.parcelId;
      }

      router.push({
        pathname: '/(passenger)/booking-confirmed',
        params: {
          ...params,
          paymentMethod: method,
          bookingId,
          ref,
          ...(parcelId ? { parcelId } : {}),
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
              <Text style={styles.summaryRowLabel}>Trip date</Text>
              <Text style={styles.summaryRowValue}>{todayLabel()}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryRowLabel}>Passengers</Text>
              <Text style={styles.summaryRowValue}>{paxCount}</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total to be paid</Text>
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
