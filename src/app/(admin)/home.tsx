import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AdminScreenHeader } from '@/components/AdminScreenHeader';
import { Icon } from '@/components/Icon';
import { ScreenContainer } from '@/components/ScreenContainer';
import { ErrorState, LoadingState } from '@/components/States';
import { SailingAdvisoryCard } from '@/components/SailingAdvisoryCard';
import { WeatherCard } from '@/components/WeatherCard';
import { useAdminStats } from '@/hooks/useAdminStats';
import { useAuth } from '@/hooks/useAuth';
import { useNotifications } from '@/hooks/useNotifications';
import { ADMIN_HOME_ENTRIES } from '@/config/menu';
import { STRAIT_POINT } from '@/services/weather.service';
import { colors, elevation, numeric, radii, spacing, touchTarget, typography } from '@/theme/tokens';

/**
 * The home rows ARE the drawer, minus Home (ADMIN_HOME_ENTRIES) — one list,
 * so a new admin screen can never land in the menu and be missing from the
 * console.
 */
const peso = (n: number) => `₱${n.toLocaleString('en-PH')}`;

export default function AdminHome() {
  const { profile, user } = useAuth();
  const stats = useAdminStats();
  const notifications = useNotifications(user?.id ?? null);

  const greetingTime = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  })();

  const s = stats.data;

  /**
   * Four figures on one strip, not four cards.
   *
   * The grid said each of these was its own object worth its own border,
   * shadow and icon chip — and then a separate "Needs attention" block
   * repeated two of the same numbers in tinted amber and red cards. One fact,
   * two places, three colours.
   *
   * The only colour left is a 6pt dot over a figure that is both non-zero and
   * someone's job. No tinted fills, no coloured borders, no coloured numbers.
   */
  const STATS: { label: string; value: number; route: string; flag?: string }[] = s
    ? [
        { label: 'Bangkeros', value: s.activeBangkeros, route: '/(admin)/operators' },
        { label: 'Trips today', value: s.tripsToday, route: '/(admin)/bookings' },
        {
          label: 'Pending', value: s.pendingApprovals, route: '/(admin)/operators',
          flag: s.pendingApprovals > 0 ? colors.warning : undefined,
        },
        {
          label: 'Alerts', value: s.activeAlerts, route: '/(admin)/system-alerts',
          flag: s.activeAlerts > 0 ? colors.danger : undefined,
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
          <View style={styles.headerRight}>
            <Pressable
              onPress={() => router.push('/(admin)/notifications')}
              accessibilityRole="button"
              accessibilityLabel={
                notifications.unreadCount > 0
                  ? `Notifications, ${notifications.unreadCount} unread`
                  : 'Notifications'
              }
              style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
            >
              <Icon name="bell" size={20} color={colors.text} />
              {notifications.unreadCount > 0 && (
                <View style={styles.notifBadge}>
                  <Text style={styles.notifBadgeText}>
                    {notifications.unreadCount > 9 ? '9+' : notifications.unreadCount}
                  </Text>
                </View>
              )}
            </Pressable>
            <Pressable
              onPress={() => router.push('/(admin)/profile')}
              accessibilityRole="button"
              accessibilityLabel="Profile"
              style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
            >
              <Icon name="profile" size={20} color={colors.text} />
            </Pressable>
          </View>
        }
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {stats.loading ? (
          <View style={styles.stateBox}><LoadingState label="Loading console…" /></View>
        ) : stats.error ? (
          <View style={styles.stateBox}><ErrorState message={stats.error} /></View>
        ) : (
          <>
            {/* Surface 1 of 2: everything the console knows, in one card.
                getAdminStats has always computed revenueToday, totalRevenue and
                completedTripsToday — queries run on every realtime refresh and
                then thrown away, because nothing rendered them. */}
            <View style={styles.section}>
              <View style={styles.summary}>
                <Text style={styles.heroLabel}>REVENUE TODAY</Text>
                <Text style={styles.heroValue} numberOfLines={1}>
                  {peso(s?.revenueToday ?? 0)}
                </Text>
                <Text style={styles.heroMeta} numberOfLines={1}>
                  {s?.completedTripsToday ?? 0} completed · {peso(s?.totalRevenue ?? 0)} all time
                </Text>

                <View style={styles.summaryRule} />

                <View style={styles.statStrip}>
                  {STATS.map((st, i) => (
                    <Pressable
                      key={st.label}
                      onPress={() => router.push(st.route as never)}
                      accessibilityRole="button"
                      accessibilityLabel={`${st.label}: ${st.value}`}
                      style={({ pressed }) => [styles.stat, pressed && styles.statPressed]}
                    >
                      {i > 0 && <View style={styles.statRule} />}
                      <Text style={styles.statValue} numberOfLines={1}>{st.value}</Text>
                      <View style={styles.statLabelRow}>
                        {!!st.flag && <View style={[styles.statDot, { backgroundColor: st.flag }]} />}
                        <Text style={styles.statLabel} numberOfLines={1}>{st.label}</Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              </View>
            </View>

            {/* Surface 2 of 2. Group labels sit outside the card so the card
                itself stays one unbroken list to run a thumb down. */}
            <View style={styles.weatherWrap}>
              <WeatherCard latitude={STRAIT_POINT.lat} longitude={STRAIT_POINT.lon} place="Mactan–Olango" />
            </View>

            <View style={styles.advisoryWrap}>
              <SailingAdvisoryCard role="admin" />
            </View>

            <View style={styles.section}>
              {ADMIN_HOME_ENTRIES.map((item, i) => {
                const first = i === 0;
                const startsGroup = !!item.section;
                return (
                  <View key={item.route}>
                    {startsGroup && (
                      <Text style={[styles.groupLabel, !first && styles.groupLabelGap]}>
                        {item.section}
                      </Text>
                    )}
                    <Pressable
                      onPress={() => router.push(item.route as never)}
                      accessibilityRole="button"
                      accessibilityLabel={item.label}
                      style={({ pressed }) => [
                        styles.row,
                        startsGroup && styles.rowFirst,
                        // The last row of a group, or of the list, closes the card.
                        (ADMIN_HOME_ENTRIES[i + 1]?.section || i === ADMIN_HOME_ENTRIES.length - 1) &&
                          styles.rowLast,
                        !startsGroup && styles.rowBorder,
                        pressed && styles.rowPressed,
                      ]}
                    >
                      <Icon name={item.icon} size={18} color={colors.textSecondary} />
                      <Text style={styles.rowLabel} numberOfLines={1}>{item.label}</Text>
                      <Icon name="forward" size={16} color={colors.textMuted} />
                    </Pressable>
                  </View>
                );
              })}
            </View>
          </>
        )}
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
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  notifBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifBadgeText: { color: colors.primaryText, fontSize: 9, fontWeight: '700' },

  section: { paddingHorizontal: spacing.xl, marginBottom: spacing.xl },
  weatherWrap: { paddingHorizontal: spacing.xl, marginBottom: spacing.lg },
  advisoryWrap: { paddingHorizontal: spacing.xl, marginBottom: spacing.lg },

  // ---------- summary card ----------
  summary: {
    backgroundColor: colors.bgElevated,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    ...elevation.e1,
  },
  heroLabel: { ...typography.label },
  // Plain white. A headline figure does not need colour to be the biggest
  // thing on the screen, and spending the accent here leaves nothing louder
  // for something that is actually wrong.
  heroValue: { ...typography.display, ...numeric, marginTop: spacing.xs },
  heroMeta: {
    flexShrink: 1, ...typography.caption, ...numeric,
    color: colors.textMuted, marginTop: spacing.xxs,
  },

  summaryRule: {
    height: 1,
    backgroundColor: colors.borderSubtle,
    marginVertical: spacing.lg,
  },

  statStrip: { flexDirection: 'row' },
  stat: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.xs,
    borderRadius: radii.sm,
  },
  statPressed: { backgroundColor: colors.surfaceAlt },
  // Hairlines between figures instead of four separate bordered cards.
  statRule: {
    position: 'absolute',
    left: 0, top: spacing.xs, bottom: spacing.xs,
    width: 1,
    backgroundColor: colors.borderSubtle,
  },
  statValue: { ...typography.h2, ...numeric },
  statLabelRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: spacing.xs, marginTop: spacing.xxs,
  },
  // The entire colour budget of this screen.
  statDot: { width: 6, height: 6, borderRadius: radii.pill },
  statLabel: {
    flexShrink: 1, ...typography.label,
    fontWeight: '400', letterSpacing: 0,
  },

  // ---------- manage list ----------
  groupLabel: { ...typography.label, marginBottom: spacing.sm },
  groupLabelGap: { marginTop: spacing.xl },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget + 6,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderLeftWidth: 1, borderRightWidth: 1,
    borderColor: colors.borderSubtle,
  },
  rowFirst: {
    borderTopWidth: 1,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
  },
  rowLast: {
    borderBottomWidth: 1,
    borderBottomLeftRadius: radii.lg,
    borderBottomRightRadius: radii.lg,
  },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  rowPressed: { backgroundColor: colors.surfaceAlt },
  rowLabel: { flex: 1, minWidth: 0, ...typography.bodyStrong },

  stateBox: { minHeight: 240, paddingHorizontal: spacing.xl },
});
