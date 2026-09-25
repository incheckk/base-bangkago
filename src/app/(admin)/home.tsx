import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AdminScreenHeader } from '@/components/AdminScreenHeader';
import { Icon, type IconName } from '@/components/Icon';
import { ScreenContainer } from '@/components/ScreenContainer';
import { StatusCard } from '@/components/StatusCard';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { useAdminStats } from '@/hooks/useAdminStats';
import { useAuth } from '@/hooks/useAuth';
import { colors, elevation, radii, spacing, touchTarget, typography } from '@/theme/tokens';

const QUICK_ACTIONS: { key: string; icon: IconName; label: string; route: string }[] = [
  { key: 'operators', icon: 'people', label: 'Manage Operators', route: '/(admin)/all-users' },
  { key: 'trips', icon: 'bookings', label: 'View Trips', route: '/(admin)/active-trips' },
  { key: 'fleet', icon: 'route', label: 'Fleet Overview', route: '/(admin)/fleet-overview' },
  { key: 'alerts', icon: 'alert', label: 'System Alerts', route: '/(admin)/alerts' },
];

export default function AdminHome() {
  const { profile } = useAuth();
  const stats = useAdminStats();

  const greetingTime = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  })();

  const s = stats.data;

  /**
   * Each metric carries its own colour. Previously all four cards used
   * `colors.warning` for both border and value, so "Active Bangkeros" — a
   * healthy number — looked exactly like an alert. Colour should mean
   * something, otherwise it is decoration that actively misleads.
   */
  const STAT_CARDS: { label: string; value: number; icon: IconName; tint: string; fill: string }[] = s
    ? [
        { label: 'Active Bangkeros', value: s.activeBangkeros, icon: 'boat', tint: colors.primary, fill: colors.primaryTint },
        { label: 'Trips Today', value: s.tripsToday, icon: 'bookings', tint: colors.info, fill: colors.infoTint },
        { label: 'Pending Approvals', value: s.pendingApprovals, icon: 'history', tint: colors.warning, fill: colors.warningTint },
        {
          label: 'Active Alerts',
          value: s.activeAlerts,
          icon: 'alert',
          // Zero alerts is good news, so it should not glow red.
          tint: s.activeAlerts > 0 ? colors.danger : colors.textSecondary,
          fill: s.activeAlerts > 0 ? colors.dangerTint : colors.surfaceAlt,
        },
      ]
    : [];

  return (
    <ScreenContainer padded={false}>
      {/* Outside the ScrollView: it mounts SideDrawer, whose overlay is
          absolutely positioned and would otherwise resolve against the scroll
          content instead of the screen. */}
      <AdminScreenHeader
        eyebrow="ADMIN"
        title={`${greetingTime}, ${profile?.firstName ?? 'Admin'}`}
        showBack={false}
        right={
          <Pressable
            onPress={() => router.push('/(admin)/profile')}
            accessibilityRole="button"
            accessibilityLabel="Profile"
            style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
          >
            <Icon name="profile" size={20} color={colors.text} />
          </Pressable>
        }
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>OVERVIEW</Text>

          {stats.loading ? (
            <View style={styles.stateBox}><LoadingState label="Loading stats…" /></View>
          ) : stats.error ? (
            <View style={styles.stateBox}><ErrorState message={stats.error} /></View>
          ) : (
            <View style={styles.statsGrid}>
              {STAT_CARDS.map((card) => (
                <View key={card.label} style={[styles.statCard, { borderColor: card.tint }]}>
                  <View style={[styles.statIconWrap, { backgroundColor: card.fill }]}>
                    <Icon name={card.icon} size={16} color={card.tint} />
                  </View>
                  <Text style={[styles.statValue, { color: card.tint }]}>{card.value}</Text>
                  <Text style={styles.statLabel} numberOfLines={2}>{card.label}</Text>
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
                onPress={() => router.push(action.route as never)}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                style={({ pressed }) => [styles.actionCard, pressed && styles.actionPressed]}
              >
                <View style={styles.actionIconWrap}>
                  <Icon name={action.icon} size={18} color={colors.warning} />
                </View>
                <Text style={styles.actionLabel} numberOfLines={1}>{action.label}</Text>
                <Icon name="forward" size={16} color={colors.textMuted} />
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>RECENT ALERTS</Text>
          {stats.loading ? (
            <View style={styles.stateBox}><LoadingState label="Checking alerts…" /></View>
          ) : s && s.activeAlerts > 0 ? (
            <StatusCard
              title="Active Alert"
              message={`${s.activeAlerts} active alert${s.activeAlerts === 1 ? '' : 's'} require attention.`}
              severity="high"
            />
          ) : (
            <View style={styles.emptyBox}>
              <EmptyState
                icon="check"
                title="All clear"
                message="No active alerts at this time."
              />
            </View>
          )}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: spacing.huge },

  iconBtn: {
    width: touchTarget, height: touchTarget,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: radii.pill,
    backgroundColor: colors.scrim,
    borderWidth: 1, borderColor: colors.borderSubtle,
    ...elevation.e1,
  },
  iconBtnPressed: { backgroundColor: colors.surfaceAlt },

  section: { paddingHorizontal: spacing.xl, marginBottom: spacing.huge },
  sectionLabel: { ...typography.label, marginBottom: spacing.md },

  // ---------- stat cards ----------
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  statCard: {
    // flexBasis + grow fills the row evenly instead of leaving a 6% orphan
    // strip, which is what a hardcoded `width: '47%'` left behind.
    flexBasis: '47%',
    flexGrow: 1,
    minWidth: 140,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: spacing.lg,
    gap: spacing.sm,
    ...elevation.e1,
  },
  statIconWrap: {
    width: 30, height: 30, borderRadius: radii.pill,
    alignItems: 'center', justifyContent: 'center',
  },
  statValue: { flexShrink: 1, ...typography.display, fontSize: 26 },
  statLabel: { flexShrink: 1, ...typography.caption, color: colors.textSecondary, fontWeight: '600' },

  // ---------- quick actions ----------
  actionsGrid: { gap: spacing.sm },
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.lg,
    minHeight: 60,
    gap: spacing.md,
    ...elevation.e1,
  },
  actionPressed: { borderColor: colors.warning, backgroundColor: colors.surfaceAlt },
  actionIconWrap: {
    width: 34, height: 34, borderRadius: radii.pill,
    backgroundColor: colors.warningTint,
    alignItems: 'center', justifyContent: 'center',
  },
  actionLabel: { ...typography.bodyStrong, flex: 1 },

  stateBox: { minHeight: 140 },

  emptyBox: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderStyle: 'dashed',
    minHeight: 180,
    justifyContent: 'center',
  },
});
