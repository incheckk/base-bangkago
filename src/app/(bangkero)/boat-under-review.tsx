import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { BangkeroScreenHeader } from '@/components/BangkeroScreenHeader';
import { Icon } from '@/components/Icon';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { ProgressBar } from '@/components/ProgressBar';
import { useAuth } from '@/hooks/useAuth';
import { useRefetchOnFocus } from '@/hooks/useRealtimeQuery';
import { useBangkero } from '@/hooks/useSupabase';
import {
  DOCUMENT_FIELDS, type DocPaths, docPublicUrl, documentsRoute, getDocPaths,
} from '@/services/documents.service';
import { colors, radii, spacing, typography } from '@/theme/tokens';

/**
 * Step 1 — submitted and locked. Images are read-only here; they
 * unlock again only if the admin rejects. The admin's decision flips
 * bangkeros.verification_stat (realtime via useBangkero) and this
 * screen follows it to the approved or rejected screen on its own.
 */
export default function BoatUnderReview() {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const bangkero = useBangkero(uid);
  const [paths, setPaths] = useState<DocPaths | null>(null);

  const stat = bangkero.data?.verificationStat;
  useEffect(() => {
    if (!stat || stat === 'pending') return;
    router.replace(documentsRoute(stat));
  }, [stat]);

  const loadPaths = useCallback(async () => {
    if (!uid) return;
    try {
      setPaths(await getDocPaths(uid));
    } catch {
      // the locked list simply stays as it was
    }
  }, [uid]);
  useEffect(() => { void loadPaths(); }, [loadPaths]);
  useRefetchOnFocus(loadPaths);

  return (
    <ScreenContainer padded={false}>
      <BangkeroScreenHeader title="Boat Verification" showBack={false} />
      <View style={styles.container}>
        <View style={styles.iconWrap}>
          <Icon name="history" size={34} color={colors.warning} />
        </View>

        <View style={styles.progressWrap}>
          <ProgressBar steps={['Upload', 'Review', 'Approved']} current={1} />
        </View>

        <Text style={styles.title}>Documents Under Review</Text>
        <Text style={styles.desc}>
          Our team will review your documents within 24-48 hours.{'\n'}
          We&apos;ll notify you once a decision has been made.
        </Text>

        {/* Submitted set — locked until the admin decides. */}
        <View style={styles.docList}>
          {DOCUMENT_FIELDS.map((doc) => {
            const url = docPublicUrl(paths?.[doc.key]);
            return (
              <View key={doc.key} style={styles.docRow}>
                {url ? (
                  <Image source={{ uri: url }} style={styles.docThumb} />
                ) : (
                  <View style={styles.docThumbEmpty}>
                    <Text style={styles.docThumbIcon}>{doc.icon}</Text>
                  </View>
                )}
                <Text style={styles.docLabel} numberOfLines={1}>{doc.label}</Text>
                <Text style={styles.docLocked}>🔒 Locked</Text>
              </View>
            );
          })}
        </View>

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
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.warningTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  progressWrap: { width: '100%', marginBottom: spacing.xl },
  title: { ...typography.h2, textAlign: 'center', marginBottom: spacing.md },
  desc: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.xl,
  },

  docList: { width: '100%', gap: spacing.sm, marginBottom: spacing.lg },
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.sm,
  },
  docThumb: { width: 40, height: 40, borderRadius: radii.xs, backgroundColor: colors.bgElevated },
  docThumbEmpty: {
    width: 40, height: 40, borderRadius: radii.xs,
    backgroundColor: colors.bgElevated, alignItems: 'center', justifyContent: 'center',
  },
  docThumbIcon: { fontSize: 16 },
  docLabel: { flex: 1, color: colors.text, fontSize: 13, fontWeight: '600' },
  docLocked: { ...typography.caption, color: colors.textMuted },

  support: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
  supportLink: { color: colors.primary, fontWeight: '600' },
});
