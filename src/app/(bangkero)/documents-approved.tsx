import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { colors, spacing, typography } from '@/theme/tokens';

export default function DocumentsApproved() {
  return (
    <ScreenContainer>
      <View style={styles.container}>
        <View style={styles.iconWrap}>
          <Text style={styles.icon}>✓</Text>
        </View>

        <Text style={styles.title}>Congratulations!</Text>
        <Text style={styles.desc}>
          Your documents have been approved!
        </Text>
        <Text style={styles.subDesc}>
          You can now accept bookings and earn.
        </Text>

        <PrimaryButton
          label="Go to Dashboard"
          onPress={() => router.push('/(bangkero)/home')}
          style={{ marginTop: spacing.xxl }}
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
    backgroundColor: 'rgba(52,214,176,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  icon: { color: colors.primary, fontSize: 36, fontWeight: '700' },
  title: { ...typography.h2, textAlign: 'center', marginBottom: spacing.md },
  desc: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  subDesc: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
