import { router } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { TextField } from '@/components/TextField';
import { friendlyAuthError, signIn } from '@/services/auth.service';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import { normalizePhone } from '@/utils/phone';

// Matches the accounts created by the Phase 3.10 seed script.
const DEMO_PASSWORD = 'demo1234';
const DEMO_ACCOUNTS = [
  { label: 'Passenger', phone: '0917 123 4567' },
  { label: 'Bangkero 1', phone: '0918 123 4567' },
  { label: 'Bangkero 2', phone: '0919 123 4567' },
];

export default function SignIn() {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(rawPhone: string, rawPassword: string) {
    setFormError(null);

    const e164 = normalizePhone(rawPhone);
    setPhoneError(e164 ? null : 'Enter a valid mobile number, e.g. 0917 123 4567');
    setPasswordError(rawPassword ? null : 'Enter your password.');
    if (!e164 || !rawPassword) return;

    setBusy(true);
    try {
      await signIn(e164, rawPassword);
      // No navigation here — the (auth) guard redirects once the profile loads.
    } catch (e) {
      setFormError(friendlyAuthError(e));
      setBusy(false);
    }
  }

  function quickLogin(demoPhone: string) {
    setPhone(demoPhone);
    setPassword(DEMO_PASSWORD);
    void submit(demoPhone, DEMO_PASSWORD);
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
          <Text style={styles.title}>Sign in</Text>
          <Text style={styles.subtitle}>Use the mobile number you registered with.</Text>

          <View style={styles.form}>
            <TextField
              label="Mobile number"
              value={phone}
              onChangeText={setPhone}
              placeholder="0917 123 4567"
              keyboardType="phone-pad"
              error={phoneError}
              editable={!busy}
              maxLength={20}
            />
            <TextField
              label="Password"
              value={password}
              onChangeText={setPassword}
              placeholder="Your password"
              secure
              error={passwordError}
              editable={!busy}
            />

            {!!formError && (
              <View style={styles.banner}>
                <Text style={styles.bannerText}>{formError}</Text>
              </View>
            )}

            <PrimaryButton label="Sign in" onPress={() => submit(phone, password)} loading={busy} />

            <Pressable
              onPress={() => router.replace('/(auth)/sign-up')}
              disabled={busy}
              hitSlop={8}
              style={styles.switch}
            >
              <Text style={styles.switchText}>
                No account yet? <Text style={styles.switchLink}>Create one</Text>
              </Text>
            </Pressable>
          </View>

          {__DEV__ && (
            <View style={styles.devBox}>
              <Text style={styles.devLabel}>DEV QUICK LOGIN</Text>
              <View style={styles.devRow}>
                {DEMO_ACCOUNTS.map((a) => (
                  <Pressable
                    key={a.phone}
                    onPress={() => quickLogin(a.phone)}
                    disabled={busy}
                    style={({ pressed }) => [styles.devChip, pressed && styles.devChipPressed]}
                  >
                    <Text style={styles.devChipText}>{a.label}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.devHint}>Seeded accounts only — dev builds, never production.</Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingVertical: spacing.xl },
  title: { ...typography.h1, marginBottom: spacing.xs },
  subtitle: { ...typography.caption, marginBottom: spacing.xxl },
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
  switch: { alignSelf: 'center', marginTop: spacing.xl },
  switchText: { ...typography.caption },
  switchLink: { color: colors.primary, fontWeight: '700' },
  devBox: {
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    paddingTop: spacing.lg,
  },
  devLabel: { ...typography.label, marginBottom: spacing.md },
  devRow: { flexDirection: 'row', gap: spacing.sm },
  devChip: {
    flex: 1,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.sm,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  devChipPressed: { opacity: 0.7 },
  devChipText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  devHint: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm, fontSize: 11 },
});
