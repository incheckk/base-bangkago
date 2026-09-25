import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { colors, elevation, radii, spacing, typography } from '@/theme/tokens';

const FEATURES: { icon: 'boat' | 'route' | 'cash'; text: string }[] = [
  { icon: 'boat', text: 'Book a bangka in seconds' },
  { icon: 'route', text: 'Fixed fares, no haggling' },
  { icon: 'cash', text: 'Pay cash on board' },
];

export default function Welcome() {
  return (
    <ScreenContainer>
      <View style={styles.hero}>
        {/* A vector mark in a branded ring, not a 64pt emoji — the OS draws
            emoji differently on every device, which is the last thing a brand
            mark should do. */}
        <View style={styles.markRing}>
          <View style={styles.markInner}>
            <Icon name="boat" size={38} color={colors.primary} />
          </View>
        </View>

        <Text style={styles.title}>BangkaGo</Text>
        <Text style={styles.tagline}>
          Sea travel between Mactan and Olango, booked from your phone.
        </Text>

        <View style={styles.features}>
          {FEATURES.map((f) => (
            <View key={f.text} style={styles.featureRow}>
              <View style={styles.featureIcon}>
                <Icon name={f.icon} size={14} color={colors.primary} />
              </View>
              <Text style={styles.featureText}>{f.text}</Text>
            </View>
          ))}
        </View>
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

  markRing: {
    width: 96, height: 96, borderRadius: radii.pill,
    backgroundColor: colors.primaryTint,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  markInner: {
    width: 72, height: 72, borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    ...elevation.e2,
  },

  title: { ...typography.display, letterSpacing: -0.5, marginBottom: spacing.sm },
  tagline: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: spacing.lg,
  },

  features: { marginTop: spacing.huge, gap: spacing.md, alignSelf: 'stretch' },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  featureIcon: {
    width: 26, height: 26, borderRadius: radii.pill,
    backgroundColor: colors.primaryTint,
    alignItems: 'center', justifyContent: 'center',
  },
  featureText: { ...typography.caption, color: colors.textSecondary, flex: 1 },

  actions: { paddingBottom: spacing.xl },
  legal: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.lg,
    fontSize: 11,
  },
});
