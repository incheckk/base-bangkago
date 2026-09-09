import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { LoadingState } from '@/components/States';
import { useAuth } from '@/hooks/useAuth';
import { friendlyAuthError, signOut } from '@/services/auth.service';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import { formatPhone } from '@/utils/phone';
import { useState } from 'react';

export default function PassengerProfile() {
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

  if (!profile) {
    return (
      <ScreenContainer>
        <LoadingState label="Loading profile…" />
      </ScreenContainer>
    );
  }

  const initials = `${profile.firstName.charAt(0)}${profile.lastName.charAt(0)}`.toUpperCase();

  return (
    <ScreenContainer padded={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.back} onPress={() => router.back()}>← Back</Text>

        {/* Avatar */}
        <View style={styles.avatarWrap}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
        </View>

        {/* Info */}
        <View style={styles.info}>
          <Text style={styles.name}>{profile.firstName} {profile.lastName}</Text>
          <Text style={styles.email}>{profile.email ?? formatPhone(profile.phone)}</Text>
          <Text style={styles.phone}>{formatPhone(profile.phone)}</Text>
        </View>

        {/* Edit button */}
        <View style={styles.editRow}>
          <PrimaryButton
            label="Edit Profile"
            variant="secondary"
            onPress={() => {/* TODO: edit profile modal */}}
            style={styles.editBtn}
          />
        </View>

        {/* Menu */}
        <View style={styles.menu}>
          <MenuItem label="My Bookings" onPress={() => router.push('/(passenger)/bookings')} />
          <MenuItem label="Trip History" onPress={() => router.push('/(passenger)/trips')} />
          <MenuItem label="Wallet" onPress={() => router.push('/(passenger)/wallet')} />
          <MenuItem label="Notifications" onPress={() => router.push('/(passenger)/notifications')} />
          <MenuItem label="Settings" onPress={() => {/* TODO */}} />
          <MenuItem label="About" onPress={() => {/* TODO */}} />
        </View>

        {/* Error */}
        {!!error && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>{error}</Text>
          </View>
        )}

        {/* Sign out */}
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

function MenuItem({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.menuItem} onPress={onPress}>
      <Text style={styles.menuLabel}>{label}</Text>
      <Text style={styles.menuChevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl, flexGrow: 1 },
  back: { color: colors.primary, fontSize: 14, fontWeight: '600', marginBottom: spacing.lg },

  avatarWrap: { alignItems: 'center', marginBottom: spacing.lg },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.primaryText, fontSize: 28, fontWeight: '700' },

  info: { alignItems: 'center', marginBottom: spacing.xl },
  name: { color: colors.text, fontSize: 22, fontWeight: '700', marginBottom: spacing.xs },
  email: { color: colors.textSecondary, fontSize: 14, marginBottom: 2 },
  phone: { color: colors.textMuted, fontSize: 13 },

  editRow: { alignItems: 'center', marginBottom: spacing.xl },
  editBtn: { minWidth: 180 },

  menu: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    overflow: 'hidden',
    marginBottom: spacing.xl,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  menuLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
  menuChevron: { color: colors.textMuted, fontSize: 20 },

  banner: {
    backgroundColor: 'rgba(224,82,82,0.12)',
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  bannerText: { color: colors.danger, fontSize: 13, lineHeight: 18 },

  footer: { marginTop: spacing.lg },
});
