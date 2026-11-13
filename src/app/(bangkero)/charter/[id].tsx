import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BangkeroScreenHeader } from '@/components/BangkeroScreenHeader';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { useAuth } from '@/hooks/useAuth';
import { useRealtimeQuery } from '@/hooks/useRealtimeQuery';
import { friendlyError } from '@/services/booking.service';
import { getDownpaymentByRental } from '@/services/downpayment.service';
import { createNotification } from '@/services/notification.service';
import { getPassengerDetailsByRentals } from '@/services/passenger-detail.service';
import {
  type BangkeroRentalRow,
  completeRental,
  getBangkeroRental,
  rentalDurationLabel,
  startRental,
} from '@/services/rental.service';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import type { PassengerDetailDoc } from '@/types/models';
import { manilaTodayIso } from '@/utils/date';

/**
 * A charter's sailing day (079). The rental had no "at sea" phase before:
 * Confirm → Complete hid the whole trip. This screen is its manifest
 * (renter + party list) and its clock (started_at / completed_at), and it
 * is where the bangkero starts and closes the day.
 */
export default function CharterSailingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const uid = user?.id ?? null;

  const [row, setRow] = useState<BangkeroRentalRow | null>(null);
  const [riders, setRiders] = useState<PassengerDetailDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!uid || !id) return;
    try {
      const rental = await getBangkeroRental(uid, id);
      setRow(rental);
      setRiders(rental ? await getPassengerDetailsByRentals([rental.rentalId]).catch(() => []) : []);
      setError(null);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }, [uid, id]);

  useEffect(() => { void load(); }, [load]);
  useRealtimeQuery(load, [{ table: 'boat_rentals', filter: `id=eq.${id}` }]);

  const today = manilaTodayIso();
  const canStart = !!row
    && row.status === 'confirmed'
    && !row.startedAt
    && row.rentalDate <= today;

  async function start() {
    if (!row || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await startRental(row.rentalId);
      await createNotification(
        row.userId,
        'Your charter has started',
        `${row.boatName ?? 'The boat'} left for your charter${row.eventName ? ` (${row.eventName})` : ''}.`,
        'booking'
      ).catch(() => {});
      await load();
    } catch (e) {
      setActionError(friendlyError(e));
    }
    setBusy(false);
  }

  async function finish() {
    if (!row || busy) return;
    // Remainder = total minus what escrow actually holds (same rule the
    // rentals list used). Falls back to the half split when unreadable.
    let remainder = row.totalPrice - Math.round(row.totalPrice * 0.5);
    try {
      const escrow = await getDownpaymentByRental(row.rentalId);
      if (escrow && escrow.status === 'approved') remainder = row.totalPrice - escrow.amount;
    } catch {
      // escrow unreadable (RLS/offline) — keep the split
    }
    Alert.alert(
      'Finish this charter?',
      `Confirm the charter is over and you collected ₱${remainder} in person. The 50% escrow is released to you by the admin.`,
      [
        { text: 'Go back', style: 'cancel' },
        {
          text: 'Finish',
          onPress: () => {
            void (async () => {
              setBusy(true);
              setActionError(null);
              try {
                await completeRental({
                  rentalId: row.rentalId,
                  notifyUserId: row.userId,
                  boatName: row.boatName ?? 'the boat',
                  rentalDate: row.rentalDate,
                  eventName: row.eventName,
                });
                await load();
              } catch (e) {
                setActionError(friendlyError(e));
              }
              setBusy(false);
            })();
          },
        },
      ]
    );
  }

  if (loading) {
    return (
      <ScreenContainer padded={false}>
        <BangkeroScreenHeader eyebrow="CHARTER" title="Sailing day" showDrawer={false} />
        <LoadingState label="Loading charter…" />
      </ScreenContainer>
    );
  }

  if (error) {
    return (
      <ScreenContainer padded={false}>
        <BangkeroScreenHeader eyebrow="CHARTER" title="Sailing day" showDrawer={false} />
        <ErrorState message={error} onRetry={() => { setLoading(true); void load(); }} />
      </ScreenContainer>
    );
  }

  if (!row) {
    return (
      <ScreenContainer padded={false}>
        <BangkeroScreenHeader eyebrow="CHARTER" title="Sailing day" showDrawer={false} />
        <EmptyState icon="boat" title="Charter not found" message="It may have been cancelled or removed." />
      </ScreenContainer>
    );
  }

  const status = row.completedAt
    ? { label: 'Completed', fg: colors.success, bg: colors.primaryTint }
    : row.startedAt
      ? { label: 'Under way', fg: colors.primary, bg: colors.primaryTint }
      : row.status === 'confirmed'
        ? { label: 'Confirmed', fg: colors.primary, bg: colors.primaryTint }
        : { label: row.status.replace('_', ' '), fg: colors.textSecondary, bg: colors.neutralTint };

  return (
    <ScreenContainer padded={false}>
      <BangkeroScreenHeader
        eyebrow="CHARTER"
        title={row.eventName || 'Sailing day'}
        showDrawer={false}
      />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        <View style={styles.summary}>
          <View style={styles.summaryTop}>
            <Text style={styles.boat} numberOfLines={1}>{row.boatName ?? 'Boat'}</Text>
            <View style={[styles.chip, { backgroundColor: status.bg }]}>
              <Text style={[styles.chipText, { color: status.fg }]}>{status.label}</Text>
            </View>
          </View>
          <Text style={styles.meta}>
            {formatDate(row.rentalDate)} · {rentalDurationLabel(row.hours)} · ₱{row.totalPrice}
          </Text>
          <Text style={styles.meta}>
            {row.startedAt ? `Started ${timeLabel(row.startedAt)}` : 'Not started yet'}
            {row.completedAt ? ` · Finished ${timeLabel(row.completedAt)}` : ''}
          </Text>
        </View>

        {!!actionError && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>{actionError}</Text>
          </View>
        )}

        <Text style={styles.sectionLabel}>MANIFEST</Text>
        <View style={styles.card}>
          <Text style={styles.personName} numberOfLines={1}>{row.renterName ?? 'Passenger'}</Text>
          <Text style={styles.meta} numberOfLines={1}>
            Booker{row.renterAge != null ? ` · ${row.renterAge} yrs` : ''}
            {row.renterPhone ? ` · ${row.renterPhone}` : ''}
          </Text>
          {!!row.renterAddress && (
            <Text style={styles.address} numberOfLines={2}>📍 {row.renterAddress}</Text>
          )}

          {riders.length > 0 ? (
            <>
              <Text style={styles.partyLabel}>PARTY · {riders.length}</Text>
              {riders.map((c) => (
                <View key={c.passengerId} style={styles.rider}>
                  <Text style={styles.personName} numberOfLines={1}>
                    {c.firstName} {c.lastName}
                    {c.age != null ? ` · ${c.age} yrs` : ''}
                    {c.sex ? ` · ${c.sex}` : ''}
                  </Text>
                  {!!c.contactNumber && (
                    <Text style={styles.address} numberOfLines={1}>{c.contactNumber}</Text>
                  )}
                  {!!c.address && (
                    <Text style={styles.address} numberOfLines={2}>📍 {c.address}</Text>
                  )}
                </View>
              ))}
            </>
          ) : (
            <Text style={styles.meta}>No other passengers listed.</Text>
          )}
        </View>

        {row.status === 'confirmed' && !row.completedAt && (
          <View style={styles.actions}>
            {!row.startedAt ? (
              <PrimaryButton
                label={canStart ? 'Start charter' : `Starts ${formatDate(row.rentalDate)}`}
                onPress={() => void start()}
                loading={busy}
                disabled={!canStart || busy}
              />
            ) : (
              <PrimaryButton
                label="Finish charter"
                onPress={finish}
                loading={busy}
                disabled={busy}
                variant="secondary"
              />
            )}
            {!canStart && !row.startedAt && (
              <Text style={styles.hint}>
                A charter can only be started on its sailing day.
              </Text>
            )}
          </View>
        )}

        {row.completedAt && (
          <Text style={styles.done}>
            Charter finished {timeLabel(row.completedAt)}. The admin releases the held 50% to
            your GCash once confirmed.
          </Text>
        )}

        <View style={styles.sosWrap}>
          <PrimaryButton
            label="SOS · emergency"
            variant="secondary"
            onPress={() => router.push('/(bangkero)/sos-alert')}
          />
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' });
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.huge, paddingTop: spacing.sm },

  summary: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
  },
  summaryTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  boat: { flex: 1, flexShrink: 1, ...typography.h2 },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 3, borderRadius: radii.pill },
  chipText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  meta: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs },

  banner: {
    backgroundColor: colors.dangerTint,
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  bannerText: { flexShrink: 1, color: colors.danger, fontSize: 13, lineHeight: 18 },

  sectionLabel: { ...typography.label, marginTop: spacing.xl, marginBottom: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
  },
  personName: { flexShrink: 1, color: colors.text, fontSize: 15, fontWeight: '600' },
  address: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  partyLabel: { ...typography.label, marginTop: spacing.lg, marginBottom: spacing.sm },
  rider: {
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    paddingTop: spacing.md,
    marginTop: spacing.md,
  },

  actions: { marginTop: spacing.xl, gap: spacing.sm },
  hint: { ...typography.caption, color: colors.textMuted },
  done: {
    ...typography.caption,
    color: colors.primary,
    marginTop: spacing.xl,
    lineHeight: 20,
  },
  sosWrap: { marginTop: spacing.xxl },
});
