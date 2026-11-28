import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PassengerScreenHeader } from '@/components/PassengerScreenHeader';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { LoadingState } from '@/components/States';
import { TextField } from '@/components/TextField';
import { useAuth } from '@/hooks/useAuth';
import { requestReplay } from '@/hooks/useOnboarding';
import { friendlyAuthError, signOut } from '@/services/auth.service';
import {
  friendlyError as profileFriendlyError, updateName, updatePersonalDetails,
} from '@/services/profile.service';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import { formatPhone } from '@/utils/phone';
import { addressError, nameError } from '@/utils/validation';
import { useState } from 'react';

export default function PassengerProfile() {
  const { user, profile } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [age, setAge] = useState('');
  const [address, setAddress] = useState('');
  const [sex, setSex] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [savedName, setSavedName] = useState<{ first: string; last: string } | null>(null);

  function startEdit() {
    setFirstName(profile?.firstName ?? '');
    setLastName(profile?.lastName ?? '');
    setAge(profile?.age != null ? String(profile.age) : '');
    setAddress(profile?.address ?? '');
    setSex(profile?.sex ?? '');
    setError(null);
    setEditing(true);
  }

  async function saveProfile() {
    if (!profile) return;
    const firstErr = nameError(firstName);
    const lastErr = nameError(lastName);
    const parsedAge = Number(age.trim());
    const ageErr = Number.isInteger(parsedAge) && parsedAge >= 1 && parsedAge <= 120
      ? null
      : 'Enter an age between 1 and 120.';
    const addrErr = addressError(address);
    const sexErr = sex ? null : 'Choose your gender.';
    const invalid = firstErr
      ? `First name: ${firstErr}`
      : lastErr
        ? `Last name: ${lastErr}`
        : ageErr ?? addrErr ?? sexErr;
    if (invalid) {
      setError(invalid);
      return;
    }
    setSavingProfile(true);
    setError(null);
    try {
      await updateName({
        uid: profile.uid,
        firstName,
        lastName,
        isBangkero: false,
      });
      await updatePersonalDetails({ uid: profile.uid, age: parsedAge, address, sex });
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
          <Text style={styles.phone}>{formatPhone(profile.phone)}</Text>
          {(profile.age != null || profile.sex || profile.address) && (
            <Text style={styles.phone}>
              {[
                profile.age != null ? `${profile.age} years old` : null,
                profile.sex
                  ? profile.sex.charAt(0).toUpperCase() + profile.sex.slice(1)
                  : null,
                profile.address || null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          )}
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
            <TextField
              label="Age"
              value={age}
              onChangeText={setAge}
              keyboardType="number-pad"
              maxLength={3}
              placeholder="e.g. 24"
            />
            <TextField
              label="Home Address"
              value={address}
              onChangeText={setAddress}
              placeholder="House, street, barangay, city"
            />
            <Text style={styles.fieldLabel}>GENDER</Text>
            <View style={styles.sexRow}>
              {(['female', 'male', 'other'] as const).map((s) => {
                const active = sex === s;
                return (
                  <Pressable
                    key={s}
                    onPress={() => setSex(s)}
                    style={({ pressed }) => [
                      styles.sexChip,
                      active && styles.sexChipActive,
                      pressed && !active && styles.pressed,
                    ]}
                  >
                    <Text style={[styles.sexChipText, active && styles.sexChipTextActive]}>
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.editHint}>
              Age, gender and address appear on the bangkero&apos;s manifest and are
              required before booking.
            </Text>
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
          <MenuItem label="Notifications" onPress={() => router.push('/(passenger)/notifications')} />
        </View>

        {/* Error */}
        {!!error && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>{error}</Text>
          </View>
        )}

        {/* Development only. The tutorial is once per account, so without
            this a copy change means registering a new passenger to see it.
            It clears the flag and sends you to the screen that runs it. */}
        {__DEV__ && (
          <MenuItem
            label="Replay tutorial"
            onPress={() => {
              void requestReplay(user?.id ?? null);
              router.replace('/(passenger)/home');
            }}
          />
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
  editHint: { ...typography.caption, color: colors.textMuted, lineHeight: 17 },

  fieldLabel: { ...typography.label, marginBottom: spacing.sm },
  sexRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  sexChip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    minHeight: 36,
    justifyContent: 'center',
  },
  sexChipActive: { backgroundColor: colors.primaryTint, borderColor: colors.primary },
  sexChipText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  sexChipTextActive: { color: colors.primary },
  pressed: { opacity: 0.72 },

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
