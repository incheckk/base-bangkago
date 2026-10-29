import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { type Companion } from '@/components/CompanionForm';
import { PassengerScreenHeader } from '@/components/PassengerScreenHeader';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { ErrorState } from '@/components/States';
import { useAuth } from '@/hooks/useAuth';
import { getAdminGcashQr } from '@/services/app-settings.service';
import { friendlyError } from '@/services/booking.service';
import { pickImage } from '@/services/documents.service';
import { createDownpayment, uploadDownpaymentProof } from '@/services/downpayment.service';
import { createPassengerDetail } from '@/services/passenger-detail.service';
import { createRental, tierStandardPrice } from '@/services/rental.service';
import { colors, radii, spacing, typography } from '@/theme/tokens';

/**
 * Step 2 of the rental: 50% GCash escrow (Phase 4C). The request waits in
 * awaiting_payment; the bangkero hears about it when the admin approves the
 * escrow. The remainder is collected in person when the charter completes.
 * The admin reads the Ref No. straight off the attached receipt — no manual
 * reference input (prof's rule).
 */
function formatDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-PH', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
}

export default function RentalPaymentScreen() {
  const { profile } = useAuth();
  const params = useLocalSearchParams<{
    bangkaId: string;
    boatName: string;
    operatorName: string;
    rate: string;
    capacity: string;
    date: string;
    eventName: string;
    companionsJson: string;
  }>();

  const rate = Number(params.rate) || tierStandardPrice(Number(params.capacity) || 0);
  const date = params.date ?? '';
  const total = rate;
  const down = Math.round(total * 0.5);
  const remainder = total - down;

  const companions: Companion[] = (() => {
    try {
      return JSON.parse(params.companionsJson || '[]') as Companion[];
    } catch {
      return [];
    }
  })();

  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrLoaded, setQrLoaded] = useState(false);
  const [proofUri, setProofUri] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getAdminGcashQr()
      .then((v) => {
        if (alive) setQrUrl(v);
      })
      .catch(() => {
        // placeholder explains what to do when no QR exists yet
      })
      .finally(() => {
        if (alive) setQrLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  async function chooseProof(source: 'camera' | 'gallery') {
    try {
      const uri = await pickImage(source);
      if (uri) setProofUri(uri);
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  async function submit() {
    if (busy || !profile) return;
    if (!params.bangkaId) {
      setError('No boat selected. Go back and choose one.');
      return;
    }
    if (!date) {
      setError('Pick a rental date.');
      return;
    }
    if (!proofUri) {
      setError('Attach your GCash receipt screenshot.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      // Proof first: a rental must never exist without the screenshot
      // that documents its downpayment (same order as the package flow).
      const proofPath = await uploadDownpaymentProof(proofUri);

      const rental = await createRental({
        userId: profile.uid,
        bangkaId: params.bangkaId,
        eventName: params.eventName || undefined,
        rentalDate: date,
      });

      // Companions ride under this charter (026 boat_rental_id). A failed
      // insert must never block the request — the rental already exists.
      await Promise.all(
        companions.map((c) =>
          createPassengerDetail({
            firstName: c.firstName,
            lastName: c.lastName,
            age: c.age,
            sex: c.sex,
            contactNumber: c.contact,
            address: c.address,
            passengerType: 'regular',
            boatRentalId: rental.rentalId,
          }).catch(() => null),
        ),
      );

      // Escrow row — booking already exists, so a failed insert only
      // flags the confirmation instead of blocking it.
      let downWarning = false;
      try {
        await createDownpayment({
          amount: down,
          referenceNum: '',
          proofUrl: proofPath,
          boatRentalId: rental.rentalId,
        });
      } catch {
        downWarning = true;
      }

      // No notification here on purpose: the request sits in
      // awaiting_payment where the bangkero cannot act on it. They are
      // notified the moment the admin approves the escrow (020/027).
      router.replace({
        pathname: '/(passenger)/my-rentals',
        params: {
          rentalId: rental.rentalId,
          ...(downWarning ? { downWarning: '1' } : {}),
        },
      });
    } catch (e) {
      setError(friendlyError(e));
      setBusy(false);
    }
  }

  if (!params.bangkaId) {
    return (
      <ScreenContainer>
        <PassengerScreenHeader title="Rent a Boat" />
        <ErrorState message="No boat selected. Go back and choose one." />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padded={false}>
      <PassengerScreenHeader
        title="Rent a Boat"
        subtitle="Step 2 of 2 · Downpayment"
        showDrawer={false}
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <Text style={styles.boatName} numberOfLines={1}>{params.boatName ?? 'Boat'}</Text>
          <Text style={styles.boatMeta} numberOfLines={1}>
            by {params.operatorName ?? 'Bangkero'} · {formatDate(date)}
            {companions.length + 1 > 1 ? ` · ${companions.length + 1} pax` : ''}
          </Text>
          {!!params.eventName && (
            <Text style={styles.boatMeta} numberOfLines={2}>{params.eventName}</Text>
          )}
          <Text style={styles.boatRate}>₱{total} for the whole day</Text>
        </View>

        <Text style={styles.sectionLabel}>PAYMENT SUMMARY</Text>
        <View style={styles.card}>
          <View style={styles.sumRow}>
            <Text style={styles.sumLabel}>Whole-day charter</Text>
            <Text style={styles.sumValue}>₱{total}</Text>
          </View>
          <View style={styles.sumDivider} />
          <View style={styles.sumRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sumLabelStrong}>GCash downpayment (50%)</Text>
              <Text style={styles.sumHint}>Held in escrow until the admin verifies it</Text>
            </View>
            <Text style={styles.sumDown}>₱{down}</Text>
          </View>
          <View style={styles.sumRow}>
            <Text style={styles.sumLabelStrong}>Collected in person</Text>
            <Text style={styles.sumValue}>₱{remainder}</Text>
          </View>
        </View>

        <Text style={styles.sectionLabel}>GCASH DOWNPAYMENT (50%)</Text>
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

        <Text style={styles.inputLabel}>GCASH RECEIPT SCREENSHOT</Text>
        <Text style={styles.proofHint}>
          Attach the digital receipt of your Express Send — the admin reads the
          Ref No. straight from this image.
        </Text>
        <View style={styles.proofRow}>
          <Pressable
            onPress={() => void chooseProof('gallery')}
            disabled={busy}
            style={({ pressed }) => [styles.proofBtn, pressed && styles.proofBtnPressed]}
          >
            <Text style={styles.proofBtnText}>🖼 Gallery</Text>
          </Pressable>
          <Pressable
            onPress={() => void chooseProof('camera')}
            disabled={busy}
            style={({ pressed }) => [styles.proofBtn, pressed && styles.proofBtnPressed]}
          >
            <Text style={styles.proofBtnText}>📷 Camera</Text>
          </Pressable>
        </View>
        {proofUri && <Image source={{ uri: proofUri }} style={styles.proofPreview} resizeMode="cover" />}

        <Text style={styles.escrowHint}>
          The bangkero is notified once the admin approves your downpayment, then confirms or
          declines. Nothing is charged in the app — the remainder is paid in person.
        </Text>

        {!!error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <View style={styles.footer}>
          <PrimaryButton
            label={`Pay ₱${down} & request rental`}
            onPress={submit}
            loading={busy}
            disabled={busy || !profile || !proofUri}
          />
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.huge },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
  },
  boatName: { ...typography.title, fontSize: 16, flexShrink: 1 },
  boatMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  boatRate: { ...typography.h2, color: colors.primary, marginTop: spacing.sm },

  sectionLabel: { ...typography.label, marginTop: spacing.xl, marginBottom: spacing.md },

  sumRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  sumLabel: { ...typography.caption, flex: 1 },
  sumLabelStrong: { ...typography.caption, color: colors.text, fontWeight: '700', flexShrink: 1 },
  sumHint: { ...typography.caption, color: colors.textMuted, fontSize: 11, marginTop: 2 },
  sumDivider: { height: 1, backgroundColor: colors.borderSubtle, marginVertical: spacing.sm },
  sumValue: { ...typography.bodyStrong, flexShrink: 1 },
  sumDown: { ...typography.bodyStrong, color: colors.primary, flexShrink: 1 },

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

  inputLabel: { ...typography.label, marginTop: spacing.lg, marginBottom: spacing.sm },
  proofHint: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.sm },

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
  proofPreview: { width: '100%', height: 160, borderRadius: radii.md, marginTop: spacing.md },

  escrowHint: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: spacing.md,
  },

  errorBanner: {
    backgroundColor: colors.dangerTint,
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  errorText: { flexShrink: 1, color: colors.danger, fontSize: 13, lineHeight: 18 },

  footer: { marginTop: spacing.xl },
});
