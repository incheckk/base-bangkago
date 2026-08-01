import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View,
} from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { LoadingState } from '@/components/States';
import { TextField } from '@/components/TextField';
import { useAuth } from '@/hooks/useAuth';
import { friendlyAuthError, signOut } from '@/services/auth.service';
import { friendlyError, updateName } from '@/services/profile.service';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import { formatPhone } from '@/utils/phone';

export default function PassengerProfile() {
  const { user, profile } = useAuth();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Seed the form once the profile arrives, and re-seed if it changes elsewhere.
  useEffect(() => {
    if (profile) {
      setFirstName(profile.firstName);
      setLastName(profile.lastName);
    }
  }, [profile]);

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(t);
  }, [saved]);

  const dirty =
    !!profile && (firstName.trim() !== profile.firstName || lastName.trim() !== profile.lastName);

  async function save() {
    if (!user || !profile) return;
    setSaving(true);
    setError(null);
    try {
      await updateName({ uid: user.uid, firstName, lastName, isBangkero: false });
      setSaved(true);
    } catch (e) {
      setError(friendlyError(e));
    }
    setSaving(false);
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
    return <ScreenContainer><LoadingState label="Loading profile…" /></ScreenContainer>;
  }

  return (
    <ScreenContainer padded={false}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.back} onPress={() => router.back()}>← Back</Text>
          <Text style={styles.eyebrow}>PASSENGER</Text>
          <Text style={styles.title}>Your profile</Text>

          <View style={styles.form}>
            <TextField
              label="First name"
              value={firstName}
              onChangeText={setFirstName}
              autoCapitalize="words"
              editable={!saving}
              maxLength={40}
            />
            <TextField
              label="Last name"
              value={lastName}
              onChangeText={setLastName}
              autoCapitalize="words"
              editable={!saving}
              maxLength={40}
            />

            <View style={styles.locked}>
              <Text style={styles.lockedLabel}>MOBILE NUMBER</Text>
              <Text style={styles.lockedValue}>{formatPhone(profile.phone)}</Text>
              <Text style={styles.lockedNote}>
                This is your login and cannot be changed.
              </Text>
            </View>

            {!!error && (
              <View style={styles.banner}>
                <Text style={styles.bannerText}>{error}</Text>
              </View>
            )}
            {saved && !error && (
              <View style={styles.ok}>
                <Text style={styles.okText}>Saved</Text>
              </View>
            )}

            <PrimaryButton
              label="Save changes"
              onPress={save}
              loading={saving}
              disabled={!dirty}
            />
          </View>

          <View style={styles.footer}>
            <PrimaryButton
              label="Sign out"
              variant="danger"
              onPress={handleSignOut}
              loading={signingOut}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl, flexGrow: 1 },
  back: { color: colors.primary, fontSize: 14, fontWeight: '600', marginBottom: spacing.lg },
  eyebrow: { ...typography.label, marginBottom: 2 },
  title: { ...typography.h1, marginBottom: spacing.xl },
  form: { flex: 1 },

  locked: {
    backgroundColor: colors.bgElevated,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  lockedLabel: { ...typography.label, marginBottom: spacing.xs },
  lockedValue: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
  lockedNote: { ...typography.caption, color: colors.textMuted, fontSize: 11, marginTop: spacing.xs },

  banner: {
    backgroundColor: 'rgba(224,82,82,0.12)',
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  bannerText: { color: colors.danger, fontSize: 13, lineHeight: 18 },
  ok: {
    backgroundColor: 'rgba(52,214,176,0.12)',
    borderColor: colors.primary,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  okText: { color: colors.primary, fontSize: 13, fontWeight: '700', textAlign: 'center' },

  footer: { marginTop: spacing.xxl },
});
