import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { BangkeroScreenHeader } from '@/components/BangkeroScreenHeader';
import { ScreenContainer } from '@/components/ScreenContainer';
import { LoadingState, ErrorState, EmptyState } from '@/components/States';
import { useAuth } from '@/hooks/useAuth';
import { useRealtimeQuery } from '@/hooks/useRealtimeQuery';
import { useMyTrips } from '@/hooks/useSupabase';
import { type PayoutRow, getReleasedPayouts } from '@/services/downpayment.service';
import { completedTrips, summarizeEarnings } from '@/utils/earnings';
import { colors, radii, spacing, typography } from '@/theme/tokens';

/**
 * Earnings = completed trip fares (the fare is collected on board, so the
 * trip completing is the earn event). Same helper as Home, so the two
 * screens always agree. Released escrow payouts are that same fare moving
 * later — shown so the history is complete, never added to the totals.
 */
export default function BangkeroEarnings() {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const trips = useMyTrips(uid);

  const [payouts, setPayouts] = useState<PayoutRow[]>([]);
  const loadPayouts = useCallback(async () => {
    if (!uid) return;
    try {
      setPayouts(await getReleasedPayouts(uid));
    } catch {
      // the release shows up on the next realtime tick
    }
  }, [uid]);
  useEffect(() => { void loadPayouts(); }, [loadPayouts]);
  useRealtimeQuery(loadPayouts, [{ table: 'downpayments' }]);

  const summary = useMemo(() => summarizeEarnings(trips.data), [trips.data]);
  const history = useMemo(() => completedTrips(trips.data), [trips.data]);

  if (trips.loading) {
    return (
      <ScreenContainer padded={false}>
        <BangkeroScreenHeader title="Earnings" />
        <View style={styles.center}>
          <LoadingState label="Loading earnings…" />
        </View>
      </ScreenContainer>
    );
  }

  if (trips.error) {
    return (
      <ScreenContainer padded={false}>
        <BangkeroScreenHeader title="Earnings" />
        <View style={styles.center}>
          <ErrorState message={trips.error} />
        </View>
      </ScreenContainer>
    );
  }

  const tiles = [
    { label: 'TODAY', value: summary.today },
    { label: 'THIS WEEK', value: summary.week },
    { label: 'THIS MONTH', value: summary.month },
    { label: 'ALL TIME', value: summary.allTime },
  ];

  return (
    <ScreenContainer padded={false}>
      <BangkeroScreenHeader title="Earnings" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.hint}>
          Completed trips. The fare is collected on board, so a trip counts when you close it out.
        </Text>

        <View style={styles.summaryGrid}>
          {tiles.map((t) => (
            <View key={t.label} style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>{t.label}</Text>
              <Text style={styles.summaryValue}>₱{t.value}</Text>
            </View>
          ))}
        </View>

        {payouts.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>RELEASED TO YOU</Text>
            <Text style={styles.payoutHint}>
              The 50% escrow BangkaGo paid out after each completed trip. Already counted above.
            </Text>
            {payouts.map((p) => (
              <View key={p.downpaymentId} style={styles.txRow}>
                <View style={styles.txLeft}>
                  <View style={[styles.txDot, { backgroundColor: colors.primary }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.txLabel} numberOfLines={1}>{p.label}</Text>
                    <Text style={styles.txRef} numberOfLines={1}>
                      {new Date(p.releasedAt).toLocaleDateString('en-PH', {
                        month: 'short', day: 'numeric',
                      })}
                      {' · '}
                      {p.payoutMethod === 'cash' ? 'Cash' : 'GCash'}
                      {p.payoutRef ? ` · ${p.payoutRef}` : ''}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.txAmount, { color: colors.primary }]} numberOfLines={1}>
                  +₱{p.amount.toFixed(2)}
                </Text>
              </View>
            ))}
          </>
        )}

        <Text style={styles.sectionLabel}>TRIP HISTORY</Text>

        {history.length === 0 ? (
          <EmptyState
            icon="cash"
            title="No completed trips yet"
            message="Each trip you close out adds its fare here."
          />
        ) : (
          history.map((t) => (
            <View key={t.bookingId} style={styles.txRow}>
              <View style={styles.txLeft}>
                <View style={[styles.txDot, { backgroundColor: colors.primary }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.txLabel} numberOfLines={1}>
                    {t.ref} · {t.fromPortName ?? '—'} → {t.toPortName ?? '—'}
                  </Text>
                  <Text style={styles.txRef} numberOfLines={1}>
                    {new Date(t.completedAt as string).toLocaleDateString('en-PH', {
                      month: 'short', day: 'numeric', year: 'numeric',
                    })}
                    {' · '}
                    {t.numOfPassenger} pax
                  </Text>
                </View>
              </View>
              <Text style={styles.txAmount} numberOfLines={1}>+₱{t.totalPrice}</Text>
            </View>
          ))
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  center: { flex: 1, justifyContent: 'center' },

  hint: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.lg },

  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  summaryCard: {
    flexBasis: '46%',
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
  },
  summaryLabel: { ...typography.label, marginBottom: spacing.sm },
  summaryValue: { flexShrink: 1, color: colors.text, fontSize: 18, fontWeight: '700' },

  sectionLabel: { ...typography.label, marginTop: spacing.xl, marginBottom: spacing.md },
  payoutHint: { ...typography.caption, color: colors.textMuted, marginTop: -spacing.sm, marginBottom: spacing.md },

  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  txLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flex: 1 },
  txDot: { width: 8, height: 8, borderRadius: 4 },
  txLabel: { flexShrink: 1, color: colors.text, fontSize: 14, fontWeight: '600' },
  txRef: { flexShrink: 1, ...typography.caption, color: colors.textMuted, fontSize: 11, marginTop: 2 },
  txAmount: { flexShrink: 1, color: colors.primary, fontSize: 15, fontWeight: '700' },
});
