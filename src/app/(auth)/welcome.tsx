import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { colors, spacing, typography } from '@/theme/tokens';

export default function Welcome() {
  return (
    <ScreenContainer>
      <View style={styles.hero}>
        <Text style={styles.mark}>⛵</Text>
        <Text style={styles.title}>BangkaGo</Text>
        <Text style={styles.tagline}>
          Book a boat between Mactan and Olango — no haggling at the pier.
        </Text>
      </View>

      <View style={styles.actions}>
        <PrimaryButton label="Create account" onPress={() => router.push('/(auth)/sign-up')} />
        <PrimaryButton
          label="I already have an account"
          variant="secondary"
          onPress={() => router.push('/(auth)/sign-in')}
          style={{ marginTop: spacing.md }}
        />
        <Text style={styles.legal}>
          Cash payment on board. Fares are fixed per route.
        </Text>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  mark: { fontSize: 64, marginBottom: spacing.lg },
  title: { ...typography.h1, fontSize: 34, marginBottom: spacing.md },
  tagline: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: spacing.md,
  },
  actions: { paddingBottom: spacing.xl },
  legal: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
});
