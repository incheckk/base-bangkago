import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { useAuth } from '@/hooks/useAuth';
import { friendlyAuthError, signOut } from '@/services/auth.service';
import { colors, radii, spacing, typography } from '@/theme/tokens';
const MENU_ITEMS = [
  { key: 'operators', label: 'Manage Operators', icon: '🚤', route: '/(admin)/all-users' },
  { key: 'users', label: 'All Users', icon: '👥', route: '/(admin)/all-users' },
  { key: 'trips', label: 'Active Trips', icon: '📋', route: '/(admin)/active-trips' },
  { key: 'alerts', label: 'System Alerts', icon: '🚨', route: '/(admin)/alerts' },
] as const;

export default function AdminProfileScreen() {
  const { profile } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignOut() {
    setSigningOut(true);
    setError(null);
    try {
      await signOut();
    } catch (e) {
      setError(friendlyAuthError(e));
      setSigningOut(false);
    }
  }

  const initials = profile
    ? `${profile.firstName.charAt(0)}${profile.lastName.charAt(0)}`.toUpperCase()
    : '??';

  return (
    <ScreenContainer padded={false}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.back} onPress={() => router.back()}>← Back</Text>

        <View style={styles.header}>
          <View style={styles.avatar}>
            <Text style={styles.initials}>{initials}</Text>
          </View>
          <Text style={styles.name}>
            {profile ? `${profile.firstName} ${profile.lastName}` : 'Loading…'}
          </Text>
          <Text style={styles.email}>{profile?.email ?? ''}</Text>
          <View style={styles.roleBadge}>
            <Text style={styles.roleText}>Administrator</Text>
          </View>
        </View>

        <Text style={styles.sectionLabel}>MENU</Text>
        <View style={styles.menuCard}>
          {MENU_ITEMS.map((item, i) => (
            <Pressable
              key={item.key}
              onPress={() => router.push(item.route as any)}
              style={({ pressed }) => [
                styles.menuItem,
                i < MENU_ITEMS.length - 1 && styles.menuBorder,
                pressed && styles.menuPressed,
              ]}
            >
              <Text style={styles.menuIcon}>{item.icon}</Text>
              <Text style={styles.menuLabel}>{item.label}</Text>
              <Text style={styles.menuArrow}>›</Text>
            </Pressable>
          ))}
        </View>

        {!!error && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>{error}</Text>
          </View>
        )}

        <View style={styles.footer}>
          <PrimaryButton
            label="Sign Out"
            variant="danger"
            onPress={handleSignOut}
            loading={signingOut}
          />
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  back: { color: colors.primary, fontSize: 14, fontWeight: '600', marginBottom: spacing.lg },

  header: { alignItems: 'center', marginBottom: spacing.xl },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.warning,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  initials: { color: colors.primaryText, fontSize: 28, fontWeight: '700' },
  name: { color: colors.text, fontSize: 22, fontWeight: '700', marginBottom: spacing.xs },
  email: { color: colors.textSecondary, fontSize: 14, marginBottom: spacing.sm },
  roleBadge: {
    backgroundColor: colors.warning + '20',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
  },
  roleText: { color: colors.warning, fontSize: 13, fontWeight: '700' },

  sectionLabel: { ...typography.label, marginBottom: spacing.md },

  menuCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  menuBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  menuPressed: { backgroundColor: colors.bgElevated },
  menuIcon: { fontSize: 18, marginRight: spacing.md },
  menuLabel: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '600' },
  menuArrow: { color: colors.textMuted, fontSize: 20 },

  banner: {
    backgroundColor: 'rgba(224,82,82,0.12)',
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  bannerText: { color: colors.danger, fontSize: 13, lineHeight: 18 },

  footer: { marginTop: spacing.xxl },
});
