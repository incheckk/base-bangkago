import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { ScreenContainer } from '@/components/ScreenContainer';
import { LoadingState } from '@/components/States';
import { getAdminStats } from '@/services/admin.service';
import type { AdminStats } from '@/services/admin.service';
import { colors, radii, spacing, typography } from '@/theme/tokens';
export default function Reports() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAdminStats()
      .then(setStats)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState />;

  const statCards = [
    { label: 'Total Users', value: stats?.totalUsers ?? 0, icon: '👥', color: colors.primary },
    { label: 'Active Bangkeros', value: stats?.activeBangkeros ?? 0, icon: '🚢', color: colors.warning },
    { label: 'Total Trips', value: stats?.totalTrips ?? 0, icon: '📋', color: colors.accent },
    { label: 'Total Revenue', value: `₱${(stats?.totalRevenue ?? 0).toLocaleString()}`, icon: '💰', color: colors.primary },
    { label: 'Trips Today', value: stats?.tripsToday ?? 0, icon: '📅', color: colors.primary },
    { label: 'Revenue Today', value: `₱${(stats?.revenueToday ?? 0).toLocaleString()}`, icon: '💵', color: colors.warning },
    { label: 'New Users (7d)', value: stats?.newUsersThisWeek ?? 0, icon: '📈', color: colors.accent },
    { label: 'Completed Today', value: stats?.completedTripsToday ?? 0, icon: '✅', color: colors.primary },
    { label: 'Pending Approvals', value: stats?.pendingApprovals ?? 0, icon: '⏳', color: colors.warning },
    { label: 'Active Alerts', value: stats?.activeAlerts ?? 0, icon: '🔔', color: colors.danger },
  ];

  return (
    <ScreenContainer padded={false}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.back} onPress={() => router.back()}>← Back</Text>
        <Text style={styles.title}>Reports & Analytics</Text>

        <View style={styles.grid}>
          {statCards.map((s) => (
            <View key={s.label} style={styles.statCard}>
              <Text style={styles.statIcon}>{s.icon}</Text>
              <Text style={[styles.statValue, { color: s.color }]}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  back: { color: colors.primary, fontSize: 14, fontWeight: '600', marginBottom: spacing.lg },
  title: { ...typography.h1, marginBottom: spacing.xl },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  statCard: {
    width: '47%',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.xs,
  },
  statIcon: { fontSize: 24 },
  statValue: { fontSize: 20, fontWeight: '800' },
  statLabel: { color: colors.textMuted, fontSize: 12, textAlign: 'center' },
});
