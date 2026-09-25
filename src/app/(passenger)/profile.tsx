import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PassengerScreenHeader } from '@/components/PassengerScreenHeader';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { LoadingState } from '@/components/States';
import { TextField } from '@/components/TextField';
import { useAuth } from '@/hooks/useAuth';
import { friendlyAuthError, signOut } from '@/services/auth.service';
import { friendlyError as profileFriendlyError, updateName } from '@/services/profile.service';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import { formatPhone } from '@/utils/phone';
import { useState } from 'react';

export default function PassengerProfile() {
  const { profile } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [savedName, setSavedName] = useState<{ first: string; last: string } | null>(null);

  function startEdit() {
    setFirstName(profile?.firstName ?? '');
    setLastName(profile?.lastName ?? '');
    setError(null);
    setEditing(true);
  }

  async function saveProfile() {
    if (!profile) return;
    setSavingProfile(true);
    setError(null);
    try {
      await updateName({
        uid: profile.uid,
        firstName,
        lastName,
        isBangkero: false,
      });
      setSavedName({ first: firstName.trim(), last: lastName.trim() });
      setEditing(false);
    } catch (e) {
      setError(profileFriendlyError(e));
    }
    setSavingProfile(false);
  }

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

  const displayFirst = savedName?.first ?? profile.firstName;
  const displayLast = savedName?.last ?? profile.lastName;
  const initials = `${displayFirst.charAt(0)}${displayLast.charAt(0)}`.toUpperCase();

  return (
    <ScreenContainer padded={false}>
      <PassengerScreenHeader title="Profile" showDrawer={false} />
      <ScrollView contentContainerStyle={styles.scroll}>

        {/* Avatar */}
        <View style={styles.avatarWrap}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
        </View>

        {/* Info */}
        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={1}>{displayFirst} {displayLast}</Text>
          <Text style={styles.email}>{profile.email ?? formatPhone(profile.phone)}</Text>
          <Text style={styles.phone}>{formatPhone(profile.phone)}</Text>
        </View>

        {/* Edit form / button */}
        {editing ? (
          <View style={styles.editCard}>
            <TextField
              label="First Name"
              value={firstName}
              onChangeText={setFirstName}
              autoCapitalize="words"
            />
            <TextField
              label="Last Name"
              value={lastName}
              onChangeText={setLastName}
              autoCapitalize="words"
            />
            <View style={styles.editActions}>
              <PrimaryButton
                label="Cancel"
                variant="secondary"
                onPress={() => setEditing(false)}
                style={styles.editActionBtn}
              />
              <PrimaryButton
                label="Save"
                onPress={saveProfile}
                loading={savingProfile}
                disabled={savingProfile || !firstName.trim() || !lastName.trim()}
                style={styles.editActionBtn}
              />
            </View>
          </View>
        ) : (
          <View style={styles.editRow}>
            <PrimaryButton
              label="Edit Profile"
              variant="secondary"
              onPress={startEdit}
              style={styles.editBtn}
            />
          </View>
        )}

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

  avatarWrap: { alignItems: 'center', marginBottom: spacing.lg },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { flexShrink: 1, color: colors.primaryText, fontSize: 28, fontWeight: '700' },

  info: { alignItems: 'center', marginBottom: spacing.xl },
  name: { flexShrink: 1, color: colors.text, fontSize: 22, fontWeight: '700', marginBottom: spacing.xs },
  email: { flexShrink: 1, color: colors.textSecondary, fontSize: 14, marginBottom: 2 },
  phone: { flexShrink: 1, color: colors.textMuted, fontSize: 13 },

  editRow: { alignItems: 'center', marginBottom: spacing.xl },
  editBtn: { minWidth: 180 },
  editCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  editActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
  editActionBtn: { flex: 1 },

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
  menuLabel: { flexShrink: 1, color: colors.text, fontSize: 15, fontWeight: '600' },
  menuChevron: { color: colors.textMuted, fontSize: 20 },

  banner: {
    backgroundColor: colors.dangerTint,
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  bannerText: { flexShrink: 1, color: colors.danger, fontSize: 13, lineHeight: 18 },

  footer: { marginTop: spacing.lg },
});
