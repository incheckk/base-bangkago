import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PassengerScreenHeader } from '@/components/PassengerScreenHeader';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { slotLabel } from '@/components/SchedulePicker';
import { useAuth } from '@/hooks/useAuth';
import { useDevFlags } from '@/hooks/useSupabase';
import { getAdminGcashQr } from '@/services/app-settings.service';
import { createBooking, friendlyError, isAdvanceDate } from '@/services/booking.service';
import {
  attachDownpaymentProof, createDownpayment, getDownpaymentByBooking, startGatewayCheckout,
  uploadDownpaymentProof,
} from '@/services/downpayment.service';
import { pickImage } from '@/services/documents.service';
import { createParcel, validateParcelItems } from '@/services/parcel.service';
import { assignToBatch } from '@/services/parcel-batching.service';
import { PARCEL_RATES } from '@/services/parcel-pricing.service';
import { supabase } from '@/services/supabase';
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
];

/** Rides happen the day you book them — there is no date to pick. */
const todayLabel = () =>
  `Today · ${new Date().toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}`;

function scheduleLabel(dateIso: string, time: string | null): string {
  const d = new Date(`${dateIso}T00:00:00`);
  const day = Number.isNaN(d.getTime())
    ? dateIso
    : d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
  return time ? `${day} · ${slotLabel(time)}` : day;
}

/**
 * The provider's webhook normally lands while the checkout page is still
 * open; this only covers the last hop back into the app. Gives up after
 * ~12 s — the booking screen keeps showing the real state either way.
 */
