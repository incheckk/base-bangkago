import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { BangkeroScreenHeader } from '@/components/BangkeroScreenHeader';
import { Icon } from '@/components/Icon';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { colors, radii, spacing, typography } from '@/theme/tokens';

export default function DocumentsRejected() {
  return (
    <ScreenContainer padded={false}>
      <BangkeroScreenHeader title="Verification Result" showBack={false} />
      <View style={styles.container}>
        <View style={styles.iconWrap}>
          <Icon name="close" size={34} color={colors.danger} />
        </View>

        <Text style={styles.title}>Documents Not Approved</Text>
        <Text style={styles.desc}>
          Unfortunately, your documents did not pass our verification.
        </Text>

        <View style={styles.reasonBox}>
          <Text style={styles.reasonLabel}>REASON</Text>
          <Text style={styles.reasonText}>Photo of ID is blurry</Text>
        </View>

        <PrimaryButton
          label="Re-upload Documents"
          onPress={() => router.push('/(bangkero)/verify-boat')}
          style={{ marginTop: spacing.xl }}
        />
        <PrimaryButton
          label="Back to Home"
          variant="secondary"
          onPress={() => router.push('/(bangkero)/home')}
          style={{ marginTop: spacing.md }}
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
    backgroundColor: colors.dangerTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  icon: { color: colors.danger, fontSize: 36, fontWeight: '700' },
  title: { ...typography.h2, textAlign: 'center', marginBottom: spacing.md },
  desc: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  reasonBox: {
    width: '100%',
    backgroundColor: colors.dangerTintSoft,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    padding: spacing.lg,
    marginTop: spacing.xl,
  },
  reasonLabel: { ...typography.label, marginBottom: spacing.xs },
  reasonText: { color: colors.danger, fontSize: 14, fontWeight: '600' },
});
