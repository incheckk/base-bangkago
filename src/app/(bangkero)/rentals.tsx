import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { BangkeroScreenHeader } from '@/components/BangkeroScreenHeader';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { ErrorState, LoadingState } from '@/components/States';
import { useAuth } from '@/hooks/useAuth';
import { useRealtimeQuery } from '@/hooks/useRealtimeQuery';
import { friendlyError } from '@/services/booking.service';
import { getDownpaymentByRental } from '@/services/downpayment.service';
import { getPassengerDetailsByRentals } from '@/services/passenger-detail.service';
import {
  type BangkeroRentalRow,
  type OwnBangka,
  confirmRental,
  completeRental,
  declineRental,
  getOwnBangkas,
  getRentalsForBangkero,
  setHourlyRate,
  setRentalListed,
} from '@/services/rental.service';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import type { PassengerDetailDoc, RentalStatus } from '@/types/models';

const STATUS_STYLES: Record<RentalStatus, { label: string; fg: string; bg: string }> = {
  pending: { label: 'Pending', fg: colors.warning, bg: colors.warningTint },
  awaiting_payment: { label: 'Awaiting payment', fg: colors.textSecondary, bg: colors.neutralTint },
  confirmed: { label: 'Confirmed', fg: colors.primary, bg: colors.primaryTint },
  completed: { label: 'Completed', fg: colors.success, bg: colors.neutralTint },
  cancelled: { label: 'Cancelled', fg: colors.textSecondary, bg: colors.neutralTint },
};

/**
 * The bangkero's charter desk (Phase 4C): listing toggle + hourly
 * rate per boat, incoming rental requests with Confirm / Decline,
 * confirmed ones to Complete once the day is done (remainder
 * collected in person). A rental day is locked once accepted (027).
 */
