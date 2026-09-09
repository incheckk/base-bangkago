import { router } from 'expo-router';
import { useState } from 'react';
import {
  ScrollView, StyleSheet, Text, View,
} from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { colors, radii, spacing, typography } from '@/theme/tokens';

const CHECKLIST = [
  { key: 'clean', label: 'Clean the boat', icon: '🧹' },
  { key: 'fuel', label: 'Check and refuel', icon: '⛽' },
  { key: 'earnings', label: 'Log today\'s earnings', icon: '💰' },
];

export default function PostTripScreen() {
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  function toggle(key: string) {
    setChecked((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const allDone = CHECKLIST.every((c) => checked[c.key]);

  return (
    <ScreenContainer padded={false}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.back} onPress={() => router.back()}>← Back</Text>

        <View style={styles.hero}>
          <Text style={styles.heroIcon}>🎉</Text>
          <Text style={styles.title}>Trip Completed</Text>
          <Text style={styles.subtitle}>
            Thank you for a safe trip! Complete the checklist below before heading out.
          </Text>
        </View>

        <Text style={styles.sectionLabel}>POST-TRIP CHECKLIST</Text>
        <View style={styles.checklist}>
          {CHECKLIST.map((item) => {
            const done = !!checked[item.key];
            return (
              <Text
                key={item.key}
                onPress={() => toggle(item.key)}
                style={[styles.checkItem, done && styles.checkItemDone]}
              >
                <Text style={styles.checkIcon}>{done ? '✅' : item.icon}</Text>
                {' '}{item.label}
              </Text>
            );
          })}
        </View>

        {allDone && (
          <View style={styles.completeBanner}>
            <Text style={styles.completeBannerText}>All done! You're all set.</Text>
          </View>
        )}

        <View style={styles.footer}>
          <PrimaryButton
            label="View Earnings"
            onPress={() => router.push('/(bangkero)/profile')}
          />
          <View style={{ height: spacing.md }} />
          <PrimaryButton
            label="Back to Home"
            variant="secondary"
            onPress={() => router.push('/(bangkero)/home')}
          />
        </View>

        <Text style={styles.thanks}>
          Maraming salamat, bangkero! Your service keeps our islands connected. 🌊
        </Text>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  back: { color: colors.primary, fontSize: 14, fontWeight: '600', marginBottom: spacing.lg },

  hero: {
    alignItems: 'center',
    marginVertical: spacing.xxl,
  },
  heroIcon: { fontSize: 48, marginBottom: spacing.md },
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },

  sectionLabel: { ...typography.label, marginBottom: spacing.md },

  checklist: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
  },
  checkItem: {
    color: colors.textSecondary,
    fontSize: 14,
    paddingVertical: spacing.sm,
    lineHeight: 22,
  },
  checkItemDone: { color: colors.primary },
  checkIcon: { fontSize: 14 },

  completeBanner: {
    backgroundColor: 'rgba(52,214,176,0.12)',
    borderColor: colors.primary,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  completeBannerText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },

  footer: { marginTop: spacing.xxl },

  thanks: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    fontSize: 13,
    marginTop: spacing.xxl,
    lineHeight: 20,
  },
});
