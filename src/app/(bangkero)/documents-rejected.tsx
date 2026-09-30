import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { BangkeroScreenHeader } from '@/components/BangkeroScreenHeader';
import { Icon } from '@/components/Icon';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { LoadingState } from '@/components/States';
import { useAuth } from '@/hooks/useAuth';
import { useBangkero } from '@/hooks/useSupabase';
import { documentsRoute, getLatestVerification } from '@/services/documents.service';
import { colors, radii, spacing, typography } from '@/theme/tokens';

/**
 * Rejection with the admin's REAL remarks — the sentence typed on
 * the review screen, not a placeholder. Documents unlock again: the
 * Re-upload button lands on the editable verify screen.
 */
export default function DocumentsRejected() {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const bangkero = useBangkero(uid);
  const [remarks, setRemarks] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const stat = bangkero.data?.verificationStat;
  useEffect(() => {
    if (!stat || stat === 'rejected') return;
    router.replace(documentsRoute(stat));
  }, [stat]);

  useEffect(() => {
    if (!uid) return;
    let alive = true;
    getLatestVerification(uid)
      .then((v) => { if (alive) setRemarks(v?.remarks ?? null); })
      .catch(() => { /* fall back to the generic line */ })
      .finally(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [uid]);

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
          {!loaded ? (
            <LoadingState label="Loading remarks…" />
          ) : (
            <Text style={styles.reasonText}>
              {remarks?.trim() || 'No reason given — re-upload clearer photos of your documents.'}
            </Text>
          )}
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
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
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
    minHeight: 72,
  },
  reasonLabel: { ...typography.label, marginBottom: spacing.xs },
  reasonText: { color: colors.danger, fontSize: 14, fontWeight: '600', lineHeight: 20 },
});
