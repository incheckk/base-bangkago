import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from './Icon';
import { SideDrawer } from './SideDrawer';
import { MENU_TITLE, menuFor } from '@/config/menu';
import { safeBack } from '@/utils/navigation';
import { colors, elevation, radii, spacing, touchTarget, typography } from '@/theme/tokens';

interface Props {
  title: string;
  /** Small all-caps line above the title, e.g. "MANAGEMENT". */
  eyebrow?: string;
  /** Secondary line under the title — typically a record count. */
  subtitle?: string;
  showBack?: boolean;
  showDrawer?: boolean;
  /** Optional trailing control, e.g. an "Add" button. */
  right?: React.ReactNode;
}

/**
 * Header for the admin stack.
 *
 * Admin screens each hand-rolled `<Text onPress>← Back</Text>`, which gives a
 * tap area the size of the glyph — about 38×16 against a 44pt minimum. This
 * puts the control in a real 44pt button and makes the seventeen screens agree
 * on spacing and type.
 *
 * MUST be rendered as a sibling ABOVE the screen's ScrollView, never inside it.
 * It mounts SideDrawer, whose overlay uses absoluteFillObject — inside a
 * ScrollView that resolves against the scroll content view, so the drawer gets
 * sized to the full content height and scrolls away with it.
 */
export function AdminScreenHeader({
  title,
  eyebrow,
  subtitle,
  showBack = true,
  showDrawer = true,
  right,
}: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <>
      <SideDrawer
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={MENU_TITLE.admin}
        items={menuFor('admin')}
      />

      <View style={styles.header}>
        {showBack && (
          <Pressable
            onPress={() => safeBack('/(admin)/home')}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
          >
            <Icon name="back" size={20} color={colors.text} />
          </Pressable>
        )}

        <View style={styles.titleWrap}>
          {!!eyebrow && <Text style={styles.eyebrow}>{eyebrow}</Text>}
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          {!!subtitle && <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>}
        </View>

        {right}

        {showDrawer && (
          <Pressable
            onPress={() => setDrawerOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Open menu"
            style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
          >
            <Icon name="menu" size={20} color={colors.text} />
          </Pressable>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  titleWrap: { flex: 1, minWidth: 0, paddingHorizontal: spacing.xs },
  eyebrow: { ...typography.label, marginBottom: spacing.xxs },
  // Matches Passenger/Bangkero headers. Using h2 here made admin screen titles
  // visibly larger than the same element in the other two roles.
  title: { ...typography.title, color: colors.text },
  subtitle: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xxs },
  iconBtn: {
    width: touchTarget,
    height: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    backgroundColor: colors.scrim,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    ...elevation.e1,
  },
  iconBtnPressed: { backgroundColor: colors.surfaceAlt },
});
