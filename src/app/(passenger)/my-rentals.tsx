import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PassengerScreenHeader } from '@/components/PassengerScreenHeader';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { useAuth } from '@/hooks/useAuth';
import { useRealtimeQuery } from '@/hooks/useRealtimeQuery';
import { friendlyError } from '@/services/booking.service';
import { getDownpaymentByRental } from '@/services/downpayment.service';
import { getPassengerDetailsByRentals } from '@/services/passenger-detail.service';
import { cancelRental, getMyRentals, type PassengerRentalRow } from '@/services/rental.service';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import type { DownpaymentDoc, PassengerDetailDoc, RentalStatus } from '@/types/models';

const STATUS_STYLES: Record<RentalStatus, { label: string; fg: string; bg: string }> = {
  pending: { label: 'Pending', fg: colors.warning, bg: colors.warningTint },
  awaiting_payment: { label: 'Awaiting payment', fg: colors.textSecondary, bg: colors.neutralTint },
  confirmed: { label: 'Confirmed', fg: colors.primary, bg: colors.primaryTint },
  completed: { label: 'Completed', fg: colors.success, bg: colors.neutralTint },
  cancelled: { label: 'Cancelled', fg: colors.textSecondary, bg: colors.neutralTint },
};

const DOWN_TEXT: Record<string, string> = {
  pending: 'awaiting admin confirmation',
  approved: 'confirmed by admin',
  refunded: 'refunded',
};

/**
 * The passenger's rental requests with live status (016 realtime) and
 * their escrow row (015). Pending requests can be withdrawn; refunds
 * for cancelled ones are handled by the admin in Downpayments.
 */