async function waitForApproval(bookingId: string): Promise<boolean> {
  for (let i = 0; i < 8; i += 1) {
    const row = await getDownpaymentByBooking(bookingId).catch(() => null);
    if (row?.status === 'approved') return true;
    if (row?.status === 'refunded' || row?.status === 'rejected') return false;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return false;
}

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
    deliveryMode?: string;
    piggybackBookingId?: string;
    originIsland?: string;
    destinationIsland?: string;
    packageId?: string;
    packageName?: string;
    downAmount?: string;
    remainder?: string;
    scheduledDate?: string;
    scheduledTime?: string;
    /** 097: retry from the booking screen — the booking already exists. */
    bookingId?: string;
  }>();

  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 096: while Developer Options → Manual payments is OFF the downpayment
  // goes through the gateway's hosted page and confirms itself; ON keeps
  // today's receipt upload + admin review. Unrun 096 reads as manual.
  const devFlags = useDevFlags();
  const gateway = !devFlags.loading && devFlags.data.manualPayments === false;
  // One intent id for the lifetime of this screen (087): a retry after a
  // lost response returns the booking instead of creating a second one.
  const clientRef = useRef(
    `pay-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  );

  // Display-only quotes. createBooking recomputes the real fare and passenger
  // count server-side, so editing these URL params can no longer change what
  // is stored or collected.
  const paxCount = Math.max(1, parseInt(params.count ?? '1', 10) || 1);
  const fare = Math.max(0, parseInt(params.fare ?? '0', 10) || 0);
  const serviceType = params.serviceType === 'cargo' ? 'cargo' : 'passenger';

  const deliveryMode: 'accompanied' | 'piggyback' | 'batched' | 'solo' =
    params.deliveryMode === 'piggyback'
      ? 'piggyback'
      : params.deliveryMode === 'batched'
        ? 'batched'
        : params.deliveryMode === 'solo'
          ? 'solo'
          : 'accompanied';
  const piggybackBookingId =
    typeof params.piggybackBookingId === 'string' && params.piggybackBookingId.length > 0
      ? params.piggybackBookingId
      : null;
  const originIsland =
    typeof params.originIsland === 'string' && params.originIsland.length > 0
      ? params.originIsland
      : null;
  const destinationIsland =
    typeof params.destinationIsland === 'string' && params.destinationIsland.length > 0
      ? params.destinationIsland
      : null;

  // Package mode passes its 50% down/remainder split along.
  const isPackage = !!params.packageId;
  // Escrow follows the DATE, not the product (020): a future sailing
  // (package or plain ride) pays 50% to the admin's QR and stays hidden
  // from bangkeros until the admin clears it. Same-day = pay onboard.
  const isAdvance = isAdvanceDate(params.scheduledDate);
  const isEscrow = isAdvance;
  const downAmount = isPackage
    ? Math.round(parseInt(params.downAmount ?? '0', 10) || 0)
    : Math.round(fare / 2);
  const onboardRemainder = isPackage
    ? parseInt(params.remainder ?? params.fare ?? '0', 10) || 0
    : Math.max(0, fare - downAmount);
  const existingBookingId =
    typeof params.bookingId === 'string' && params.bookingId.length > 0 ? params.bookingId : null;
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrLoaded, setQrLoaded] = useState(false);
  const [proofUri, setProofUri] = useState<string | null>(null);
  const [proofUploading, setProofUploading] = useState(false);
  // 097: the passenger can always fall back to GCash + receipt, and a
  // gateway checkout that died reuses the row it already filed.
  const [manual, setManual] = useState(false);
  const [fallbackRowId, setFallbackRowId] = useState<string | null>(null);
  // The receipt rail: manual mode (Developer Options) or "Pay by GCash
  // instead" chosen on the gateway rail.
  const manualRail = !gateway || manual;

  useEffect(() => {
    if (!isEscrow) return;
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
  }, [isEscrow]);

  async function chooseProof(source: 'camera' | 'gallery') {
    if (proofUploading) return;
    try {
      const uri = await pickImage(source);
      if (uri) setProofUri(uri);
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  /**
   * 097: file (or finish) the escrow row, then walk the gateway rail when
   * it is the chosen one. A checkout that dies after the row exists is not
   * lost — the row id is kept and the screen switches to GCash + receipt.
   */
  async function fileDownpayment(
    bookingId: string,
    amount: number
  ): Promise<'approved' | 'pending' | 'blocked' | 'failed'> {
    let proofPath: string | null = null;
    if (manualRail) {
      if (!proofUri) return 'failed';
      try {
        setProofUploading(true);
        proofPath = await uploadDownpaymentProof(proofUri);
      } catch {
        return 'failed';
      } finally {
        setProofUploading(false);
      }
    }

    let rowId = fallbackRowId;
    try {
      if (!rowId) {
        const row = await createDownpayment({
          amount,
          // No manual ref input (prof's rule): the admin reads the Ref No.
          // off the attached receipt while verifying in GCash. The gateway
          // path leaves reference_num to the provider.
          referenceNum: '',
          proofUrl: proofPath ?? '',
          bookingId,
        });
        rowId = row.downpaymentId;
        setFallbackRowId(rowId);
      } else if (proofPath) {
        // The checkout failed after the row was filed — this receipt is
        // the payment now.
        await attachDownpaymentProof(rowId, '', proofPath);
      }
    } catch {
      return 'failed';
    }

    if (manualRail) return 'pending';

    try {
      const url = await startGatewayCheckout(rowId);
      if (!url) return 'approved'; // already settled
      await WebBrowser.openBrowserAsync(url);
      return (await waitForApproval(bookingId)) ? 'approved' : 'pending';
    } catch (e) {
      setManual(true);
      setError(`${friendlyError(e)} You can still pay by GCash and send the receipt here.`);
      return 'blocked';
    }
  }

  async function confirm() {
    if (busy || !profile || profileLoading) return;
    if (
      !existingBookingId &&
      (!params.fromId || !params.toId || !params.fromName || !params.toName)
    ) {
      setError('Missing trip details. Go back and pick your ports again.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // 097: opened from the booking screen — the booking already exists,
      // so only the escrow row is left to file.
      if (existingBookingId) {
        const downStatus = await fileDownpayment(existingBookingId, downAmount);
        if (downStatus === 'blocked') {
          setBusy(false);
          return;
        }
        if (downStatus === 'failed') {
          setError('We could not save that payment. Try again.');
          setBusy(false);
          return;
        }
        router.replace({
          pathname: '/(passenger)/booking/[id]',
          params: { id: existingBookingId },
        });
        return;
      }

      // Accompanied Padala hides the receiver fields; the parcel still needs
      // a receiver_name, so the sender is the receiver.
      const resolvedReceiverName =
        params.receiverName?.trim() ||
        `${profile.firstName ?? ''} ${profile.lastName ?? ''}`.trim() ||
        'Sender';
      const resolvedReceiverContact = params.receiverContact || profile.phone || undefined;

      // Cargo lines are parsed and validated BEFORE the booking exists: the
      // fare is recomputed from them, and a bad line must not leave a booking
      // (or a paid-downpayment booking) behind.
      let cargoItems: { itemName: string; quantity: number; kilogram: number }[] = [];
      if (serviceType === 'cargo') {
        if (deliveryMode !== 'accompanied' && !params.receiverName) {
          throw new Error('Missing receiver details. Go back and try again.');
        }
        let parsed: { itemName?: string; quantity: string | number; kilogram: string | number }[];
        try {
          parsed = JSON.parse(params.itemsJson ?? '[]') as typeof parsed;
        } catch {
          throw new Error('Item details are invalid. Go back and check them.');
        }
        cargoItems = parsed.map((i) => ({
          itemName: String(i.itemName ?? '').trim(),
          quantity: Number(i.quantity),
          kilogram: Number(i.kilogram),
        }));
        validateParcelItems(cargoItems);
      }

      const { bookingId, ref, totalPrice } = await createBooking({
        passenger: profile,
        fromPort: { portId: params.fromId, portName: params.fromName },
        toPort: { portId: params.toId, portName: params.toName },
        passengerCount: serviceType === 'cargo' ? 1 : paxCount,
        serviceType,
        items: serviceType === 'cargo' ? cargoItems : undefined,
        deliveryType: deliveryMode,
        // Option B (045): only accompanied cargo is a real crossing.
        // Piggyback/batched/solo stubs stay invisible to FCFS until the
        // carrier link (or create_solo_sailing) promotes them.
        isDispatchable: serviceType !== 'cargo' || deliveryMode === 'accompanied',
        clientRef: clientRef.current,
        ...(isPackage && params.packageId ? { packageId: params.packageId } : {}),
        ...(params.scheduledDate
          ? { scheduledDate: params.scheduledDate, scheduledTime: params.scheduledTime || undefined }
          : {}),
      });

      // The server-recomputed fare is the only amount this screen records.
      const actualFare = totalPrice;
      const actualDownAmount = Math.round(totalPrice / 2);
      const actualRemainder = totalPrice - actualDownAmount;

      // Companions ride under this booking. A failed insert must never block
      // the confirmation screen — the booking itself already exists — but it
      // MUST be reported: the fare is per passenger, so silently losing a
      // companion means paying for someone who has no boarding pass.
      // 097: after a failed checkout the booking and its rows already
      // exist — repeating them would double-write (a second payments row
      // breaks the singular lookups).
      let companionWarning = false;
      if (!fallbackRowId && serviceType === 'passenger' && params.companionsJson) {
        try {
          const companions = JSON.parse(params.companionsJson) as {
            firstName: string; lastName: string; age?: number; sex?: string; contact?: string;
            address?: string;
          }[];
          const saved = await Promise.all(
            companions.map((c) =>
              createPassengerDetail({
                firstName: c.firstName,
                lastName: c.lastName,
                age: c.age,
                sex: c.sex,
                contactNumber: c.contact,
                address: c.address,
                passengerType: 'regular',
                bookingId,
              }).then(() => true).catch(() => false),
            ),
          );
          companionWarning = saved.some((ok) => !ok);
        } catch {
          companionWarning = true;
          if (__DEV__) console.warn('[payment] companions json malformed');
        }
      }

      // One payments row per booking, always (012 mark_paid semantics):
      // escrow bookings record only the ONBOARD remainder — the 50%
      // already "paid" lives in downpayments, not here. Post-booking
      // writes never block the confirmation screen: the booking already
      // exists, and mark_paid upserts a missing row when the bangkero
      // collects fare.
      let payWarning = false;
      if (!fallbackRowId) {
        try {
          await createPayment(
            bookingId,
            isEscrow ? actualRemainder : actualFare,
            isEscrow ? 'cash' : method
          );
        } catch {
          payWarning = true;
        }
      }

      let parcelId: string | undefined;
      let parcelWarning = false;
      if (!fallbackRowId && serviceType === 'cargo') {
        try {
          const parcel = await createParcel({
            receiverName: resolvedReceiverName,
            receiverContact: resolvedReceiverContact,
            totalPrice: actualFare,
            userId: profile.uid,
            bookingId,
            items: cargoItems,
            deliveryType: deliveryMode,
            piggybackBookingId,
            totalWeightKg: cargoItems.reduce((sum, i) => sum + i.kilogram, 0) || null,
            originIsland,
            destinationIsland,
            quotedFare: actualFare,
          });
          parcelId = parcel.parcelId;
          // Batched mode: put the parcel in the batch queue. Never blocks
          // the booking — on failure the parcel keeps its createParcel
          // pending_batch state and batching is retried from tracking.
          if (deliveryMode === 'batched' && parcel?.parcelId) {
            const result = await assignToBatch({
              parcelId: parcel.parcelId,
              fromPortId: params.fromId,
              toPortId: params.toId,
            });
            if (!result) {
              parcelWarning = true;
            }
          }
          if (deliveryMode === 'solo' && parcel?.parcelId) {
            // Solo mode = immediate departure, no batching window.
            await supabase
              .from('parcels')
              .update({
                batching_status: 'solo',
                solo_surcharge: PARCEL_RATES.soloSurcharge,
              })
              .eq('id', parcel.parcelId);
            // Solo: its own booking is the carrier. Requires migration 045
            // (carrier_booking_id) — best-effort so the booking still
            // confirms if the column is not in the DB yet.
            const { error: carrierErr } = await supabase
              .from('parcels')
              .update({ carrier_booking_id: bookingId })
              .eq('id', parcel.parcelId);
            if (carrierErr && __DEV__) {
              console.warn('[parcel] carrier_booking_id update skipped:', carrierErr.message);
            }
          }
        } catch {
          parcelWarning = true;
        }
      }

      // 097: file the escrow row — or reuse the row a failed checkout left
      // behind — and, on the gateway rail, walk through the hosted page.
      let downStatus: 'approved' | 'pending' | 'blocked' | 'failed' = 'pending';
      if (isEscrow) {
        downStatus = await fileDownpayment(bookingId, actualDownAmount);
        if (downStatus === 'blocked') {
          setBusy(false);
          return;
        }
      }

      // Batched parcels wait in the batch queue — hand off to the
      // waiting screen instead of the standard confirmation.
      if (deliveryMode === 'batched' && parcelId) {
        router.replace({
          pathname: '/(passenger)/batched-waiting',
          params: { parcelId },
        });
        return;
      }

      // replace, not push: the payment form must leave the stack so the
      // hardware/back gesture can never re-open it and double-book.
      router.replace({
        pathname: '/(passenger)/booking-confirmed',
        params: {
          ...params,
          receiverName: resolvedReceiverName,
          fare: String(actualFare),
          paymentMethod: isEscrow ? 'cash' : method,
          bookingId,
          ref,
          ...(parcelId ? { parcelId } : {}),
          ...(payWarning ? { payWarning: '1' } : {}),
          ...(parcelWarning ? { parcelWarning: '1' } : {}),
          ...(companionWarning ? { companionWarning: '1' } : {}),
          ...(isEscrow
            ? {
                downStatus: downStatus === 'approved' ? 'approved' : 'pending',
                downAmount: String(actualDownAmount),
                remainder: String(actualRemainder),
                ...(downStatus === 'failed' ? { downWarning: '1' } : {}),
              }
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
            <Text style={styles.summaryRowValue}>
              {params.scheduledDate
                ? scheduleLabel(params.scheduledDate, params.scheduledTime || null)
                : todayLabel()}
            </Text>
          </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryRowLabel}>Passengers</Text>
              <Text style={styles.summaryRowValue}>{paxCount}</Text>
            </View>
            {serviceType === 'cargo' && (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryRowLabel}>Delivery mode</Text>
                <Text style={styles.summaryRowValue}>
                  {deliveryMode === 'piggyback' ? 'Piggyback' : 'Accompanied'}
                </Text>
              </View>
            )}
            <View style={styles.summaryDivider} />
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total to be paid</Text>
              <Text style={styles.totalValue}>₱{fare}</Text>
            </View>
          </View>

          {isEscrow ? (
            <View>
              <Text style={[styles.sectionLabel, styles.mtLg]}>
              {manualRail ? 'GCASH DOWNPAYMENT (50%)' : 'DOWNPAYMENT'}
              </Text>
              <View style={styles.escrowCard}>
                <View style={styles.escrowAmountRow}>
                  <Text style={styles.escrowLabel}>Downpayment · goes to your bangkero</Text>
                  <Text style={styles.escrowAmount}>₱{downAmount}</Text>
                </View>
                <View style={styles.summaryDivider} />
                <View style={styles.escrowAmountRow}>
                  <Text style={styles.escrowLabel}>Collected onboard</Text>
                  <Text style={styles.escrowRemainder}>₱{onboardRemainder}</Text>
                </View>
              </View>

              {!manualRail ? (
                <Text style={styles.escrowHint}>
                  You&apos;ll pay ₱{downAmount} on BangkaGo&apos;s secure checkout page. The
                  downpayment is held by BangkaGo until your trip, then released to your
                  bangkero.
                </Text>
              ) : (
                <>
                  <Text style={styles.inputLabel}>SCAN &amp; PAY VIA GCASH</Text>
                  {qrUrl ? (
                    <Image source={{ uri: qrUrl }} style={styles.qrImage} resizeMode="contain" />
                  ) : (
                    <View style={styles.qrPlaceholder}>
                      <Text style={styles.qrPlaceholderText}>
                        {qrLoaded
                          ? 'BangkaGo has not set up its GCash QR yet. Try again later, or book today and pay on board.'
                          : 'Loading QR…'}
                      </Text>
                    </View>
                  )}

                  <Text style={styles.inputLabel}>GCASH RECEIPT SCREENSHOT</Text>
                  <Text style={styles.proofHint}>
                    Attach the digital receipt of your Express Send — our team reads the
                    Ref No. straight from this image.
                  </Text>
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
                    {isAdvance
                      ? 'We review your payment first — your sailing is confirmed and offered to bangkeros only after that. This downpayment is held in escrow until your trip.'
                      : 'We confirm your payment on our side. Booking goes ahead either way — this downpayment is held in escrow until your trip.'}
                  </Text>
                </>
              )}
              {gateway && (
                <Pressable onPress={() => setManual((v) => !v)} disabled={busy}>
                  <Text style={styles.railToggle}>
                    {manual
                      ? 'Use the secure checkout page instead'
                      : 'Pay by GCash instead — upload a receipt'}
                  </Text>
                </Pressable>
              )}
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
              <Text style={styles.methodNote}>
                Paying by GCash? Select Cash above and pay via GCash onboard — the bangkero
                will confirm it when you board.
              </Text>
            </View>
          )}

          {!!error && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <View style={styles.bottomPad}>
            <PrimaryButton
              label={
                !isEscrow
                  ? 'Confirm Booking'
                  : !manualRail
                    ? 'Pay downpayment'
                    : existingBookingId
                      ? 'Send receipt'
                      : `Pay ₱${downAmount} & Book`
              }
              onPress={confirm}
              loading={busy || proofUploading}
              disabled={
                busy ||
                proofUploading ||
                profileLoading ||
                !profile ||
                (isEscrow && manualRail && !proofUri)
              }
            />
            {isEscrow && !manualRail && (
              <Text style={styles.paySubline}>
                50% of your fare · held for your bangkero until the trip
              </Text>
            )}
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
  methodNote: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: spacing.sm,
  },

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
  proofHint: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.sm },
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
  railToggle: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '600',
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
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
  paySubline: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
  },

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
