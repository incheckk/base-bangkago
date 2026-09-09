import { router } from 'expo-router';
import { useState } from 'react';
import {
  Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { useAuth } from '@/hooks/useAuth';
import { useBangkero } from '@/hooks/useSupabase';
import { friendlyAuthError, signOut } from '@/services/auth.service';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import { formatPhone } from '@/utils/phone';

const MENU_ITEMS = [
  { key: 'earnings', label: 'Earnings', icon: '💰' },
  { key: 'trips', label: 'Trip History', icon: '🚤' },
  { key: 'documents', label: 'Documents', icon: '📄' },
  { key: 'weather', label: 'Weather', icon: '🌊' },
  { key: 'settings', label: 'Settings', icon: '⚙️' },
] as const;

const ROUTE_MAP: Record<string, string> = {
  earnings: '/(bangkero)/profile',
  trips: '/(bangkero)/trips',
  documents: '/(bangkero)/profile',
  weather: '/(bangkero)/weather',
  settings: '/(bangkero)/profile',
};

export default function BangkeroProfileScreen() {
  const { user, profile } = useAuth();
  const bangkero = useBangkero(user?.id ?? null);

  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initials = profile
    ? `${profile.firstName.charAt(0)}${profile.lastName.charAt(0)}`
    : '??';

  const op = bangkero.data;

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
          <Text style={styles.phone}>
            {profile ? formatPhone(profile.phone) : ''}
          </Text>
          {op && (
            <Text style={styles.boatName}>{op.displayName}</Text>
          )}
          <View style={[
            styles.badge,
            op?.verificationStat === 'verified' ? styles.badgeVerified : styles.badgePending,
          ]}>
            <Text style={[
              styles.badgeText,
              op?.verificationStat === 'verified' ? styles.badgeTextVerified : styles.badgeTextPending,
            ]}>
              {op?.verificationStat === 'verified' ? '✓ Verified' : 'Pending Verification'}
            </Text>
          </View>
        </View>

        {op && (
          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Boat Name</Text>
              <Text style={styles.infoValue}>{op.displayName}</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Permit Number</Text>
              <Text style={styles.infoValue}>{op.permitNumber ?? '—'}</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Status</Text>
              <Text style={[styles.infoValue, op.isAvailable ? styles.statusOnline : styles.statusOffline]}>
                {op.isAvailable ? 'Online' : 'Offline'}
              </Text>
            </View>
          </View>
        )}

        <Text style={styles.sectionLabel}>MENU</Text>
        <View style={styles.menuCard}>
          {MENU_ITEMS.map((item, i) => (
            <Pressable
              key={item.key}
              onPress={() => router.push(ROUTE_MAP[item.key] as any)}
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

  header: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  initials: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '700',
  },
  name: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  phone: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  boatName: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  badge: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
  },
  badgeVerified: { backgroundColor: 'rgba(52,214,176,0.15)' },
  badgePending: { backgroundColor: 'rgba(232,169,60,0.15)' },
  badgeText: { fontSize: 12, fontWeight: '700' },
  badgeTextVerified: { color: colors.primary },
  badgeTextPending: { color: colors.warning },

  infoCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  infoLabel: { color: colors.textSecondary, fontSize: 14 },
  infoValue: { color: colors.text, fontSize: 14, fontWeight: '600' },
  statusOnline: { color: colors.primary },
  statusOffline: { color: colors.textMuted },
  divider: { height: 1, backgroundColor: colors.borderSubtle },

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
