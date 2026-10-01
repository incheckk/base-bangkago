import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { PassengerScreenHeader } from '@/components/PassengerScreenHeader';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { useAuth } from '@/hooks/useAuth';
import { getAdminGcashQr } from '@/services/app-settings.service';
import { createBooking, friendlyError } from '@/services/booking.service';
import { createDownpayment, uploadDownpaymentProof } from '@/services/downpayment.service';
import { pickImage } from '@/services/documents.service';
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
    packageId?: string;
    packageName?: string;
    downAmount?: string;
    remainder?: string;
  }>();

  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Package mode: 50% GCash escrow to the ADMIN's QR, proof filed here.
  const isPackage = !!params.packageId;
  const downAmount = Math.round((parseInt(params.downAmount ?? '0', 10) || 0));
  const remainderAmount = parseInt(params.remainder ?? params.fare ?? '0', 10) || 0;
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrLoaded, setQrLoaded] = useState(false);
  const [reference, setReference] = useState('');
  const [proofUri, setProofUri] = useState<string | null>(null);
  const [proofUploading, setProofUploading] = useState(false);

  useEffect(() => {
    if (!isPackage) return;
    let alive = true;
    (async () => {
      try {
        const url = await getAdminGcashQr();
        if (alive) setQrUrl(url);
      } catch {
        // QR unavailable — the placeholder explains what to do
      } finally {
        if (alive) setQrLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [isPackage]);

  async function chooseProof(source: 'camera' | 'gallery') {
    if (proofUploading) return;
    try {
      const uri = await pickImage(source);
      if (uri) setProofUri(uri);
    } catch (e) {
      setError(friendlyError(e));
    }
  }

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
      // Package mode files the escrow proof FIRST — a booking must never
      // exist without the screenshot that documents its downpayment.
      let proofPath: string | null = null;
      if (isPackage) {
        if (!reference.trim()) throw new Error('Enter your GCash reference number.');
        if (!proofUri) throw new Error('Attach your payment screenshot.');
        setProofUploading(true);
        try {
          proofPath = await uploadDownpaymentProof(proofUri);
        } finally {
          setProofUploading(false);
        }
      }

      const { bookingId, ref } = await createBooking({
        passenger: profile,
        fromPort: { portId: params.fromId, portName: params.fromName },
        toPort: { portId: params.toId, portName: params.toName },
        passengerCount: serviceType === 'cargo' ? 1 : paxCount,
        serviceType,
        totalFare: fare,
        ...(isPackage && params.packageId ? { packageId: params.packageId } : {}),
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

      // One payments row per booking, always (012 mark_paid semantics):
      // packages record only the ONBOARD remainder — the 50% already
      // "paid" lives in downpayments, not here. Post-booking writes never
      // block the confirmation screen: the booking already exists, and
      // mark_paid upserts a missing row when the bangkero collects fare.
      let payWarning = false;
      if (isPackage) {
        try {
          await createPayment(bookingId, remainderAmount, 'cash');
        } catch {
          payWarning = true;
        }
      } else {
        try {
          await createPayment(bookingId, fare, method);
        } catch {
          payWarning = true;
        }
      }

      let parcelId: string | undefined;
      let parcelWarning = false;
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
        try {
          const parcel = await createParcel({
            receiverName: params.receiverName,
            receiverContact: params.receiverContact || undefined,
            totalPrice: fare,
            userId: profile.uid,
            bookingId,
            items,
          });
          parcelId = parcel.parcelId;
        } catch {
          parcelWarning = true;
        }
      }

      // Escrow row — the booking already exists, so a failed insert must
      // never block the confirmation screen: flag it and move on.
      let downWarning = false;
      if (isPackage && proofPath) {
        try {
          await createDownpayment({
            amount: downAmount,
            referenceNum: reference,
            proofUrl: proofPath,
            bookingId,
          });
        } catch {
          downWarning = true;
        }
      }

      router.push({
        pathname: '/(passenger)/booking-confirmed',
        params: {
          ...params,
          paymentMethod: isPackage ? 'cash' : method,
          bookingId,
          ref,
          ...(parcelId ? { parcelId } : {}),
          ...(payWarning ? { payWarning: '1' } : {}),
          ...(parcelWarning ? { parcelWarning: '1' } : {}),
          ...(isPackage
            ? { downStatus: 'pending', ...(downWarning ? { downWarning: '1' } : {}) }
            : {}),
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
          {!!params.packageName && (
            <>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryRow}>
                <Text style={styles.summaryRowLabel}>Package</Text>
                <Text style={styles.summaryRowValue} numberOfLines={1}>{params.packageName}</Text>
              </View>
            </>
          )}
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

          {isPackage ? (
            <View>
              <Text style={[styles.sectionLabel, styles.mtLg]}>GCASH DOWNPAYMENT (50%)</Text>
              <View style={styles.escrowCard}>
                <View style={styles.escrowAmountRow}>
                  <Text style={styles.escrowLabel}>Pay now to the admin&apos;s GCash</Text>
                  <Text style={styles.escrowAmount}>₱{downAmount}</Text>
                </View>
                <View style={styles.summaryDivider} />
                <View style={styles.escrowAmountRow}>
                  <Text style={styles.escrowLabel}>Collected onboard</Text>
                  <Text style={styles.escrowRemainder}>₱{remainderAmount}</Text>
                </View>
              </View>

              <Text style={styles.inputLabel}>SCAN &amp; PAY VIA GCASH</Text>
              {qrUrl ? (
                <Image source={{ uri: qrUrl }} style={styles.qrImage} resizeMode="contain" />
              ) : (
                <View style={styles.qrPlaceholder}>
                  <Text style={styles.qrPlaceholderText}>
                    {qrLoaded
                      ? 'The admin has not uploaded their GCash QR yet. Ask them to set it up in Admin → GCash QR.'
                      : 'Loading QR…'}
                  </Text>
                </View>
              )}

              <Text style={styles.inputLabel}>GCASH REFERENCE NUMBER</Text>
              <TextInput
                value={reference}
                onChangeText={setReference}
                placeholder="e.g. 123456789012"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="characters"
                style={styles.input}
              />

              <Text style={styles.inputLabel}>PAYMENT SCREENSHOT</Text>
              <View style={styles.proofRow}>
                <Pressable
                  onPress={() => void chooseProof('gallery')}
                  disabled={proofUploading}
                  style={({ pressed }) => [styles.proofBtn, pressed && styles.proofBtnPressed]}
                >
                  <Text style={styles.proofBtnText}>🖼 Gallery</Text>
                </Pressable>
                <Pressable
                  onPress={() => void chooseProof('camera')}
                  disabled={proofUploading}
                  style={({ pressed }) => [styles.proofBtn, pressed && styles.proofBtnPressed]}
                >
                  <Text style={styles.proofBtnText}>📷 Camera</Text>
                </Pressable>
              </View>
              {proofUri && (
                <Image source={{ uri: proofUri }} style={styles.proofPreview} resizeMode="cover" />
              )}

              <Text style={styles.escrowHint}>
                The admin confirms your payment from their side. Booking goes ahead either way —
                this downpayment is held in escrow until your trip.
              </Text>
            </View>
          ) : (
            <View>
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
            </View>
          )}

          {!!error && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <View style={styles.bottomPad}>
            <PrimaryButton
              label={isPackage ? `Pay ₱${downAmount} & Book` : 'Confirm Booking'}
              onPress={confirm}
              loading={busy || proofUploading}
              disabled={
                busy ||
                proofUploading ||
                profileLoading ||
                !profile ||
                (isPackage && (!reference.trim() || !proofUri))
              }
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

  escrowCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
  },
  escrowAmountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  escrowLabel: { ...typography.caption, flexShrink: 1 },
  escrowAmount: { color: colors.primary, fontSize: 20, fontWeight: '700' },
  escrowRemainder: { color: colors.text, fontSize: 16, fontWeight: '700' },

  inputLabel: { ...typography.label, marginTop: spacing.lg, marginBottom: spacing.sm },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    minHeight: 46,
    color: colors.text,
    fontSize: 15,
  },
  qrImage: {
    width: '100%',
    height: 200,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  qrPlaceholder: {
    minHeight: 120,
    borderRadius: radii.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  qrPlaceholderText: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },

  proofRow: { flexDirection: 'row', gap: spacing.md },
  proofBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  proofBtnPressed: { borderColor: colors.primary },
  proofBtnText: { color: colors.primary, fontSize: 14, fontWeight: '600' },
  proofPreview: {
    width: '100%',
    height: 160,
    borderRadius: radii.md,
    marginTop: spacing.md,
  },
  escrowHint: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: spacing.md,
  },
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
