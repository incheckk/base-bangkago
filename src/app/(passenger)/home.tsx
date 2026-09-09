import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ScreenContainer } from '@/components/ScreenContainer';
import { SideDrawer } from '@/components/SideDrawer';
import { SeaMap } from '@/components/SeaMap';
import { useAuth } from '@/hooks/useAuth';
import { useAvailableBangkeroCount, usePorts, useRecentBookings } from '@/hooks/useSupabase';
import { useNotifications } from '@/hooks/useNotifications';
import { colors, radii, spacing, typography } from '@/theme/tokens';

const SERVICES = [
  { key: 'ride', icon: '⛵', label: 'Boat Ride', enabled: true },
  { key: 'island', icon: '🏝️', label: 'Island Hop', enabled: true },
  { key: 'padala', icon: '📦', label: 'Padala', enabled: false },
  { key: 'rental', icon: '🚤', label: 'Boat Rental', enabled: false },
] as const;

export default function PassengerHome() {
  const { user, profile } = useAuth();
  const ports = usePorts();
  const bangkeros = useAvailableBangkeroCount();
  const bookings = useRecentBookings(user?.id ?? null, 3);
  const notifications = useNotifications(user?.id ?? null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const greetingTime = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Magandang umaga';
    if (h < 17) return 'Magandang hapon';
    return 'Magandang gabi';
  })();

  return (
    <ScreenContainer padded={false}>
      <SideDrawer
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Menu"
        items={[
          { icon: '🏠', label: 'Home', onPress: () => {} },
          { icon: '📋', label: 'My Bookings', onPress: () => router.push('/(passenger)/bookings') },
          { icon: '🗺️', label: 'Trip History', onPress: () => router.push('/(passenger)/trips') },
          { icon: '💰', label: 'My Wallet', onPress: () => router.push('/(passenger)/wallet') },
          { icon: '🔔', label: 'Notifications', onPress: () => router.push('/(passenger)/notifications') },
          { icon: '👤', label: 'Profile', onPress: () => router.push('/(passenger)/profile') },
        ]}
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>{greetingTime},</Text>
            <Text style={styles.name}>{profile?.firstName ?? 'Traveler'} 👋</Text>
          </View>
          <View style={styles.headerRight}>
            <Pressable
              onPress={() => router.push('/(passenger)/notifications')}
              style={styles.notifBtn}
            >
              <Text style={styles.notifIcon}>🔔</Text>
              {notifications.unreadCount > 0 && (
                <View style={styles.notifBadge}>
                  <Text style={styles.notifBadgeText}>{notifications.unreadCount}</Text>
                </View>
              )}
            </Pressable>
            <Pressable onPress={() => setDrawerOpen(true)} hitSlop={8}>
              <Text style={styles.menuIcon}>☰</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.mapWrap}>
          {ports.error ? (
            <View style={styles.mapFallback}>
              <Text style={styles.mapFallbackText}>Map unavailable</Text>
            </View>
          ) : (
            <SeaMap ports={ports.data} height={180} />
          )}
          <View style={styles.badge}>
            <View style={[styles.dot, bangkeros.data === 0 && styles.dotOff]} />
            <Text style={styles.badgeText}>
              {bangkeros.loading
                ? 'Checking…'
                : bangkeros.data === 0
                  ? 'No boats online'
                  : `${bangkeros.data} boat${bangkeros.data === 1 ? '' : 's'} nearby`}
            </Text>
          </View>
        </View>

        <View style={styles.sheet}>
          <Text style={styles.sectionLabel}>QUICK ACTIONS</Text>
          <View style={styles.tiles}>
            {SERVICES.map((s) => (
              <Pressable
                key={s.key}
                disabled={!s.enabled}
                onPress={() => router.push('/(passenger)/quick-ride')}
                style={({ pressed }) => [
                  styles.tile,
                  !s.enabled && styles.tileDisabled,
                  pressed && s.enabled && styles.tilePressed,
                ]}
              >
                <Text style={[styles.tileIcon, !s.enabled && styles.tileIconDisabled]}>
                  {s.icon}
                </Text>
                <Text style={[styles.tileLabel, !s.enabled && styles.tileLabelDisabled]}>
                  {s.label}
                </Text>
                {!s.enabled && (
                  <View style={styles.soon}>
                    <Text style={styles.soonText}>Soon</Text>
                  </View>
                )}
              </Pressable>
            ))}
          </View>

          <View style={styles.quickBookBtn}>
            <Pressable
              onPress={() => router.push('/(passenger)/quick-ride')}
              style={({ pressed }) => [styles.bigBtn, pressed && styles.bigBtnPressed]}
            >
              <Text style={styles.bigBtnIcon}>🚤</Text>
              <View style={styles.bigBtnTextWrap}>
                <Text style={styles.bigBtnTitle}>BOOK A RIDE</Text>
                <Text style={styles.bigBtnSub}>Find available boats near you</Text>
              </View>
              <Text style={styles.bigBtnArrow}>→</Text>
            </Pressable>
          </View>

          <Text style={[styles.sectionLabel, { marginTop: spacing.xxl }]}>RECENT TRIPS</Text>
          {bookings.loading ? (
            <View style={styles.stateBox}><Text style={styles.loadingText}>Loading…</Text></View>
          ) : bookings.data.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyIcon}>⚓</Text>
              <Text style={styles.emptyTitle}>No trips yet</Text>
              <Text style={styles.emptyText}>Book a ride and it'll show up here.</Text>
            </View>
          ) : (
            <View style={styles.tripList}>
              {bookings.data.map((b) => (
                <Pressable
                  key={b.bookingId}
                  onPress={() => router.push(`/(passenger)/booking/${b.bookingId}`)}
                  style={({ pressed }) => [styles.trip, pressed && styles.tripPressed]}
                >
                  <View style={styles.tripTop}>
                    <Text style={styles.tripRoute} numberOfLines={1}>
                      {b.fromPortName} → {b.toPortName}
                    </Text>
                    <Text style={styles.tripFare}>₱{b.totalPrice}</Text>
                  </View>
                  <Text style={styles.tripDate}>
                    {new Date(b.createdAt).toLocaleDateString('en-PH', {
                      month: 'short', day: 'numeric',
                    })}
                  </Text>
                </Pressable>
              ))}
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
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.lg,
  },
  greeting: { ...typography.caption },
  name: { ...typography.h2, marginTop: 2 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  notifBtn: { position: 'relative', padding: spacing.sm },
  notifIcon: { fontSize: 22 },
  notifBadge: {
    position: 'absolute', top: 0, right: 0,
    backgroundColor: colors.danger, borderRadius: 10,
    minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4,
  },
  notifBadgeText: { color: colors.text, fontSize: 10, fontWeight: '700' },
  menuIcon: { fontSize: 24, color: colors.text, padding: spacing.sm },

  mapWrap: { paddingHorizontal: spacing.xl },
  mapFallback: {
    height: 180, borderRadius: radii.lg, backgroundColor: colors.bgElevated,
    borderWidth: 1, borderColor: colors.borderSubtle,
    alignItems: 'center', justifyContent: 'center',
  },
  mapFallbackText: { ...typography.caption, color: colors.textMuted },
  badge: {
    position: 'absolute', left: spacing.xl + spacing.md, top: spacing.md,
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: 'rgba(10,22,32,0.85)', borderRadius: radii.pill,
    paddingHorizontal: spacing.md, paddingVertical: 6,
    borderWidth: 1, borderColor: colors.borderSubtle,
  },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary },
  dotOff: { backgroundColor: colors.textMuted },
  badgeText: { color: colors.text, fontSize: 12, fontWeight: '600' },

  sheet: { paddingHorizontal: spacing.xl, marginTop: spacing.xl },
  sectionLabel: { ...typography.label, marginBottom: spacing.md },

  tiles: { flexDirection: 'row', gap: spacing.md },
  tile: {
    flex: 1, backgroundColor: colors.surface, borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.borderSubtle,
    paddingVertical: spacing.lg, paddingHorizontal: spacing.sm, alignItems: 'center',
  },
  tileDisabled: { opacity: 0.5 },
  tilePressed: { borderColor: colors.primary },
  tileIcon: { fontSize: 26, marginBottom: spacing.sm },
  tileIconDisabled: { opacity: 0.6 },
  tileLabel: { color: colors.text, fontSize: 12, fontWeight: '700', textAlign: 'center' },
  tileLabelDisabled: { color: colors.textMuted },
  soon: {
    marginTop: 4, backgroundColor: colors.surfaceAlt,
    borderRadius: radii.pill, paddingHorizontal: spacing.sm, paddingVertical: 2,
  },
  soonText: { color: colors.textMuted, fontSize: 9, fontWeight: '700' },

  quickBookBtn: { marginTop: spacing.xl },
  bigBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.primary, borderRadius: radii.md,
    paddingHorizontal: spacing.xl, paddingVertical: spacing.lg,
  },
  bigBtnPressed: { opacity: 0.85 },
  bigBtnIcon: { fontSize: 28 },
  bigBtnTextWrap: { flex: 1 },
  bigBtnTitle: { color: colors.primaryText, fontSize: 15, fontWeight: '800' },
  bigBtnSub: { color: colors.primaryText, fontSize: 12, opacity: 0.7, marginTop: 2 },
  bigBtnArrow: { color: colors.primaryText, fontSize: 22, fontWeight: '700' },

  stateBox: { minHeight: 120, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: colors.textMuted, fontSize: 13 },
  emptyBox: {
    backgroundColor: colors.surface, borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.borderSubtle,
    padding: spacing.xl, alignItems: 'center',
  },
  emptyIcon: { fontSize: 36, marginBottom: spacing.sm },
  emptyTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  emptyText: { ...typography.caption, marginTop: spacing.xs },

  tripList: { gap: spacing.md },
  trip: {
    backgroundColor: colors.surface, borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.borderSubtle, padding: spacing.lg,
  },
  tripPressed: { borderColor: colors.border },
  tripTop: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  tripRoute: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '600' },
  tripFare: { color: colors.primary, fontSize: 14, fontWeight: '700' },
  tripDate: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs },
});
