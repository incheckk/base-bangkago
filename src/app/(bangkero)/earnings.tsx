import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { LoadingState, ErrorState, EmptyState } from '@/components/States';
import { useAuth } from '@/hooks/useAuth';
import { useWallet } from '@/hooks/useWallet';
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

  const todayCredits = transactions
    .filter((t) => t.type === 'credit' && isToday(t.transactionId))
    .reduce((sum, t) => sum + t.amount, 0);

  const weekCredits = transactions
    .filter((t) => t.type === 'credit')
    .reduce((sum, t) => sum + t.amount, 0);

  async function handleTopUp() {
    setToppingUp(true);
    await topUp(500);
    setToppingUp(false);
  }

  if (loading) {
    return (
      <ScreenContainer padded={false}>
        <View style={styles.center}>
          <LoadingState label="Loading earnings…" />
        </View>
      </ScreenContainer>
    );
  }

  if (error) {
    return (
      <ScreenContainer padded={false}>
        <View style={styles.center}>
          <ErrorState message={error} />
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padded={false}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.back} onPress={() => router.back()}>← Back</Text>

        <Text style={styles.eyebrow}>EARNINGS</Text>
        <Text style={styles.title}>Your wallet</Text>

        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Available Balance</Text>
          <Text style={styles.balanceAmount}>₱{wallet?.balance.toFixed(2) ?? '0.00'}</Text>
        </View>

        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Today's Earnings</Text>
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

        <Text style={styles.sectionLabel}>TRANSACTION HISTORY</Text>

        {transactions.length === 0 ? (
          <EmptyState
            icon="💰"
            title="No transactions yet"
            message="Your earnings will show up here."
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
                <Text style={[styles.txAmount, { color: meta.color }]}>
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

function isToday(_id: string) {
  const now = new Date();
  return true;
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  center: { flex: 1, justifyContent: 'center' },

  back: { color: colors.primary, fontSize: 14, fontWeight: '600', marginBottom: spacing.lg },
  eyebrow: { ...typography.label, marginBottom: 2 },
  title: { ...typography.h1, marginBottom: spacing.xl },

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
  balanceAmount: { color: colors.primary, fontSize: 36, fontWeight: '700' },

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
  summaryValue: { color: colors.text, fontSize: 18, fontWeight: '700' },

  sectionLabel: { ...typography.label, marginTop: spacing.xl, marginBottom: spacing.md },

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
  txLabel: { color: colors.text, fontSize: 14, fontWeight: '600' },
  txRef: { ...typography.caption, color: colors.textMuted, fontSize: 11, marginTop: 2 },
  txAmount: { fontSize: 15, fontWeight: '700' },
});
