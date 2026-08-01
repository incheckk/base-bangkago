import { router } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { TextField } from '@/components/TextField';
import { friendlyAuthError, signUp } from '@/services/auth.service';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import type { UserRole } from '@/types/models';
import { normalizePhone } from '@/utils/phone';

const MIN_PASSWORD = 6;

const ROLES: { value: UserRole; label: string; hint: string }[] = [
  { value: 'passenger', label: 'Passenger', hint: 'Book boat trips' },
  { value: 'bangkero', label: 'Bangkero', hint: 'Receive trip requests' },
];

type Errors = Partial<Record<'firstName' | 'lastName' | 'phone' | 'password', string>>;

export default function SignUp() {
  const [role, setRole] = useState<UserRole>('passenger');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setFormError(null);

    const e164 = normalizePhone(phone);
    const next: Errors = {};
    if (!firstName.trim()) next.firstName = 'Required.';
    if (!lastName.trim()) next.lastName = 'Required.';
    if (!e164) next.phone = 'Enter a valid mobile number, e.g. 0917 123 4567';
    if (password.length < MIN_PASSWORD) next.password = `At least ${MIN_PASSWORD} characters.`;

    setErrors(next);
    if (Object.keys(next).length > 0 || !e164) return;

    setBusy(true);
    try {
      await signUp({ phone: e164, password, firstName, lastName, role });
      // No navigation here — the (auth) guard redirects once the profile doc lands.
    } catch (e) {
      setFormError(friendlyAuthError(e));
      setBusy(false);
    }
  }

  return (
    <ScreenContainer>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.title}>Create account</Text>
          <Text style={styles.subtitle}>Your mobile number is your BangkaGo login.</Text>

          <Text style={styles.groupLabel}>I AM A</Text>
          <View style={styles.roleRow}>
            {ROLES.map((r) => {
              const active = role === r.value;
              return (
                <Pressable
                  key={r.value}
                  onPress={() => setRole(r.value)}
                  disabled={busy}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  style={({ pressed }) => [
                    styles.roleCard,
                    active && styles.roleCardActive,
                    pressed && !active && styles.rolePressed,
                  ]}
                >
                  <Text style={[styles.roleLabel, active && styles.roleLabelActive]}>{r.label}</Text>
                  <Text style={styles.roleHint}>{r.hint}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.form}>
            <TextField
              label="First name"
              value={firstName}
              onChangeText={setFirstName}
              placeholder="Juan"
              autoCapitalize="words"
              error={errors.firstName ?? null}
              editable={!busy}
              maxLength={40}
            />
            <TextField
              label="Last name"
              value={lastName}
              onChangeText={setLastName}
              placeholder="Dela Cruz"
              autoCapitalize="words"
              error={errors.lastName ?? null}
              editable={!busy}
              maxLength={40}
            />
            <TextField
              label="Mobile number"
              value={phone}
              onChangeText={setPhone}
              placeholder="0917 123 4567"
              keyboardType="phone-pad"
              error={errors.phone ?? null}
              editable={!busy}
              maxLength={20}
            />
            <TextField
              label="Password"
              value={password}
              onChangeText={setPassword}
              placeholder={`At least ${MIN_PASSWORD} characters`}
              secure
              error={errors.password ?? null}
              editable={!busy}
            />

            {!!formError && (
              <View style={styles.banner}>
                <Text style={styles.bannerText}>{formError}</Text>
              </View>
            )}

            <PrimaryButton label="Create account" onPress={submit} loading={busy} />

            {role === 'bangkero' && (
              <Text style={styles.note}>
                You can add your boat name and capacity from Profile after signing up.
              </Text>
            )}

            <Pressable
              onPress={() => router.replace('/(auth)/sign-in')}
              disabled={busy}
              hitSlop={8}
              style={styles.switch}
            >
              <Text style={styles.switchText}>
                Already have an account? <Text style={styles.switchLink}>Sign in</Text>
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingVertical: spacing.xl },
  title: { ...typography.h1, marginBottom: spacing.xs },
  subtitle: { ...typography.caption, marginBottom: spacing.xl },
  groupLabel: { ...typography.label, marginBottom: spacing.sm },
  roleRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.xl },
  roleCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.md,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  roleCardActive: { borderColor: colors.primary, backgroundColor: colors.surfaceAlt },
  rolePressed: { opacity: 0.8 },
  roleLabel: { fontSize: 15, fontWeight: '700', color: colors.textSecondary },
  roleLabelActive: { color: colors.primary },
  roleHint: { ...typography.caption, color: colors.textMuted, marginTop: 2, fontSize: 12 },
  form: { marginBottom: spacing.xl },
  banner: {
    backgroundColor: 'rgba(224,82,82,0.12)',
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  bannerText: { color: colors.danger, fontSize: 13, lineHeight: 18 },
  note: { ...typography.caption, color: colors.textMuted, marginTop: spacing.md, textAlign: 'center' },
  switch: { alignSelf: 'center', marginTop: spacing.xl },
  switchText: { ...typography.caption },
  switchLink: { color: colors.primary, fontWeight: '700' },
});