export default function BangkeroRentalsScreen() {
  const { user } = useAuth();
  const uid = user?.id ?? null;

  const [rows, setRows] = useState<BangkeroRentalRow[]>([]);
  const [boats, setBoats] = useState<OwnBangka[]>([]);
  const [riders, setRiders] = useState<Record<string, PassengerDetailDoc[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rateDraft, setRateDraft] = useState<Record<string, string>>({});
  const [savingRate, setSavingRate] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!uid) return;
    try {
      const rentals = await getRentalsForBangkero(uid);
      const [own, detailRows] = await Promise.all([
        getOwnBangkas(uid),
        getPassengerDetailsByRentals(rentals.map((r) => r.rentalId)).catch(() => []),
      ]);
      setRows(rentals);
      setBoats(own);
      const byRental: Record<string, PassengerDetailDoc[]> = {};
      for (const d of detailRows) {
        if (d.boatRentalId) (byRental[d.boatRentalId] ??= []).push(d);
      }
      setRiders(byRental);
      setRateDraft((prev) => {
        const next = { ...prev };
        for (const b of own) {
          if (next[b.bangkaId] === undefined) next[b.bangkaId] = String(b.hourlyRate);
        }
        return next;
      });
      setError(null);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    void load();
  }, [load]);

  // Boat rows (rate/listing) change the desk too — a rate edit from
  // another device must refresh the drafts and totals.
  useRealtimeQuery(load, [{ table: 'boat_rentals' }, { table: 'bangkas' }]);

  const notifyCtx = (row: BangkeroRentalRow) => ({
    rentalId: row.rentalId,
    notifyUserId: row.userId,
    boatName: row.boatName ?? 'your boat',
    rentalDate: row.rentalDate,
    hours: row.hours,
    eventName: row.eventName,
  });

  async function act(row: BangkeroRentalRow, fn: (ctx: ReturnType<typeof notifyCtx>) => Promise<void>) {
    if (busyId) return;
    setBusyId(row.rentalId);
    setActionError(null);
    try {
      await fn(notifyCtx(row));
      await load();
    } catch (e) {
      setActionError(friendlyError(e));
    }
    setBusyId(null);
  }

  function askDecline(row: BangkeroRentalRow) {
    Alert.alert(
      'Decline this rental?',
      `${row.renterName ?? 'The passenger'} will be told right away. Their escrow downpayment is refunded by the admin.`,
      [
        { text: 'Go back', style: 'cancel' },
        { text: 'Decline', style: 'destructive', onPress: () => void act(row, declineRental) },
      ]
    );
  }

  function askComplete(row: BangkeroRentalRow) {
    void (async () => {
      // Remainder = total minus what escrow actually holds. The approved
      // downpayment is authoritative; the half-split is a fallback that
      // rounds once (down = round, remainder = total − down) so the two
      // halves always sum back to the total.
      let remainder = row.totalPrice - Math.round(row.totalPrice * 0.5);
      try {
        const escrow = await getDownpaymentByRental(row.rentalId);
        if (escrow && escrow.status === 'approved') {
          remainder = row.totalPrice - escrow.amount;
        }
      } catch {
        // escrow unreadable (RLS/offline) — fall back to the split
      }
      Alert.alert(
        'Mark rental complete?',
        `Confirm the charter is finished and you collected ₱${remainder} in person.`,
        [
          { text: 'Go back', style: 'cancel' },
          { text: 'Complete', onPress: () => void act(row, completeRental) },
        ]
      );
    })();
  }

  async function saveRate(boat: OwnBangka) {
    if (savingRate) return;
    // A cleared field reads as Number('') === 0 — stop it here with a
    // clear message instead of letting a ₱0 rate reach the service.
    const raw = (rateDraft[boat.bangkaId] ?? '').trim();
    if (!raw) {
      setActionError('Enter an hourly rate above ₱0.');
      return;
    }
    setSavingRate(boat.bangkaId);
    setActionError(null);
    try {
      await setHourlyRate(boat.bangkaId, Number(raw));
      await load();
    } catch (e) {
      setActionError(friendlyError(e));
    }
    setSavingRate(null);
  }

  async function toggleListing(boat: OwnBangka, listed: boolean) {
    if (togglingId) return;
    setTogglingId(boat.bangkaId);
    setActionError(null);
    try {
      await setRentalListed(boat.bangkaId, listed);
      setBoats((prev) =>
        prev.map((b) => (b.bangkaId === boat.bangkaId ? { ...b, rentalListed: listed } : b))
      );
    } catch (e) {
      setActionError(friendlyError(e));
    }
    setTogglingId(null);
  }

  if (loading) {
    return (
      <ScreenContainer>
        <BangkeroScreenHeader eyebrow="CHARTERS" title="Boat Rentals" />
        <LoadingState label="Loading rentals…" />
      </ScreenContainer>
    );
  }

  if (error) {
    return (
      <ScreenContainer>
        <BangkeroScreenHeader eyebrow="CHARTERS" title="Boat Rentals" />
        <ErrorState message={error} />
      </ScreenContainer>
    );
  }

  const awaiting = rows.filter((r) => r.status === 'awaiting_payment');
  const pending = rows.filter((r) => r.status === 'pending');
  const confirmed = rows.filter((r) => r.status === 'confirmed');
  const history = rows.filter((r) => r.status === 'completed' || r.status === 'cancelled');

  return (
    <ScreenContainer padded={false}>
      <BangkeroScreenHeader
        eyebrow="CHARTERS"
        title="Boat Rentals"
        subtitle={`${pending.length} pending · ${confirmed.length} confirmed${awaiting.length > 0 ? ` · ${awaiting.length} awaiting payment` : ''}`}
      />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {!!actionError && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>{actionError}</Text>
          </View>
        )}

        {/* How the rental module works + opt-in listing (027). */}
        <View style={styles.howCard}>
          <Text style={styles.howTitle}>LIST YOUR BOAT FOR PASSENGERS</Text>
          <Text style={styles.howBody}>
            Flip the switch to make your boat show up in the passenger Boat Rental catalog.
            Passengers pick a date and pay the 50% GCash escrow; once the admin approves it,
            the request lands here — Confirm or Decline. A confirmed charter locks that whole
            day: you cannot take rides, island hops, or other charters on the same date.
          </Text>
        </View>

        {/* Charter rate + catalog visibility — what passengers see and pay. */}
        {boats.map((b) => (
          <View key={b.bangkaId} style={styles.rateCard}>
            <View style={styles.rateHead}>
              <Text style={styles.rateBoat} numberOfLines={1}>{b.bangkaName}</Text>
              <Text style={styles.rateLabel}>per hour</Text>
            </View>
            <View style={styles.rateRow}>
              <TextInput
                value={rateDraft[b.bangkaId] ?? String(b.hourlyRate)}
                onChangeText={(v) => setRateDraft((prev) => ({ ...prev, [b.bangkaId]: v }))}
                keyboardType="numeric"
                placeholder="500"
                placeholderTextColor={colors.textMuted}
                style={styles.rateInput}
              />
              <PrimaryButton
                label="Save rate"
                variant="secondary"
                onPress={() => void saveRate(b)}
                loading={savingRate === b.bangkaId}
                disabled={savingRate !== null || togglingId !== null}
                style={styles.rateBtn}
              />
            </View>
            <View style={styles.listRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.listLabel}>Visible to passengers</Text>
                <Text style={styles.listHint}>
                  {b.rentalListed ? 'Listed in the rental catalog' : 'Hidden from the catalog'}
                </Text>
              </View>
              <Switch
                value={b.rentalListed}
                onValueChange={(v) => void toggleListing(b, v)}
                disabled={togglingId !== null || savingRate !== null}
                trackColor={{ false: colors.borderSubtle, true: colors.primaryTint }}
                thumbColor={b.rentalListed ? colors.primary : colors.surface}
              />
            </View>
          </View>
        ))}

        <Text style={styles.sectionLabel}>AWAITING PAYMENT</Text>
        {awaiting.length === 0 ? (
          <Text style={styles.emptyLine}>No charters waiting on escrow.</Text>
        ) : (
          <>
            <Text style={styles.escrowHint}>
              These passengers still owe the 50% GCash escrow — Confirm unlocks
              once the admin approves it in Downpayments.
            </Text>
            {awaiting.map((row) => (
              <RentalCard
                key={row.rentalId}
                row={row}
                riders={riders[row.rentalId] ?? []}
                busy={busyId === row.rentalId}
              />
            ))}
          </>
        )}

        <Text style={styles.sectionLabel}>INCOMING REQUESTS</Text>
        {pending.length === 0 ? (
          <Text style={styles.emptyLine}>No rental requests waiting.</Text>
        ) : (
          pending.map((row) => (
            <RentalCard
              key={row.rentalId}
              row={row}
              riders={riders[row.rentalId] ?? []}
              busy={busyId === row.rentalId}
              actions={
                <>
                  <PrimaryButton
                    label="Decline"
                    variant="secondary"
                    onPress={() => askDecline(row)}
                    disabled={busyId !== null}
                    style={styles.actionBtn}
                  />
                  <PrimaryButton
                    label="Confirm"
                    onPress={() => void act(row, confirmRental)}
                    loading={busyId === row.rentalId}
                    disabled={busyId !== null}
                    style={styles.actionBtn}
                  />
                </>
              }
            />
          ))
        )}

        <Text style={styles.sectionLabel}>CONFIRMED</Text>
        {confirmed.length === 0 ? (
          <Text style={styles.emptyLine}>No confirmed charters yet.</Text>
        ) : (
          confirmed.map((row) => (
            <RentalCard
              key={row.rentalId}
              row={row}
              riders={riders[row.rentalId] ?? []}
              busy={busyId === row.rentalId}
              actions={
                <PrimaryButton
                  label="Mark complete"
                  onPress={() => askComplete(row)}
                  loading={busyId === row.rentalId}
                  disabled={busyId !== null}
                  style={styles.actionBtnFull}
                />
              }
            />
          ))
        )}

        {history.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>HISTORY</Text>
            {history.map((row) => (
              <RentalCard key={row.rentalId} row={row} riders={riders[row.rentalId] ?? []} busy={false} />
            ))}
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

function RentalCard({
  row,
  riders,
  busy,
  actions,
}: {
  row: BangkeroRentalRow;
  riders: PassengerDetailDoc[];
  busy: boolean;
  actions?: React.ReactNode;
}) {
  const status = STATUS_STYLES[row.status] ?? STATUS_STYLES.pending;
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Text style={styles.cardWho} numberOfLines={1}>
          {row.renterName ?? 'Passenger'}
          {row.eventName ? ` · ${row.eventName}` : ''}
        </Text>
        <View style={[styles.chip, { backgroundColor: status.bg }]}>
          <Text style={[styles.chipText, { color: status.fg }]}>{status.label}</Text>
        </View>
      </View>
      <Text style={styles.cardMeta} numberOfLines={1}>
        {row.boatName ?? 'Boat'} · {formatDate(row.rentalDate)} · {row.hours}h · ₱{row.totalPrice}
      </Text>
      {riders.length > 0 && (
        <Text style={styles.cardMeta} numberOfLines={2}>
          Riders: {riders.map((c) => `${c.firstName} ${c.lastName}`).join(', ')}
        </Text>
      )}
      {!!actions && <View style={styles.actions}>{actions}</View>}
    </View>
  );
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' });
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.huge, paddingTop: spacing.sm },

  banner: {
    backgroundColor: colors.dangerTint,
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  bannerText: { flexShrink: 1, color: colors.danger, fontSize: 13, lineHeight: 18 },

  rateCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  rateHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  rateBoat: { flex: 1, flexShrink: 1, ...typography.bodyStrong },
  rateLabel: { ...typography.caption, color: colors.textMuted },
  rateRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm },
  rateInput: {
    flex: 1,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    minHeight: 44,
    color: colors.text,
    fontSize: 15,
  },
  rateBtn: { minWidth: 110, minHeight: 44 },

  howCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  howTitle: { ...typography.label, color: colors.text, marginBottom: spacing.sm },
  howBody: { fontSize: 13, lineHeight: 19, color: colors.textMuted },

  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  listLabel: { fontSize: 13, fontWeight: '600', color: colors.text },
  listHint: { ...typography.caption, color: colors.textMuted, marginTop: 2 },

  sectionLabel: { ...typography.label, marginTop: spacing.xl, marginBottom: spacing.md },
  emptyLine: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.sm },
  escrowHint: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.md, lineHeight: 18 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  cardWho: { flex: 1, flexShrink: 1, color: colors.text, fontSize: 14, fontWeight: '700' },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 3, borderRadius: radii.pill },
  chipText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  cardMeta: { flexShrink: 1, ...typography.caption, color: colors.textMuted, marginTop: 4 },

  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  actionBtn: { flex: 1 },
  actionBtnFull: { flex: 1, minHeight: 44 },
});
