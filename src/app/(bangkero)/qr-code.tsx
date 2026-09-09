import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { useAuth } from '@/hooks/useAuth';
import { useBangkero } from '@/hooks/useSupabase';
import { colors, radii, spacing, typography } from '@/theme/tokens';

export default function QrCode() {
  const { user, profile } = useAuth();
  const bangkero = useBangkero(user?.id ?? null);

  const boatName = bangkero.data?.displayName ?? 'No boat name';
  const permitNum = bangkero.data?.permitNumber ?? 'N/A';
  const bangkeroName = profile
    ? `${profile.firstName} ${profile.lastName}`.trim()
    : 'Unknown';

  return (
    <ScreenContainer padded={false}>
      <View style={styles.scroll}>
        <Text style={styles.back} onPress={() => router.back()}>← Back</Text>

        <Text style={styles.eyebrow}>VERIFICATION</Text>
        <Text style={styles.title}>Scan to Verify</Text>

        <View style={styles.qrBox}>
          <View style={styles.qrPlaceholder}>
            <Text style={styles.qrText}>QR CODE</Text>
          </View>
        </View>

        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>BOAT NAME</Text>
            <Text style={styles.infoValue}>{boatName}</Text>
          </View>
          <View style={styles.infoDivider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>PERMIT NUMBER</Text>
            <Text style={styles.infoValue}>{permitNum}</Text>
          </View>
          <View style={styles.infoDivider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>BANGKERO</Text>
            <Text style={styles.infoValue}>{bangkeroName}</Text>
          </View>
        </View>

        <View style={styles.footer}>
          <PrimaryButton
            label="My Bookings"
            variant="secondary"
            onPress={() => router.push('/(bangkero)/home')}
          />
          <PrimaryButton
            label="Back to Home"
            onPress={() => router.replace('/(bangkero)/home')}
          />
        </View>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
    alignItems: 'center',
  },

  back: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: spacing.lg,
    alignSelf: 'flex-start',
  },
  eyebrow: { ...typography.label, marginBottom: 2 },
  title: { ...typography.h1, marginBottom: spacing.xl },

  qrBox: {
    width: 220,
    height: 220,
    backgroundColor: colors.bgElevated,
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: colors.borderSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  qrPlaceholder: {
    width: 180,
    height: 180,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrText: { color: colors.textMuted, fontSize: 16, fontWeight: '700', letterSpacing: 2 },

  infoCard: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  infoLabel: { ...typography.label, flex: 1 },
  infoValue: { color: colors.text, fontSize: 14, fontWeight: '600', textAlign: 'right', flex: 1 },
  infoDivider: { height: 1, backgroundColor: colors.borderSubtle },

  footer: { width: '100%', gap: spacing.md },
});
