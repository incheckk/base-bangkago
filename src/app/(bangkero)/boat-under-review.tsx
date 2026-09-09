import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { ProgressBar } from '@/components/ProgressBar';
import { colors, radii, spacing, typography } from '@/theme/tokens';

export default function BoatUnderReview() {
  return (
    <ScreenContainer>
      <View style={styles.container}>
        <View style={styles.iconWrap}>
          <Text style={styles.icon}>⏳</Text>
        </View>

        <View style={styles.progressWrap}>
          <ProgressBar steps={['Upload', 'Review', 'Approved']} current={1} />
        </View>

        <Text style={styles.title}>Documents Under Review</Text>
        <Text style={styles.desc}>
          Our team will review your documents within 24-48 hours.{'\n'}
          We&apos;ll notify you once a decision has been made.
        </Text>

        <Text style={styles.support}>
          Need help?{' '}
          <Text style={styles.supportLink}>Contact Support</Text>
        </Text>

        <PrimaryButton
          label="Back to Home"
          onPress={() => router.push('/(bangkero)/home')}
          style={{ marginTop: spacing.xl }}
        />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(232,169,60,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  icon: { fontSize: 36 },
  progressWrap: { width: '100%', marginBottom: spacing.xxl },
  title: { ...typography.h2, textAlign: 'center', marginBottom: spacing.md },
  desc: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  support: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xxl,
  },
  supportLink: { color: colors.primary, fontWeight: '600' },
});
