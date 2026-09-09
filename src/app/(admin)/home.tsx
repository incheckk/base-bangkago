import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ScreenContainer } from '@/components/ScreenContainer';
import { SideDrawer } from '@/components/SideDrawer';
import { StatusCard } from '@/components/StatusCard';
import { useAdminStats } from '@/hooks/useAdminStats';
import { useAuth } from '@/hooks/useAuth';
import { signOut } from '@/services/auth.service';
import { colors, radii, spacing, typography } from '@/theme/tokens';

const ADMIN_ACCENT = '#F59E0B';

const QUICK_ACTIONS = [
  { key: 'operators', icon: '🚤', label: 'Manage Operators', route: '/(admin)/all-users' },
  { key: 'trips', icon: '📋', label: 'View Trips', route: '/(admin)/active-trips' },
  { key: 'fleet', icon: '🗺️', label: 'Fleet Overview', route: '/(admin)/fleet-overview' },
  { key: 'alerts', icon: '🚨', label: 'System Alerts', route: '/(admin)/alerts' },
] as const;

export default function AdminHome() {
  const { profile } = useAuth();
  const stats = useAdminStats();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const greetingTime = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  })();

  const s = stats.data;

  const STAT_CARDS = s
    ? [
        { label: 'Active Bangkeros', value: s.activeBangkeros, icon: '🚤' },
        { label: 'Trips Today', value: s.tripsToday, icon: '📋' },
        { label: 'Pending Approvals', value: s.pendingApprovals, icon: '⏳' },
        { label: 'Active Alerts', value: s.activeAlerts, icon: '🚨' },
      ]
    : [];

  return (
    <ScreenContainer padded={false}>
      <SideDrawer
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Admin Menu"
        items={[
          { icon: '🏠', label: 'Home', onPress: () => {} },
          { icon: '🚤', label: 'Manage Operators', onPress: () => router.push('/(admin)/all-users') },
          { icon: '👥', label: 'All Users', onPress: () => router.push('/(admin)/all-users') },
          { icon: '📋', label: 'Active Trips', onPress: () => router.push('/(admin)/active-trips') },
          { icon: '🗺️', label: 'Fleet Overview', onPress: () => router.push('/(admin)/fleet-overview') },
          { icon: '🚨', label: 'System Alerts', onPress: () => router.push('/(admin)/alerts') },
          { icon: '👤', label: 'Profile', onPress: () => router.push('/(admin)/profile') },
          { icon: '🚪', label: 'Sign Out', onPress: () => signOut(), danger: true },
        ]}
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View>
            <Text style={styles.adminLabel}>ADMIN</Text>
            <Text style={styles.greeting}>{greetingTime},</Text>
            <Text style={styles.name}>{profile?.firstName ?? 'Admin'} 👋</Text>
          </View>
          <View style={styles.headerRight}>
            <Pressable onPress={() => router.push('/(admin)/profile')} style={styles.profileBtn}>
              <Text style={styles.profileIcon}>👤</Text>
            </Pressable>
            <Pressable onPress={() => setDrawerOpen(true)} hitSlop={8}>
              <Text style={styles.menuIcon}>☰</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>OVERVIEW</Text>
          {stats.loading ? (
            <View style={styles.stateBox}>
              <Text style={styles.loadingText}>Loading stats…</Text>
            </View>
          ) : (
            <View style={styles.statsGrid}>
              {STAT_CARDS.map((card) => (
                <View key={card.label} style={styles.statCard}>
                  <Text style={styles.statIcon}>{card.icon}</Text>
                  <Text style={styles.statValue}>{card.value}</Text>
                  <Text style={styles.statLabel}>{card.label}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>QUICK ACTIONS</Text>
          <View style={styles.actionsGrid}>
            {QUICK_ACTIONS.map((action) => (
              <Pressable
                key={action.key}
                onPress={() => router.push(action.route as any)}
                style={({ pressed }) => [styles.actionCard, pressed && styles.actionPressed]}
              >
                <Text style={styles.actionIcon}>{action.icon}</Text>
                <Text style={styles.actionLabel}>{action.label}</Text>
                <Text style={styles.actionArrow}>→</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>RECENT ALERTS</Text>
          {s && s.activeAlerts > 0 ? (
            <StatusCard
              title="Active Alert"
              message={`${s.activeAlerts} active alert${s.activeAlerts === 1 ? '' : 's'} require attention.`}
              severity="high"
            />
          ) : (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyIcon}>✅</Text>
              <Text style={styles.emptyTitle}>All Clear</Text>
              <Text style={styles.emptyText}>No active alerts at this time.</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: spacing.xxl },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
  },
  adminLabel: {
    ...typography.label,
    color: ADMIN_ACCENT,
    marginBottom: spacing.xs,
    letterSpacing: 2,
  },
  greeting: { ...typography.caption },
  name: { ...typography.h2, marginTop: 2 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  profileBtn: { padding: spacing.sm },
  profileIcon: { fontSize: 22 },
  menuIcon: { fontSize: 24, color: colors.text, padding: spacing.sm },

  section: { paddingHorizontal: spacing.xl, marginBottom: spacing.xl },
  sectionLabel: { ...typography.label, marginBottom: spacing.md },

  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  statCard: {
    width: '47%',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: ADMIN_ACCENT,
    padding: spacing.lg,
  },
  statIcon: { fontSize: 22, marginBottom: spacing.sm },
  statValue: {
    color: ADMIN_ACCENT,
    fontSize: 28,
    fontWeight: '800',
    marginBottom: spacing.xs,
  },
  statLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },

  actionsGrid: { gap: spacing.md },
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    gap: spacing.md,
  },
  actionPressed: { borderColor: ADMIN_ACCENT },
  actionIcon: { fontSize: 22 },
  actionLabel: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '600' },
  actionArrow: { color: colors.textMuted, fontSize: 18 },

  stateBox: { minHeight: 80, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: colors.textMuted, fontSize: 13 },

  emptyBox: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyIcon: { fontSize: 32, marginBottom: spacing.sm },
  emptyTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  emptyText: { ...typography.caption, marginTop: spacing.xs },
});
