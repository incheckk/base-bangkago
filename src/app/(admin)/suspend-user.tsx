import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import { suspendUser } from '@/services/admin.service';

const ADMIN_ACCENT = '#F59E0B';

export default function SuspendUser() {
  const params = useLocalSearchParams<{ userId?: string; userName?: string; role?: string }>();
  const [loading, setLoading] = useState(false);

  const handleSuspend = async () => {
    if (!params.userId) return;
    Alert.alert(
      'Suspend User',
      `Are you sure you want to suspend ${params.userName ?? 'this user'}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Suspend',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              await suspendUser(params.userId!);
              Alert.alert('User Suspended', `${params.userName ?? 'User'} has been suspended.`, [
                { text: 'OK', onPress: () => router.back() },
              ]);
            } catch (e: any) {
              Alert.alert('Error', e.message ?? 'Failed to suspend user');
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  return (
    <ScreenContainer padded={false}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.back} onPress={() => router.back()}>← Back</Text>
        <Text style={styles.title}>Suspend User</Text>

        <View style={styles.warningCard}>
          <Text style={styles.warningIcon}>⚠️</Text>
          <Text style={styles.warningTitle}>Warning</Text>
          <Text style={styles.warningText}>
            Suspending this user will prevent them from logging in and using BangkaGo services. This action can be reversed by an admin.
          </Text>
        </View>

        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.label}>User</Text>
            <Text style={styles.value}>{params.userName ?? 'Unknown'}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.label}>Role</Text>
            <Text style={styles.value}>{params.role ?? 'Unknown'}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.label}>User ID</Text>
            <Text style={styles.valueSmall}>{params.userId ?? 'N/A'}</Text>
          </View>
        </View>

        <PrimaryButton
          label={loading ? 'Suspending...' : 'Suspend User'}
          onPress={handleSuspend}
          disabled={loading || !params.userId}
          variant="danger"
        />
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  back: { color: colors.primary, fontSize: 14, fontWeight: '600', marginBottom: spacing.lg },
  title: { ...typography.h1, marginBottom: spacing.xl },

  warningCard: {
    backgroundColor: '#E0525220',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: '#E05252',
    padding: spacing.lg,
    marginBottom: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
  },
  warningIcon: { fontSize: 32 },
  warningTitle: { color: '#E05252', fontSize: 16, fontWeight: '700' },
  warningText: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 18 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm },
  label: { ...typography.caption },
  value: { color: colors.text, fontSize: 14, fontWeight: '600' },
  valueSmall: { color: colors.textMuted, fontSize: 12 },
  divider: { height: 1, backgroundColor: colors.borderSubtle },
});
