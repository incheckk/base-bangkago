import { usePathname } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ICONS, Icon, type IconName } from './Icon';
import { normalizeRoute } from '../config/menu';
import { colors, elevation, radii, spacing, touchTarget, typography } from '../theme/tokens';

interface DrawerItem {
  /** An `IconName` renders a vector icon. Any other string falls back to text,
   *  so screens still passing emoji keep working until they are migrated. */
  icon: IconName | string;
  label: string;
  onPress: () => void;
  danger?: boolean;
  route?: string;
  section?: string;
  pinned?: boolean;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  items: DrawerItem[];
  title?: string;
}

const SCREEN_WIDTH = Dimensions.get('window').width;
const DRAWER_WIDTH = Math.min(SCREEN_WIDTH * 0.78, 320);

const isIconName = (s: string): s is IconName => s in ICONS;

export function SideDrawer({ visible, onClose, items, title }: Props) {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();

  /**
   * `visible` alone cannot drive mounting: unmounting the moment it flips false
   * would cut the close animation off before its first frame. `mounted` keeps
   * the drawer alive until the exit transition actually finishes.
   */
  const [mounted, setMounted] = useState(visible);
  const progress = useSharedValue(visible ? 1 : 0);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      progress.value = withTiming(1, {
        duration: 280,
        easing: Easing.out(Easing.cubic), // decelerate in — feels like it settles
      });
    } else {
      progress.value = withTiming(
        0,
        { duration: 220, easing: Easing.in(Easing.cubic) },
        (finished) => { if (finished) runOnJS(setMounted)(false); }
      );
    }
  }, [visible, progress]);

  // Drag left to dismiss. activeOffsetX keeps a vertical scroll from stealing it.
  const pan = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .onUpdate((e) => {
      progress.value = Math.max(0, Math.min(1, 1 + Math.min(e.translationX, 0) / DRAWER_WIDTH));
    })
    .onEnd((e) => {
      const close = e.velocityX < -500 || (e.velocityX < 200 && progress.value < 0.6);
      if (close) {
        progress.value = withTiming(0, { duration: 200 }, (f) => { if (f) runOnJS(onClose)(); });
      } else {
        progress.value = withTiming(1, { duration: 180, easing: Easing.out(Easing.cubic) });
      }
    });

  const drawerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(progress.value, [0, 1], [-DRAWER_WIDTH, 0]) }],
  }));

  // Backdrop fades with the slide instead of snapping on and off.
  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));

  if (!mounted) return null;

  const scrolling = items.filter((i) => !i.pinned);
  const pinned = items.filter((i) => i.pinned);

  const renderItem = (item: DrawerItem, key: string) => {
    const current = !!item.route && normalizeRoute(item.route) === pathname;
    return (
      <Pressable
        key={key}
        onPress={() => { item.onPress(); onClose(); }}
        accessibilityRole="button"
        accessibilityLabel={item.label}
        accessibilityState={{ selected: current }}
        style={({ pressed }) => [
          styles.item,
          current && styles.itemCurrent,
          pressed && styles.itemPressed,
        ]}
      >
        {/* A rail on the active row, not a filled pill: it marks where you are
            without turning one menu entry into the loudest thing on screen. */}
        {current && <View style={styles.currentRail} />}
        <View style={styles.iconSlot}>
          {isIconName(item.icon) ? (
            <Icon
              name={item.icon}
              size={20}
              color={
                item.danger ? colors.danger : current ? colors.primary : colors.textSecondary
              }
            />
          ) : (
            <Text style={styles.emojiIcon}>{item.icon}</Text>
          )}
        </View>
        <Text
          style={[
            styles.label,
            current && styles.labelCurrent,
            item.danger && styles.labelDanger,
          ]}
          numberOfLines={1}
        >
          {item.label}
        </Text>
      </Pressable>
    );
  };

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <Animated.View style={[styles.backdrop, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close menu" />
      </Animated.View>

      <GestureDetector gesture={pan}>
        <Animated.View
          style={[
            styles.drawer,
            { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.sm },
            drawerStyle,
          ]}
        >
          {!!title && <Text style={styles.title}>{title}</Text>}

          {/*
            This was a plain View. The admin menu runs to sixteen rows, which
            overflows an 812pt screen, so its last entries — Developer Options
            and Sign out — simply could not be reached: the role with the most
            screens was the one role that could not sign out.
          */}
          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listInner}
            showsVerticalScrollIndicator={false}
          >
            {scrolling.map((item, i) => (
              <React.Fragment key={`${item.label}-${i}`}>
                {!!item.section && (
                  <Text style={[styles.sectionLabel, i > 0 && styles.sectionLabelGap]}>
                    {item.section}
                  </Text>
                )}
                {renderItem(item, `${item.label}-${i}`)}
              </React.Fragment>
            ))}
          </ScrollView>

          {pinned.length > 0 && (
            <View style={styles.footer}>
              {pinned.map((item, i) => renderItem(item, `pinned-${item.label}-${i}`))}
            </View>
          )}

          <View style={styles.grip} />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, zIndex: 1000 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.backdrop },

  drawer: {
    position: 'absolute',
    left: 0, top: 0, bottom: 0,
    width: DRAWER_WIDTH,
    backgroundColor: colors.bgElevated,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    borderTopRightRadius: radii.xl,
    borderBottomRightRadius: radii.xl,
    paddingHorizontal: spacing.md,
    ...elevation.e3,
  },
  title: {
    ...typography.label,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },

  list: { flex: 1 },
  listInner: { gap: spacing.xxs, paddingBottom: spacing.sm },

  sectionLabel: {
    ...typography.label,
    color: colors.textMuted,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xs,
  },
  sectionLabelGap: { marginTop: spacing.lg },

  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
  },
  itemPressed: { backgroundColor: colors.surfaceAlt },
  itemCurrent: { backgroundColor: colors.primaryTint },
  currentRail: {
    position: 'absolute',
    left: 0, top: spacing.sm, bottom: spacing.sm,
    width: 3,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
  },
  // Fixed slot so labels align in a column regardless of glyph width.
  iconSlot: { width: 24, alignItems: 'center' },
  emojiIcon: { fontSize: 18 },
  label: { ...typography.bodyStrong, flex: 1, minWidth: 0 },
  labelCurrent: { color: colors.primary },
  labelDanger: { color: colors.danger },

  // Sign out stays put while everything above it scrolls.
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    paddingTop: spacing.sm,
  },

  // Visual hint that the panel can be dragged away.
  grip: {
    position: 'absolute',
    right: spacing.xs,
    top: '50%',
    marginTop: -22,
    width: 3, height: 44,
    borderRadius: radii.pill,
    backgroundColor: colors.border,
  },
});
