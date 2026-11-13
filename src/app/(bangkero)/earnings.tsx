import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BangkeroScreenHeader } from '@/components/BangkeroScreenHeader';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { LoadingState, ErrorState, EmptyState } from '@/components/States';
import { useAuth } from '@/hooks/useAuth';
import { useRealtimeQuery } from '@/hooks/useRealtimeQuery';
import { useWallet } from '@/hooks/useWallet';
import { type PayoutRow, getReleasedPayouts } from '@/services/downpayment.service';
import { manilaTodayIso } from '@/utils/date';
import { colors, radii, spacing, typography } from '@/theme/tokens';

const TX_TYPE_MAP: Record<string, { label: string; color: string }> = {
  credit: { label: 'Credit', color: colors.primary },
  debit: { label: 'Debit', color: colors.danger },
  top_up: { label: 'Top-up', color: colors.warning },
  withdrawal: { label: 'Withdrawal', color: colors.warning },
};

export default function BangkeroEarnings() {
  const { user } = useAuth();
  const { wallet, transactions, loading, error, topUp } = useWallet(user?.id ?? null);
  const [toppingUp, setToppingUp] = useState(false);
  const [topUpError, setTopUpError] = useState<string | null>(null);

  // 079: the held 50% the admin released to this boat's GCash/cash.
  const [payouts, setPayouts] = useState<PayoutRow[]>([]);
  const uid = user?.id ?? null;
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

  const todayIso = manilaTodayIso();
  const weekAgoIso = toManilaIso(new Date(Date.now() - 6 * 24 * 60 * 60 * 1000)) ?? todayIso;

  const todayCredits = transactions
    .filter((t) => t.type === 'credit' && toManilaIso(t.createdAt) === todayIso)
    .reduce((sum, t) => sum + t.amount, 0);

  const weekCredits = transactions
    .filter((t) => t.type === 'credit' && (toManilaIso(t.createdAt) ?? '') >= weekAgoIso)
    .reduce((sum, t) => sum + t.amount, 0);

  async function handleTopUp() {
    setToppingUp(true);
    setTopUpError(null);
    try {
      await topUp(500);
    } catch (e) {
      // Balance untouched (030 rolls back) — inline banner, not the
      // full-screen error state, so history stays visible for retry.
      setTopUpError(
        e instanceof Error ? e.message : 'Top-up failed — balance unchanged. Try again.'
      );
    }
    setToppingUp(false);
  }

  if (loading) {
    return (
      <ScreenContainer padded={false}>
        <BangkeroScreenHeader title="Earnings" />
        <View style={styles.center}>
          <LoadingState label="Loading earnings…" />
        </View>
      </ScreenContainer>
    );
  }

  if (error) {
    return (
      <ScreenContainer padded={false}>
        <BangkeroScreenHeader title="Earnings" />
        <View style={styles.center}>
          <ErrorState message={error} />
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padded={false}>
      <BangkeroScreenHeader title="Earnings" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Available Balance</Text>
          <Text style={styles.balanceAmount}>₱{wallet?.balance.toFixed(2) ?? '0.00'}</Text>
        </View>

        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Today&apos;s Earnings</Text>
            <Text style={styles.summaryValue}>₱{todayCredits.toFixed(2)}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>This Week</Text>
            <Text style={styles.summaryValue}>₱{weekCredits.toFixed(2)}</Text>
          </View>
        </View>

        <PrimaryButton
          label="Quick Top-Up ₱500"
          variant="secondary"
          onPress={handleTopUp}
          loading={toppingUp}
        />
        {!!topUpError && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>{topUpError}</Text>
          </View>
        )}

        {payouts.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>RELEASED TO YOU</Text>
            <Text style={styles.payoutHint}>
              The 50% escrow the admin paid out after each completed trip.
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

        <Text style={styles.sectionLabel}>TRANSACTION HISTORY</Text>

        {transactions.length === 0 ? (
          <EmptyState
            icon="cash"
            title="No transactions yet"
            message="Your earnings will appear here."
          />
        ) : (
          transactions.map((tx) => {
            const meta = TX_TYPE_MAP[tx.type] ?? { label: tx.type, color: colors.textSecondary };
            return (
              <View key={tx.transactionId} style={styles.txRow}>
                <View style={styles.txLeft}>
                  <View style={[styles.txDot, { backgroundColor: meta.color }]} />
                  <View>
                    <Text style={styles.txLabel}>{meta.label}</Text>
                    {tx.bookingId && (
                      <Text style={styles.txRef}>{tx.bookingId}</Text>
                    )}
                  </View>
                </View>
                <Text style={[styles.txAmount, { color: meta.color }]} numberOfLines={1}>
                  {tx.type === 'credit' || tx.type === 'top_up' ? '+' : '-'}₱{tx.amount.toFixed(2)}
                </Text>
              </View>
            );
          })
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

/** Manila calendar day (YYYY-MM-DD) for a timestamp, null when unknown. */
function toManilaIso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  center: { flex: 1, justifyContent: 'center' },

  balanceCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.primary,
    padding: spacing.xl,
    marginBottom: spacing.lg,
    alignItems: 'center',
  },
  balanceLabel: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.sm },
  balanceAmount: { flexShrink: 1, color: colors.primary, fontSize: 36, fontWeight: '700' },

  summaryRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  summaryCard: {
    flex: 1,
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

  banner: {
    backgroundColor: colors.dangerTint,
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  bannerText: { flexShrink: 1, color: colors.danger, fontSize: 13, lineHeight: 18 },

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
  txAmount: { flexShrink: 1, fontSize: 15, fontWeight: '700' },
});
