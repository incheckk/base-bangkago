import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { CompanionForm, type Companion } from '@/components/CompanionForm';
import { PassengerScreenHeader } from '@/components/PassengerScreenHeader';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { ScrollHintBar } from '@/components/ScrollHintBar';
import { ErrorState } from '@/components/States';
import { useAuth } from '@/hooks/useAuth';
import { getAdminGcashQr } from '@/services/app-settings.service';
import { friendlyError } from '@/services/booking.service';
import { pickImage } from '@/services/documents.service';
import { createDownpayment, uploadDownpaymentProof } from '@/services/downpayment.service';
import { createPassengerDetail } from '@/services/passenger-detail.service';
import { createRental, getBangkaBlockedDates } from '@/services/rental.service';
import { colors, radii, spacing, typography } from '@/theme/tokens';

/** The next 7 days starting TOMORROW — rentals are always advance, so they always escrow. */
function nextDays(count: number): { iso: string; label: string }[] {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i + 1);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const label =
      i === 0
        ? 'Tomorrow'
        : d.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' });
    return { iso, label };
  });
}

/**
 * Rental request + 50% GCash escrow in one screen (Phase 4C): pick a
 * date and hours (days the boat is already booked are crossed out —
 * 027), file the admin QR payment (reference + screenshot). The
 * request waits in awaiting_payment; the bangkero hears about it when
 * the admin approves the escrow. The remainder is collected in person
 * when the charter completes.
 */
