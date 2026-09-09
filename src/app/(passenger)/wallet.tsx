import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { ScreenContainer } from '@/components/ScreenContainer';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { useAuth } from '@/hooks/useAuth';
import { useWallet } from '@/hooks/useWallet';
import { colors, radii, spacing, typography } from '@/theme/tokens';

export default function WalletScreen() {
  const { user } = useAuth();
  const { wallet, transactions, loading, error } = useWallet(user?.id ?? null);
  // Note: useWallet is designed for bangkero wallets. For passengers, the mock
  // data returns a generic wallet. Replace with a usePassengerWallet hook when
  // the Supabase backend is wired up.

  if (loading) {
    return (
      <ScreenContainer>
        <LoadingState label="Loading wallet…" />
      </ScreenContainer>
    );
  }

  if (error) {
    return (
      <ScreenContainer>
        <ErrorState message={error} />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padded={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.back} onPress={() => router.back()}>← Back</Text>
        <Text style={styles.eyebrow}>WALLET</Text>
        <Text style={styles.title}>My Wallet</Text>

        {/* Balance card */}
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Available Balance</Text>
          <Text style={styles.balanceAmount}>₱{wallet?.balance.toFixed(2) ?? '0.00'}</Text>
        </View>

        {/* Transaction history */}
        <Text style={styles.sectionTitle}>Transaction History</Text>

        {transactions.length === 0 ? (
          <EmptyState
            icon="💰"
            title="No transactions"
            message="Your wallet transactions will appear here."
          />
        ) : (
          <View style={styles.list}>
            {transactions.map((tx) => (
              <View key={tx.transactionId} style={styles.txCard}>
                <View style={styles.txLeft}>
                  <View style={[styles.txIcon, tx.type === 'credit' || tx.type === 'top_up' ? styles.txIconCredit : styles.txIconDebit]}>
                    <Text style={styles.txIconText}>
                      {tx.type === 'credit' || tx.type === 'top_up' ? '+' : '-'}
                    </Text>
                  </View>
                  <View>
                    <Text style={styles.txType}>{formatTxType(tx.type)}</Text>
                    {tx.bookingId && (
                      <Text style={styles.txRef}>Booking: {tx.bookingId.slice(0, 8)}</Text>
                    )}
                  </View>
                </View>
                <Text style={[styles.txAmount, tx.type === 'credit' || tx.type === 'top_up' ? styles.txCredit : styles.txDebit]}>
                  {tx.type === 'credit' || tx.type === 'top_up' ? '+' : '-'}₱{tx.amount.toFixed(2)}
                </Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

function formatTxType(type: string) {
  switch (type) {
    case 'credit': return 'Trip earning';
    case 'debit': return 'Withdrawal';
    case 'top_up': return 'Top up';
    case 'withdrawal': return 'Withdrawal';
    default: return type;
  }
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl, flexGrow: 1 },
  back: { color: colors.primary, fontSize: 14, fontWeight: '600', marginBottom: spacing.lg },
  eyebrow: { ...typography.label, marginBottom: 2 },
  title: { ...typography.h1, marginBottom: spacing.xl },
  balanceCard: {
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
    padding: spacing.xl,
    marginBottom: spacing.xl,
    alignItems: 'center',
  },
  balanceLabel: { color: colors.primaryText, fontSize: 13, fontWeight: '600', marginBottom: spacing.xs },
  balanceAmount: { color: colors.primaryText, fontSize: 32, fontWeight: '700' },
  sectionTitle: { ...typography.h2, marginBottom: spacing.md },
  list: { gap: spacing.sm },
  txCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
  },
  txLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  txIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  txIconCredit: { backgroundColor: 'rgba(52,214,176,0.14)' },
  txIconDebit: { backgroundColor: 'rgba(224,82,82,0.14)' },
  txIconText: { fontSize: 16, fontWeight: '700', color: colors.text },
  txType: { color: colors.text, fontSize: 14, fontWeight: '600' },
  txRef: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  txAmount: { fontSize: 15, fontWeight: '700' },
  txCredit: { color: colors.primary },
  txDebit: { color: colors.danger },
});
