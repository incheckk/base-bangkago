import { router } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { BangkeroScreenHeader } from '@/components/BangkeroScreenHeader';
import { Icon } from '@/components/Icon';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { ProgressBar } from '@/components/ProgressBar';
import { useAuth } from '@/hooks/useAuth';
import { useBangkero } from '@/hooks/useSupabase';
import { documentsRoute } from '@/services/documents.service';
import { colors, spacing, typography } from '@/theme/tokens';

/**
 * Step 2 — verified. The admin's approval is the server truth; if
 * the flag ever changes under you (demo reset, re-review) the screen
 * walks back to the matching state instead of lying.
 */
export default function DocumentsApproved() {
  const { user } = useAuth();
  const bangkero = useBangkero(user?.id ?? null);
  const stat = bangkero.data?.verificationStat;

  useEffect(() => {
    if (!stat || stat === 'verified') return;
    router.replace(documentsRoute(stat));
  }, [stat]);

  return (
    <ScreenContainer padded={false}>
      <BangkeroScreenHeader title="Verification Result" showBack={false} />
      <View style={styles.container}>
        <View style={styles.iconWrap}>
          <Icon name="check" size={34} color={colors.success} />
        </View>

        <View style={styles.progressWrap}>
          <ProgressBar steps={['Upload', 'Review', 'Approved']} current={2} />
        </View>

        <Text style={styles.title}>Congratulations!</Text>
        <Text style={styles.desc}>
          Your documents have been approved!
        </Text>
        <Text style={styles.subDesc}>
          You can now go online, receive requests and earn.
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
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  progressWrap: { width: '100%', marginBottom: spacing.xxl },
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
