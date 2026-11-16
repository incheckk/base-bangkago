import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { CompanionForm, type Companion } from '@/components/CompanionForm';
import { PassengerScreenHeader } from '@/components/PassengerScreenHeader';
import { PrimaryButton } from '@/components/PrimaryButton';
import { SchedulePicker, dayOptions } from '@/components/SchedulePicker';
import { ScreenContainer } from '@/components/ScreenContainer';
import { ErrorState } from '@/components/States';
import { useAuth } from '@/hooks/useAuth';
import { getRentalToday } from '@/services/dev.service';
import { getBangkaBlockedDates, tierStandardPrice } from '@/services/rental.service';
import { colors, radii, spacing, typography } from '@/theme/tokens';

/**
 * Step 1 of renting a boat: who rides, when, how many (Phase 4C). The GCash
 * QR and receipt moved to rental-payment.tsx, so this ends on "Proceed to
 * Downpayment" like the island-hop flow instead of scrolling past a payment
 * nobody has agreed to the dates for yet. One flat whole-day price per boat
 * (068), no hourly math.
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

  const rate = Number(params.rate) || tierStandardPrice(Number(params.capacity) || 0);
  // Demo switch (089): OFF is the production rule, so the strip starts
  // tomorrow. ON adds today — the escrow flow below is unchanged.
  const [sameDay, setSameDay] = useState(false);
  const days = useMemo(() => dayOptions(14, !sameDay), [sameDay]);

  const [date, setDate] = useState(() => dayOptions(14, true)[0]?.iso ?? '');
  const [eventName, setEventName] = useState('');
  const [companions, setCompanions] = useState<Companion[]>([]);
  // Days this boat/operator is already committed to (027) — dehighlighted below.
  const [blocked, setBlocked] = useState<string[]>([]);

  useEffect(() => {
    getRentalToday().then((v) => setSameDay(v === true)).catch(() => {});
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
          v.includes(cur) ? days.find((d) => !v.includes(d.iso))?.iso ?? '' : cur
        );
      })
      .catch(() => {
        // Chips stay tappable; the insert trigger still refuses the day.
      });
    return () => {
      alive = false;
    };
  }, [params.bangkaId, days]);

  const total = rate;
  const down = Math.round(total * 0.5);
  const remainder = total - down;
  const maxPax = Number(params.capacity) || 12;
  const bookerName = profile ? `${profile.firstName} ${profile.lastName}`.trim() : 'You';

  function proceed() {
    if (!params.bangkaId || !date) return;
    router.push({
      pathname: '/(passenger)/rental-payment',
      params: {
        bangkaId: params.bangkaId,
        boatName: params.boatName ?? 'Boat',
        operatorName: params.operatorName ?? 'Bangkero',
        rate: String(rate),
        capacity: String(maxPax),
        date,
        eventName: eventName.trim(),
        companionsJson: JSON.stringify(companions),
      },
    });
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
        subtitle="Step 1 of 2 · Trip details"
        showDrawer={false}
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* The boat being rented */}
        <View style={styles.card}>
          <Text style={styles.boatName} numberOfLines={1}>{params.boatName ?? 'Boat'}</Text>
          <Text style={styles.boatMeta} numberOfLines={1}>
            by {params.operatorName ?? 'Bangkero'} · up to {params.capacity ?? '—'} pax
          </Text>
          <Text style={styles.boatRate}>₱{rate} for the whole day</Text>
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
          <SchedulePicker
            date={date}
            time={null}
            onDate={setDate}
            onTime={() => {}}
            fromTomorrow={!sameDay}
            hideSlots
            blockedDays={blocked}
          />
          {blocked.length > 0 && (
            <Text style={styles.dateHint}>
              Dates marked Booked are already taken for this boat.
            </Text>
          )}
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
            <Text style={styles.sumLabel}>Whole-day charter</Text>
            <Text style={styles.sumValue}>₱{total}</Text>
          </View>
          <View style={styles.sumDivider} />
          <View style={styles.sumRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sumLabelStrong}>GCash downpayment (50%)</Text>
              <Text style={styles.sumHint}>Paid next step to BangkaGo&apos;s QR · held in escrow</Text>
            </View>
            <Text style={styles.sumDown}>₱{down}</Text>
          </View>
          <View style={styles.sumRow}>
            <Text style={styles.sumLabelStrong}>Collected in person</Text>
            <Text style={styles.sumValue}>₱{remainder}</Text>
          </View>
        </View>

        <Text style={styles.escrowHint}>
          The bangkero is notified once we confirm your downpayment, then confirms or
          declines. Nothing is charged in the app — the remainder is paid in person.
        </Text>

        <View style={styles.footer}>
          <PrimaryButton
            label="Proceed to Downpayment"
            onPress={proceed}
            disabled={!profile || !date}
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
  dateHint: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm },

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

  escrowHint: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: spacing.lg,
  },

  footer: { marginTop: spacing.xl },
});
