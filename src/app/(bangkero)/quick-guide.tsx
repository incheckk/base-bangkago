import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { colors, radii, spacing, typography } from '@/theme/tokens';

const STEPS = [
  { num: '1', title: 'Upload Documents', desc: 'Submit your government ID, boat registration, and permits for verification.' },
  { num: '2', title: 'Wait for Approval', desc: 'Our team reviews your documents within 24-48 hours.' },
  { num: '3', title: 'Go Online & Earn', desc: 'Accept bookings from passengers and start earning.' },
];

export default function QuickGuide() {
  return (
    <ScreenContainer padded={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.eyebrow}>WELCOME</Text>
        <Text style={styles.title}>How BangkaGo Works</Text>
        <Text style={styles.subtitle}>
          Join as a bangkero and connect with passengers looking for boat rides along the coast.
        </Text>

        <View style={styles.steps}>
          {STEPS.map((s) => (
            <View key={s.num} style={styles.step}>
              <View style={styles.stepNum}>
                <Text style={styles.stepNumText}>{s.num}</Text>
              </View>
              <View style={styles.stepContent}>
                <Text style={styles.stepTitle}>{s.title}</Text>
                <Text style={styles.stepDesc}>{s.desc}</Text>
              </View>
            </View>
          ))}
        </View>

        <PrimaryButton
          label="Get Started"
          onPress={() => router.push('/(bangkero)/verify-boat')}
          style={{ marginTop: spacing.xxl }}
        />
        <PrimaryButton
          label="Skip for now"
          variant="secondary"
          onPress={() => router.push('/(bangkero)/home')}
          style={{ marginTop: spacing.md }}
        />
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xxl,
  },
  eyebrow: { ...typography.label, marginBottom: 2 },
  title: { ...typography.h1, marginBottom: spacing.md },
  subtitle: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.xxl },

  steps: { gap: spacing.lg },
  step: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.lg,
  },
  stepNum: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumText: { color: colors.primaryText, fontSize: 16, fontWeight: '700' },
  stepContent: { flex: 1 },
  stepTitle: { color: colors.text, fontSize: 15, fontWeight: '700', marginBottom: spacing.xs },
  stepDesc: { ...typography.caption, color: colors.textSecondary },
});
