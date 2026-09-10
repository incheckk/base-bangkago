import { router } from 'expo-router';
import { useState } from 'react';
import { Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolateColor, useAnimatedStyle, useSharedValue, withSpring, withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/components/Icon';
import { SeaMap } from '@/components/SeaMap';
import { SideDrawer } from '@/components/SideDrawer';
import { EmptyState, LoadingState } from '@/components/States';
import { MENU_TITLE, menuFor } from '@/config/menu';
import { useAuth } from '@/hooks/useAuth';
import { useNotifications } from '@/hooks/useNotifications';
import { useAvailableBangkeroCount, usePorts, useRecentBookings } from '@/hooks/useSupabase';
import { colors, elevation, radii, spacing, touchTarget, typography } from '@/theme/tokens';
import type { PortDoc } from '@/types/models';

const SCREEN_H = Dimensions.get('window').height;

/**
 * Two snap points.
 *
 * The sheet is always rendered at its full expanded height and slid down by
 * `translateY` — animating a transform runs on the UI thread, whereas animating
 * `height` would relayout every frame.
 *
 * COLLAPSED shows the service tiles and the CTA only, leaving the map dominant.
 * EXPANDED brings Recent Trips into view.
 */
const SHEET_EXPANDED = Math.round(SCREEN_H * 0.72);
const SHEET_COLLAPSED = 232;
const DRAG_RANGE = SHEET_EXPANDED - SHEET_COLLAPSED;

const SERVICES: { key: string; icon: IconName; label: string; enabled: boolean }[] = [
  { key: 'ride', icon: 'boat', label: 'Boat Ride', enabled: true },
  { key: 'island', icon: 'island', label: 'Island Hop', enabled: true },
  { key: 'padala', icon: 'parcel', label: 'Padala', enabled: false },
  { key: 'rental', icon: 'rental', label: 'Boat Rental', enabled: false },
];

export default function PassengerHome() {
  const insets = useSafeAreaInsets();
  const { user, profile } = useAuth();
  const ports = usePorts();
  const bangkeros = useAvailableBangkeroCount();
  const bookings = useRecentBookings(user?.id ?? null, 3);
  const notifications = useNotifications(user?.id ?? null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedPort, setSelectedPort] = useState<PortDoc | null>(null);

  // Starts collapsed so the map reads as the main surface on first open.
  const translateY = useSharedValue(DRAG_RANGE);
  const dragStart = useSharedValue(DRAG_RANGE);
  const dragProgress = useSharedValue(0);

  const snapTo = (expanded: boolean) => {
    'worklet';
    translateY.value = withSpring(expanded ? 0 : DRAG_RANGE, {
      damping: 22, stiffness: 220, overshootClamping: true,
    });
  };

  /**
   * The gesture lives on the handle only, not the whole sheet. Attaching it to
   * the sheet would fight the ScrollView inside it for the same vertical drag.
   */
  const pan = Gesture.Pan()
    .onStart(() => {
      dragStart.value = translateY.value;
      dragProgress.value = withTiming(1, { duration: 120 });
    })
    .onUpdate((e) => {
      translateY.value = Math.min(Math.max(dragStart.value + e.translationY, 0), DRAG_RANGE);
    })
    .onEnd((e) => {
      // A decisive flick wins over position; otherwise snap to the nearer point.
      const expand = e.velocityY < -400
        || (e.velocityY < 400 && translateY.value < DRAG_RANGE / 2);
      snapTo(expand);
      dragProgress.value = withTiming(0, { duration: 180 });
    });

  const tap = Gesture.Tap().onEnd(() => {
    snapTo(translateY.value > DRAG_RANGE / 2);
  });

  const handleGesture = Gesture.Exclusive(pan, tap);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  // Callout rides above the sheet as it moves, so it never slides underneath.
  const calloutStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -(DRAG_RANGE - translateY.value) }],
  }));

  // Handle lights up and widens while held, confirming the drag registered.
  const grabberStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      dragProgress.value, [0, 1], [colors.textMuted, colors.primary]
    ),
    transform: [{ scaleX: 1 + dragProgress.value * 0.18 }],
  }));

  const greetingTime = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Magandang umaga';
    if (h < 17) return 'Magandang hapon';
    return 'Magandang gabi';
  })();

  return (
    <View style={styles.root}>
      {/* Map is the page, not a card on it. Everything else floats above. */}
      {ports.error ? (
        <View style={styles.mapFallback}>
          <Text style={styles.mapFallbackText}>Map unavailable</Text>
        </View>
      ) : (
        <SeaMap
          ports={ports.data}
          fill
          onPortPress={(p) => setSelectedPort((cur) => (cur?.portId === p.portId ? null : p))}
          selectedPortId={selectedPort?.portId ?? null}
        />
      )}

      <SideDrawer
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={MENU_TITLE.passenger}
        items={menuFor('passenger')}
      />

      {/* ---------- floating header ---------- */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.greetCard}>
          <Text style={styles.greeting}>{greetingTime},</Text>
          <Text style={styles.name} numberOfLines={1}>
            {profile?.firstName ?? 'Traveler'} 👋
          </Text>
        </View>

        <View style={styles.headerRight}>
          <Pressable
            onPress={() => router.push('/(passenger)/notifications')}
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
            onPress={() => setDrawerOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Open menu"
            style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
          >
            <Icon name="menu" size={22} color={colors.text} />
          </Pressable>
        </View>
      </View>

      {/* ---------- boats-online pill ---------- */}
      <View style={[styles.statusPill, { top: insets.top + 78 }]}>
        <View style={[styles.dot, bangkeros.data === 0 && styles.dotOff]} />
        <Text style={styles.statusText}>
          {bangkeros.loading
            ? 'Checking…'
            : bangkeros.data === 0
              ? 'No boats online'
              : `${bangkeros.data} boat${bangkeros.data === 1 ? '' : 's'} nearby`}
        </Text>
      </View>

      {/* ---------- tapped-port callout ---------- */}
      {selectedPort && (
        <Animated.View style={[styles.callout, calloutStyle]}>
          <View style={styles.calloutBody}>
            <Text style={styles.calloutLabel}>PORT</Text>
            <Text style={styles.calloutName} numberOfLines={1}>{selectedPort.portName}</Text>
            {!!selectedPort.location && (
              <Text style={styles.calloutMeta} numberOfLines={1}>{selectedPort.location}</Text>
            )}
          </View>
          <Pressable
            onPress={() => router.push('/(passenger)/quick-ride')}
            style={({ pressed }) => [styles.calloutBtn, pressed && styles.calloutBtnPressed]}
          >
            <Text style={styles.calloutBtnText}>Book</Text>
          </Pressable>
        </Animated.View>
      )}

      {/* ---------- bottom sheet ---------- */}
      <Animated.View style={[styles.sheet, sheetStyle]}>
        <GestureDetector gesture={handleGesture}>
          {/* Padded well beyond the 4pt bar so the drag target is finger-sized. */}
          <View style={styles.handleZone}>
            <Animated.View style={[styles.grabber, grabberStyle]} />
          </View>
        </GestureDetector>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.sheetScroll,
            { paddingBottom: insets.bottom + spacing.xl },
          ]}
        >
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
                <Icon
                  name={s.icon}
                  size={20}
                  color={s.enabled ? colors.primary : colors.textMuted}
                  style={styles.tileIcon}
                />
                <Text
                  style={[styles.tileLabel, !s.enabled && styles.tileLabelDisabled]}
                  numberOfLines={1}
                >
                  {s.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <Pressable
            onPress={() => router.push('/(passenger)/quick-ride')}
            style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
          >
            <View style={styles.ctaIconWrap}>
              <Icon name="ride" size={20} color={colors.primaryText} />
            </View>
            <View style={styles.ctaTextWrap}>
              <Text style={styles.ctaTitle}>BOOK A RIDE</Text>
              <Text style={styles.ctaSub}>Find available boats near you</Text>
            </View>
            <Icon name="forward" size={20} color={colors.primaryText} />
          </Pressable>

          <View style={styles.sectionHead}>
            <Text style={styles.sectionLabel}>RECENT TRIPS</Text>
            {bookings.data.length > 0 && (
              <Pressable onPress={() => router.push('/(passenger)/trips')} hitSlop={12}>
                <Text style={styles.sectionAction}>See all</Text>
              </Pressable>
            )}
          </View>

          {bookings.loading ? (
            <View style={styles.stateBox}><LoadingState label="Loading your trips…" /></View>
          ) : bookings.data.length === 0 ? (
            <View style={styles.stateBox}>
              <EmptyState
                icon="⚓"
                title="No trips yet"
                message="Book a ride and it'll show up here."
              />
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
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  mapFallback: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.bgElevated,
    alignItems: 'center', justifyContent: 'center',
  },
  mapFallbackText: { ...typography.caption, color: colors.textMuted },

  // ---------- header ----------
  header: {
    position: 'absolute', left: 0, right: 0, top: 0,
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  // Text over a map needs its own ground or it becomes unreadable the moment
  // a coastline passes behind it.
  greetCard: {
    backgroundColor: colors.scrim,
    borderRadius: radii.lg,
    borderWidth: 1, borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    flexShrink: 1,
    ...elevation.e1,
  },
  greeting: { ...typography.caption, color: colors.textMuted, fontSize: 11 },
  name: { ...typography.title, marginTop: spacing.xxs },

  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  iconBtn: {
    position: 'relative',
    width: touchTarget, height: touchTarget,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: radii.pill,
    backgroundColor: colors.scrim,
    borderWidth: 1, borderColor: colors.borderSubtle,
    ...elevation.e1,
  },
  iconBtnPressed: { backgroundColor: colors.surfaceAlt },
  notifBadge: {
    position: 'absolute', top: 1, right: 1,
    backgroundColor: colors.danger, borderRadius: radii.pill,
    minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: spacing.xs,
    borderWidth: 2, borderColor: colors.bg,
  },
  notifBadgeText: { ...typography.micro, fontSize: 10 },

  // ---------- floating status pill ----------
  statusPill: {
    position: 'absolute', left: spacing.lg,
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.scrim, borderRadius: radii.pill,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm - 1,
    borderWidth: 1, borderColor: colors.borderSubtle,
    ...elevation.e1,
  },
  dot: { width: 7, height: 7, borderRadius: radii.pill, backgroundColor: colors.primary },
  dotOff: { backgroundColor: colors.textMuted },
  statusText: { ...typography.caption, color: colors.text, fontWeight: '600' },

  // ---------- port callout ----------
  callout: {
    position: 'absolute', left: spacing.lg, right: spacing.lg,
    bottom: SHEET_COLLAPSED + spacing.md,
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.lg,
    borderWidth: 1, borderColor: colors.primary,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    ...elevation.e3,
  },
  calloutBody: { flex: 1 },
  calloutLabel: { ...typography.label, color: colors.primary },
  calloutName: { ...typography.bodyStrong, marginTop: spacing.xxs },
  calloutMeta: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xxs },
  calloutBtn: {
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    height: 36, minWidth: 72,
    alignItems: 'center', justifyContent: 'center',
  },
  calloutBtnPressed: { backgroundColor: colors.primaryDark },
  calloutBtnText: { ...typography.caption, color: colors.primaryText, fontWeight: '800' },

  // ---------- bottom sheet ----------
  sheet: {
    position: 'absolute', left: 0, right: 0,
    // Anchored flush to the bottom. translateY then slides it DOWN by at most
    // DRAG_RANGE, so the visible height is never less than SHEET_COLLAPSED.
    // (A negative `bottom` here would double-count the offset and bury the sheet.)
    bottom: 0,
    height: SHEET_EXPANDED,
    backgroundColor: colors.bg,
    borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl,
    borderTopWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    ...elevation.e3,
  },
  handleZone: {
    alignItems: 'center',
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    marginHorizontal: -spacing.lg, // full-width drag strip
  },
  // `colors.border` here was invisible: #24404D on a #0A1620 ground is barely a
  // shade apart. A grab handle has to advertise itself, so it uses a text-level
  // colour rather than a border-level one.
  grabber: {
    width: 48, height: 5, borderRadius: radii.pill,
    backgroundColor: colors.textMuted,
  },
  sheetScroll: {},

  // ---------- compact service tiles ----------
  tiles: { flexDirection: 'row', gap: spacing.sm },
  tile: {
    flex: 1,
    backgroundColor: colors.surface, borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.borderSubtle,
    paddingVertical: spacing.md, paddingHorizontal: spacing.xs,
    alignItems: 'center', justifyContent: 'center',
    ...elevation.e1,
  },
  tileDisabled: { opacity: 0.4, shadowOpacity: 0, elevation: 0 },
  tilePressed: { borderColor: colors.primary, backgroundColor: colors.surfaceAlt },
  tileIcon: { fontSize: 18, marginBottom: spacing.xs },
  tileLabel: { ...typography.label, color: colors.text, letterSpacing: 0, fontSize: 10 },
  tileLabelDisabled: { color: colors.textMuted },

  // ---------- CTA ----------
  cta: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.primary, borderRadius: radii.lg,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    marginTop: spacing.md,
    minHeight: 60,
    ...elevation.e2,
  },
  ctaPressed: { backgroundColor: colors.primaryDark },
  ctaIconWrap: {
    width: 36, height: 36, borderRadius: radii.pill,
    backgroundColor: 'rgba(4,36,29,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  ctaTextWrap: { flex: 1 },
  ctaTitle: {
    ...typography.bodyStrong, color: colors.primaryText,
    fontWeight: '800', letterSpacing: 0.3,
  },
  ctaSub: {
    ...typography.caption, color: colors.primaryText,
    opacity: 0.75, marginTop: spacing.xxs, fontSize: 12,
  },

  // ---------- recent trips ----------
  sectionHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: spacing.xl, marginBottom: spacing.sm,
  },
  sectionLabel: { ...typography.label },
  sectionAction: { ...typography.caption, color: colors.primary, fontWeight: '600' },

  stateBox: { minHeight: 140 },

  tripList: { gap: spacing.sm },
  trip: {
    backgroundColor: colors.surface, borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    ...elevation.e1,
  },
  tripPressed: { borderColor: colors.primary, backgroundColor: colors.surfaceAlt },
  tripTop: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  tripRoute: { ...typography.caption, color: colors.text, fontWeight: '600', flex: 1 },
  tripFare: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  tripDate: { ...typography.caption, color: colors.textMuted, fontSize: 11, marginTop: spacing.xxs },
});
