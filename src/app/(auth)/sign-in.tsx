import { router } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';

import { Icon } from '@/components/Icon';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { TextField } from '@/components/TextField';
import { friendlyAuthError, signIn } from '@/services/auth.service';
import { colors, radii, spacing, touchTarget, typography } from '@/theme/tokens';
import { normalizePhone } from '@/utils/phone';

// Matches the accounts created by the Phase 3.10 seed script.
const DEMO_PASSWORD = 'demo1234';
const DEMO_ACCOUNTS: { role: string; name: string; phone: string; password?: string }[] = [
  { role: 'Passenger', name: 'Juan', phone: '0917 123 4567' },
  { role: 'Bangkero', name: 'Mang Lito', phone: '0918 123 4567' },
  { role: 'Bangkero', name: 'Pedro', phone: '0919 123 4567' },
  { role: 'Coastguard', name: 'Watch', phone: '0920 123 4567' },
  // Admin was created by hand in Supabase, not by the seed script, so it
  // keeps its own password.
  { role: 'Admin', name: 'Console', phone: '0930 913 2995', password: 'qqqwww' },
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
    } finally {
      setBusy(false);
    }
  }

  function quickLogin(demoPhone: string, demoPassword: string) {
    setPhone(demoPhone);
    setPassword(demoPassword);
    void submit(demoPhone, demoPassword);
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
          <Pressable
            onPress={() => router.back()}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            style={({ pressed }) => [styles.backBtn, pressed && styles.backBtnPressed]}
          >
            <Icon name="back" size={20} color={colors.text} />
          </Pressable>

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
                    onPress={() => quickLogin(a.phone, a.password ?? DEMO_PASSWORD)}
                    disabled={busy}
                    style={({ pressed }) => [styles.devChip, pressed && styles.devChipPressed]}
                  >
                    <Text style={styles.devChipRole} numberOfLines={1}>{a.role}</Text>
                    <Text style={styles.devChipName} numberOfLines={1}>{a.name}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.devHint}>Seeded accounts. Development builds only.</Text>
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
  backBtn: {
    alignSelf: 'flex-start',
    width: touchTarget, height: touchTarget,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: radii.pill,
    marginLeft: -spacing.sm, // optically aligns the glyph with the title below
    marginBottom: spacing.md,
  },
  backBtnPressed: { backgroundColor: colors.surface },
  title: { ...typography.h1, marginBottom: spacing.xs },
  subtitle: { ...typography.caption, marginBottom: spacing.xxl },
  form: { marginBottom: spacing.xl },
  banner: {
    backgroundColor: colors.dangerTint,
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  bannerText: { flexShrink: 1, ...typography.caption, color: colors.danger, lineHeight: 18 },
  switch: { alignSelf: 'center', marginTop: spacing.xl },
  switchText: { ...typography.caption },
  switchLink: { color: colors.primary, fontWeight: '700' },
  devBox: {
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    paddingTop: spacing.lg,
  },
  devLabel: { ...typography.label, marginBottom: spacing.md },
  devRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  devChip: {
    // flexBasis + grow so five chips wrap to two rows instead of each being
    // squeezed to ~60pt, which is what crushed the labels.
    flexBasis: '30%',
    flexGrow: 1,
    minWidth: 92,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    minHeight: touchTarget + 8,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
    alignItems: 'center', justifyContent: 'center',
    gap: spacing.xxs,
  },
  devChipPressed: { backgroundColor: colors.surface, borderColor: colors.primary },
  devChipRole: { ...typography.label, fontSize: 9, letterSpacing: 0.4, flexShrink: 1 },
  devChipName: {
    ...typography.caption, color: colors.text, fontWeight: '700',
    fontSize: 12, flexShrink: 1,
  },
  devHint: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm, fontSize: 11 },
});
