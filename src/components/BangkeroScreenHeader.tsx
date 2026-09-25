import React from 'react';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from './Icon';
import { SideDrawer } from './SideDrawer';
import { MENU_TITLE, menuFor } from '@/config/menu';
import { safeBack } from '@/utils/navigation';
import { colors, elevation, radii, spacing, touchTarget, typography } from '@/theme/tokens';

interface Props {
  title?: string;
  /** Small all-caps line above the title. Matches AdminScreenHeader. */
  eyebrow?: string;
  subtitle?: string;
  showBack?: boolean;
  showDrawer?: boolean;
  /** Optional trailing control rendered before the menu button. */
  right?: React.ReactNode;
}

export function BangkeroScreenHeader({ title, eyebrow, subtitle, showBack = true, showDrawer = true, right }: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <>
      <SideDrawer
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={MENU_TITLE.bangkero}
        items={menuFor('bangkero')}
      />

      <View style={styles.header}>
        {showBack && (
          <Pressable
            onPress={() => safeBack('/(bangkero)/home')}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
          >
            <Icon name="back" size={20} color={colors.text} />
          </Pressable>
        )}

        <View style={styles.titleWrap}>
          {!!eyebrow && <Text style={styles.eyebrow}>{eyebrow}</Text>}
          {!!title && <Text style={styles.title} numberOfLines={1}>{title}</Text>}
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
  titleWrap: { flex: 1, minWidth: 0 },
  eyebrow: { ...typography.label, marginBottom: spacing.xxs },
  title: { ...typography.title, color: colors.text },
  subtitle: { ...typography.caption, color: colors.textMuted, marginTop: 1 },
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