export default function RentalFormScreen() {
  const { profile } = useAuth();
  const params = useLocalSearchParams<{
    bangkaId: string;
    boatName: string;
    operatorName: string;
    bangkeroId: string;
    rate: string;
    capacity: string;
  }>();

  const rate = Number(params.rate) || 500;
  const days = nextDays(7);

  const [date, setDate] = useState(() => days[0]?.iso ?? '');
  const [hours, setHours] = useState(2);
  const [eventName, setEventName] = useState('');
  const [companions, setCompanions] = useState<Companion[]>([]);
  // Days this boat/operator is already committed to (027) — dehighlighted below.
  const [blocked, setBlocked] = useState<string[]>([]);

  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrLoaded, setQrLoaded] = useState(false);
  const [reference, setReference] = useState('');
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

  useEffect(() => {
    let alive = true;
    if (!params.bangkaId) return;
    getBangkaBlockedDates(params.bangkaId)
      .then((v) => {
        if (!alive) return;
        setBlocked(v);
        // Never leave the selection sitting on a day that came back booked.
        setDate((cur) =>
          v.includes(cur) ? nextDays(7).find((d) => !v.includes(d.iso))?.iso ?? '' : cur
        );
      })
      .catch(() => {
        // Chips stay tappable; the insert trigger still refuses the day.
      });
    return () => {
      alive = false;
    };
  }, [params.bangkaId]);

  const total = rate * hours;
  const down = Math.round(total * 0.5);
  const remainder = total - down;
  const maxPax = Number(params.capacity) || 12;
  const bookerName = profile ? `${profile.firstName} ${profile.lastName}`.trim() : 'You';

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
      setError('Missing boat. Go back and pick one again.');
      return;
    }
    if (!date) {
      setError('Pick a rental date.');
      return;
    }
    if (!reference.trim()) {
      setError('Enter your GCash reference number.');
      return;
    }
    if (!proofUri) {
      setError('Attach your payment screenshot.');
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
        eventName: eventName.trim() || undefined,
        rentalDate: date,
        hours,
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
          referenceNum: reference,
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
        <ErrorState message="Missing boat. Go back and pick one again." />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padded={false}>
      <PassengerScreenHeader title="Rent a Boat" showDrawer={false} />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* The boat being rented */}
        <View style={styles.card}>
          <Text style={styles.boatName} numberOfLines={1}>{params.boatName ?? 'Boat'}</Text>
          <Text style={styles.boatMeta} numberOfLines={1}>
            by {params.operatorName ?? 'Bangkero'} · up to {params.capacity ?? '—'} pax
          </Text>
          <Text style={styles.boatRate}>₱{rate} per hour</Text>
        </View>

        <Text style={styles.sectionLabel}>RENTAL DETAILS</Text>
        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Event (optional)</Text>
          <TextInput
            value={eventName}
            onChangeText={setEventName}
            placeholder="e.g. Island tour, photoshoot"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
          />

          <Text style={[styles.fieldLabel, styles.mtLg]}>DATE</Text>
          <ScrollHintBar contentContainerStyle={styles.chips}>
            {days.map((d) => {
              const active = d.iso === date;
              const off = blocked.includes(d.iso);
              return (
                <Pressable
                  key={d.iso}
                  onPress={off ? undefined : () => setDate(d.iso)}
                  disabled={off}
                  accessibilityRole="button"
                  accessibilityLabel={off ? `${d.label}, booked` : d.label}
                  style={({ pressed }) => [
                    styles.chip,
                    active && styles.chipActive,
                    off && styles.chipOff,
                    pressed && !active && styles.chipPressed,
                  ]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive, off && styles.chipTextOff]}>
                    {d.label}
                  </Text>
              </Pressable>
            );
          })}
          </ScrollHintBar>
          {blocked.length > 0 && (
            <Text style={styles.dateHint}>
              Crossed-out dates are already booked for this boat.
            </Text>
          )}

          <View style={styles.hoursRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>HOURS</Text>
              <Text style={styles.hoursHint}>Minimum 1 hour</Text>
            </View>
            <View style={styles.stepper}>
              <Pressable
                onPress={() => setHours((h) => Math.max(1, h - 1))}
                disabled={hours <= 1}
                accessibilityRole="button"
                accessibilityLabel="Fewer hours"
                style={({ pressed }) => [
                  styles.stepBtn,
                  hours <= 1 && styles.stepBtnOff,
                  pressed && hours > 1 && styles.stepBtnPressed,
                ]}
              >
                <Text style={[styles.stepBtnText, hours <= 1 && styles.stepBtnTextOff]}>−</Text>
              </Pressable>
              <Text style={styles.stepValue}>{hours}</Text>
              <Pressable
                onPress={() => setHours((h) => Math.min(24, h + 1))}
                disabled={hours >= 24}
                accessibilityRole="button"
                accessibilityLabel="More hours"
                style={({ pressed }) => [
                  styles.stepBtn,
                  hours >= 24 && styles.stepBtnOff,
                  pressed && hours < 24 && styles.stepBtnPressed,
                ]}
              >
                <Text style={[styles.stepBtnText, hours >= 24 && styles.stepBtnTextOff]}>+</Text>
              </Pressable>
            </View>
          </View>
        </View>

        <Text style={styles.sectionLabel}>PASSENGERS</Text>
        <CompanionForm
          companions={companions}
          onChange={setCompanions}
          maxCount={maxPax}
          bookerName={bookerName}
          bookerMeta="You — this rental is under your name"
          hint={`Up to ${maxPax} seats — name everyone coming along; the bangkero sees this list.`}
        />

        <Text style={styles.sectionLabel}>PAYMENT SUMMARY</Text>
        <View style={styles.card}>
          <View style={styles.sumRow}>
            <Text style={styles.sumLabel}>Total ({hours}h × ₱{rate})</Text>
            <Text style={styles.sumValue}>₱{total}</Text>
          </View>
          <View style={styles.sumDivider} />
          <View style={styles.sumRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sumLabelStrong}>GCash downpayment (50%)</Text>
              <Text style={styles.sumHint}>Paid now to the admin&apos;s QR · held in escrow</Text>
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
            disabled={busy || !profile || !reference.trim() || !proofUri}
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

  fieldLabel: { ...typography.label, marginBottom: spacing.sm },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    minHeight: 46,
    color: colors.text,
    fontSize: 15,
  },
  mtLg: { marginTop: spacing.lg },

  chips: { gap: spacing.sm, paddingVertical: 2 },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  chipActive: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
  chipPressed: { opacity: 0.7 },
  chipOff: { opacity: 0.45 },
  chipText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  chipTextActive: { color: colors.primary, fontWeight: '700' },
  chipTextOff: { color: colors.textMuted, textDecorationLine: 'line-through' },
  dateHint: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm },

  hoursRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.lg, gap: spacing.md },
  hoursHint: { ...typography.caption, color: colors.textMuted, fontSize: 11 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stepBtn: {
    width: 38,
    height: 38,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnOff: { opacity: 0.4 },
  stepBtnPressed: { borderColor: colors.primary },
  stepBtnText: { fontSize: 20, fontWeight: '700', color: colors.primary },
  stepBtnTextOff: { color: colors.textMuted },
  stepValue: { ...typography.title, minWidth: 28, textAlign: 'center' },

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