export default function MyRentalsScreen() {
  const { user } = useAuth();
  const params = useLocalSearchParams<{ rentalId?: string; downWarning?: string }>();

  const [rows, setRows] = useState<PassengerRentalRow[]>([]);
  const [downs, setDowns] = useState<Record<string, DownpaymentDoc>>({});
  const [riders, setRiders] = useState<Record<string, PassengerDetailDoc[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user?.id) return;
    try {
      const rentals = await getMyRentals(user.id);
      setRows(rentals);
      const [downRows, detailRows] = await Promise.all([
        Promise.all(rentals.map((r) => getDownpaymentByRental(r.rentalId).catch(() => null))),
        getPassengerDetailsByRentals(rentals.map((r) => r.rentalId)).catch(() => []),
      ]);
      const map: Record<string, DownpaymentDoc> = {};
      rentals.forEach((r, i) => {
        const d = downRows[i];
        if (d) map[r.rentalId] = d;
      });
      setDowns(map);
      const byRental: Record<string, PassengerDetailDoc[]> = {};
      for (const d of detailRows) {
        if (d.boatRentalId) (byRental[d.boatRentalId] ??= []).push(d);
      }
      setRiders(byRental);
      setError(null);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtimeQuery(load, [
    { table: 'boat_rentals', filter: user?.id ? `user_id=eq.${user.id}` : undefined },
    { table: 'downpayments' },
  ]);

  function askCancel(row: PassengerRentalRow) {
    Alert.alert(
      'Cancel this rental?',
      `${row.boatName ?? 'The boat'} on ${row.rentalDate} for ${row.hours}h will be released. If you filed a downpayment, ask the admin for a refund.`,
      [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Cancel rental', style: 'destructive', onPress: () => void doCancel(row) },
      ]
    );
  }

  async function doCancel(row: PassengerRentalRow) {
    if (busyId) return;
    setBusyId(row.rentalId);
    setActionError(null);
    try {
      await cancelRental({
        rentalId: row.rentalId,
        notifyUserId: row.operatorId,
        boatName: row.boatName ?? 'the boat',
        rentalDate: row.rentalDate,
        hours: row.hours,
        eventName: row.eventName,
      });
      await load();
    } catch (e) {
      setActionError(friendlyError(e));
    }
    setBusyId(null);
  }

  return (
    <ScreenContainer padded={false}>
      <PassengerScreenHeader
        title="My Rentals"
        subtitle="Charter requests, escrow status, and what is left to pay in person."
        showDrawer={false}
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {params.downWarning === '1' && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>
              Your downpayment record did not save. Keep your GCash reference and screenshot,
              then contact support.
            </Text>
          </View>
        )}

        {!!actionError && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>{actionError}</Text>
          </View>
        )}

        {loading ? (
          <LoadingState label="Loading rentals…" />
        ) : error ? (
          <ErrorState message={error} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="🚤"
            title="No rentals yet"
            message="Charter a boat from the Boat Rental screen and your requests will show up here."
          />
        ) : (
          rows.map((row) => {
            const status = STATUS_STYLES[row.status] ?? STATUS_STYLES.pending;
            const down = downs[row.rentalId];
            const rideList = riders[row.rentalId] ?? [];
            const total = row.totalPrice;
            const remainder = total - (down?.amount ?? Math.round(total * 0.5));
            const justSubmitted = params.rentalId === row.rentalId;
            return (
              <View
                key={row.rentalId}
                style={[styles.card, justSubmitted && styles.cardHighlight]}
              >
                <View style={styles.cardTop}>
                  <Text style={styles.boat} numberOfLines={1}>{row.boatName ?? 'Boat'}</Text>
                  <View style={[styles.chip, { backgroundColor: status.bg }]}>
                    <Text style={[styles.chipText, { color: status.fg }]}>{status.label}</Text>
                  </View>
                </View>

                {!!row.eventName && (
                  <Text style={styles.event} numberOfLines={1}>{row.eventName}</Text>
                )}
                <Text style={styles.meta} numberOfLines={1}>
                  {formatDate(row.rentalDate)} · {row.hours}h · ₱{total}
                  {row.operatorName ? ` · ${row.operatorName}` : ''}
                </Text>
                {rideList.length > 0 && (
                  <Text style={styles.meta} numberOfLines={2}>
                    Riders: {rideList.map((c) => `${c.firstName} ${c.lastName}`).join(', ')}
                  </Text>
                )}

                <View style={styles.divider} />

                <View style={styles.moneyRow}>
                  <Text style={styles.moneyLabel}>Downpayment (50%)</Text>
                  <Text style={styles.moneyValue}>
                    {down
                      ? `₱${down.amount} · ${DOWN_TEXT[down.status] ?? down.status}`
                      : 'Not recorded'}
                  </Text>
                </View>
                {row.status !== 'cancelled' && (
                  <View style={styles.moneyRow}>
                    <Text style={styles.moneyLabel}>Collected in person</Text>
                    <Text style={styles.moneyValue}>₱{remainder}</Text>
                  </View>
                )}

                {row.status === 'pending' && (
                  <PrimaryButton
                    label="Cancel rental"
                    variant="secondary"
                    onPress={() => askCancel(row)}
                    loading={busyId === row.rentalId}
                    disabled={busyId !== null}
                    style={styles.cancelBtn}
                  />
                )}
              </View>
            );
          })
        )}

        <PrimaryButton
          label="Back to Boat Rental"
          variant="secondary"
          onPress={() => router.replace('/(passenger)/boat-rental')}
          style={styles.backBtn}
        />
      </ScrollView>
    </ScreenContainer>
  );
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-PH', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.huge },

  banner: {
    backgroundColor: colors.dangerTint,
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  bannerText: { flexShrink: 1, color: colors.danger, fontSize: 13, lineHeight: 18 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  cardHighlight: { borderColor: colors.primary },

  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  boat: { flex: 1, flexShrink: 1, ...typography.title, fontSize: 15 },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 3, borderRadius: radii.pill },
  chipText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },

  event: { flexShrink: 1, ...typography.bodyStrong, marginTop: spacing.sm },
  meta: { flexShrink: 1, ...typography.caption, color: colors.textMuted, marginTop: 2 },

  divider: { height: 1, backgroundColor: colors.borderSubtle, marginVertical: spacing.md },

  moneyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  moneyLabel: { flexShrink: 1, ...typography.caption },
  moneyValue: { flexShrink: 1, color: colors.text, fontSize: 13, fontWeight: '600', textAlign: 'right' },

  cancelBtn: { marginTop: spacing.md },
  backBtn: { marginTop: spacing.md },
});
