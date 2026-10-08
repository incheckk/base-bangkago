import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { AdminScreenHeader } from '@/components/AdminScreenHeader';
import { FilterChips } from '@/components/FilterChips';
import { ScreenContainer } from '@/components/ScreenContainer';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { useRealtimeQuery } from '@/hooks/useRealtimeQuery';
import { friendlyError } from '@/services/booking.service';
import { type AdminRentalRow, listAllRentals } from '@/services/rental.service';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import type { RentalStatus } from '@/types/models';

const STATUS_STYLES: Record<RentalStatus, { label: string; fg: string; bg: string }> = {
  pending: { label: 'Pending', fg: colors.warning, bg: colors.warningTint },
  awaiting_payment: { label: 'Awaiting payment', fg: colors.textSecondary, bg: colors.neutralTint },
  confirmed: { label: 'Confirmed', fg: colors.primary, bg: colors.primaryTint },
  completed: { label: 'Completed', fg: colors.success, bg: colors.neutralTint },
  cancelled: { label: 'Cancelled', fg: colors.textSecondary, bg: colors.neutralTint },
};

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'awaiting_payment', label: 'Awaiting payment' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
];

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

/**
 * Every boat charter on the platform (016), read-only. Money actions
 * live in Downpayments — an awaiting_payment row is one escrow review
 * away from landing on the bangkero's desk.
 */
export default function AdminBoatRentalsScreen() {
  const [rows, setRows] = useState<AdminRentalRow[]>([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await listAllRentals();
      setRows(data);
      setError(null);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useRealtimeQuery(load, [{ table: 'boat_rentals' }]);

  const visible = rows.filter((r) => filter === 'all' || r.status === filter);

  return (
    <ScreenContainer padded={false}>
      <AdminScreenHeader
        eyebrow="CHARTERS"
        title="Boat Rentals"
        subtitle={`${rows.length} total`}
      />
      <FilterChips filters={FILTERS} active={filter} onChange={setFilter} />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {loading ? (
          <LoadingState label="Loading rentals…" />
        ) : error ? (
          <ErrorState message={error} onRetry={() => { setLoading(true); void load(); }} />
        ) : visible.length === 0 ? (
          <EmptyState
            icon="🛥️"
            title="Nothing here"
            message={`No ${filter === 'all' ? '' : filter.replace('_', ' ')} rentals yet.`}
          />
        ) : (
          visible.map((row) => {
            const status = STATUS_STYLES[row.status] ?? STATUS_STYLES.pending;
            return (
              <View key={row.rentalId} style={styles.card}>
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
                  {row.renterName ?? 'Passenger'} · {row.operatorName ?? 'Bangkero'}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {formatDate(row.rentalDate)} · {row.hours}h · ₱{row.totalPrice}
                </Text>

                {row.status === 'awaiting_payment' && (
                  <Text style={styles.escrowHint}>
                    Escrow pending — review the file in Downpayments.
                  </Text>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.huge, paddingTop: spacing.sm },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
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
  boat: { flex: 1, flexShrink: 1, ...typography.title, fontSize: 15 },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 3, borderRadius: radii.pill },
  chipText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },

  event: { flexShrink: 1, ...typography.bodyStrong, marginTop: spacing.sm },
  meta: { flexShrink: 1, ...typography.caption, color: colors.textMuted, marginTop: 2 },
  escrowHint: { flexShrink: 1, ...typography.caption, color: colors.warning, marginTop: spacing.sm },
});
