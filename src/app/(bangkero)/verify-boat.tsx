import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BangkeroScreenHeader } from '@/components/BangkeroScreenHeader';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ProgressBar } from '@/components/ProgressBar';
import { ScreenContainer } from '@/components/ScreenContainer';
import { LoadingState } from '@/components/States';
import { useAuth } from '@/hooks/useAuth';
import { useRefetchOnFocus } from '@/hooks/useRealtimeQuery';
import { useBangkero } from '@/hooks/useSupabase';
import { friendlyError } from '@/services/booking.service';
import {
  DOCUMENT_FIELDS,
  type DocKey,
  type DocPaths,
  type PickSource,
  docPublicUrl,
  getDocPaths,
  pickImage,
  removeDocImage,
  submitForReview,
  uploadDocImage,
} from '@/services/documents.service';
import { colors, radii, spacing, typography } from '@/theme/tokens';

/**
 * Step 0 of verification — the only editable state. Submitting locks
 * the images (they sail to the admin review screen) and moves the
 * bangkero to 'pending'; an admin rejection unlocks them again.
 * The state machine itself lives in the server value: whichever
 * screen you deep-link into, a mismatched state redirects you to the
 * one that matches bangkeros.verification_stat.
 */
export default function VerifyBoat() {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const bangkero = useBangkero(uid);

  const [paths, setPaths] = useState<DocPaths | null>(null);
  const [uploading, setUploading] = useState<DocKey | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stat = bangkero.data?.verificationStat;
  useEffect(() => {
    if (!stat) return;
    if (stat === 'pending') router.replace('/(bangkero)/boat-under-review');
    else if (stat === 'verified') router.replace('/(bangkero)/documents-approved');
  }, [stat]);

  const loadPaths = useCallback(async () => {
    if (!uid) return;
    try {
      setPaths(await getDocPaths(uid));
    } catch (e) {
      setError(friendlyError(e));
    }
  }, [uid]);
  useEffect(() => { void loadPaths(); }, [loadPaths]);
  useRefetchOnFocus(loadPaths);

  const doneCount = paths
    ? DOCUMENT_FIELDS.filter((f) => paths[f.key]).length
    : 0;
  const allDone = doneCount === DOCUMENT_FIELDS.length;

  function chooseImage(key: DocKey, label: string) {
    const options: {
      text: string;
      style?: 'destructive' | 'cancel';
      onPress?: () => void;
    }[] = [
      { text: 'Take photo', onPress: () => void doUpload(key, 'camera') },
      { text: 'Choose from gallery', onPress: () => void doUpload(key, 'gallery') },
    ];
    if (paths?.[key]) {
      options.push({ text: 'Remove', style: 'destructive', onPress: () => void doRemove(key) });
    }
    options.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(label, 'Add a photo of this document', options);
  }

  async function doUpload(key: DocKey, source: PickSource) {
    if (!uid) return;
    try {
      setError(null);
      const uri = await pickImage(source);
      if (!uri) return;
      setUploading(key);
      await uploadDocImage(uid, key, uri);
      await loadPaths();
    } catch (e) {
      setError(friendlyError(e));
    }
    setUploading(null);
  }

  async function doRemove(key: DocKey) {
    if (!uid) return;
    try {
      setError(null);
      setUploading(key);
      await removeDocImage(uid, key);
      await loadPaths();
    } catch (e) {
      setError(friendlyError(e));
    }
    setUploading(null);
  }

  async function handleSubmit() {
    if (!uid || !allDone || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitForReview(uid);
      router.replace('/(bangkero)/boat-under-review');
    } catch (e) {
      setError(friendlyError(e));
    }
    setSubmitting(false);
  }

  if (bangkero.loading || !paths) {
    return (
      <ScreenContainer padded={false}>
        <BangkeroScreenHeader title="Verify Boat" subtitle="UPLOAD DOCUMENTS" />
        <View style={styles.center}><LoadingState label="Loading documents…" /></View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padded={false}>
      <BangkeroScreenHeader title="Verify Boat" subtitle="UPLOAD DOCUMENTS" />
      <ScrollView contentContainerStyle={styles.scroll}>

        <View style={styles.progressWrap}>
          <ProgressBar steps={['Upload', 'Review', 'Approved']} current={0} />
        </View>

        <Text style={styles.hint}>
          Take a photo or pick from your gallery. All four documents are required —
          you can replace or remove any of them until you submit.
        </Text>

        {/* Rejected operators land here to re-upload (documents-rejected
            links back), so the rejection must be visible on this screen —
            not just on the notice screen. No redirect: bouncing away would
            make re-upload unreachable. */}
        {stat === 'rejected' && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>
              The admin rejected your documents — upload replacements below and
              submit to send them back for review.
            </Text>
          </View>
        )}

        <View style={styles.docList}>
          {DOCUMENT_FIELDS.map((doc) => {
            const path = paths[doc.key];
            const url = docPublicUrl(path);
            const busy = uploading === doc.key;
            return (
              <View key={doc.key} style={styles.docItem}>
                {url ? (
                  <Image source={{ uri: url }} style={styles.docThumb} />
                ) : (
                  <View style={styles.docIcon}>
                    <Text style={styles.docIconText}>{doc.icon}</Text>
                  </View>
                )}
                <View style={styles.docBody}>
                  <Text style={styles.docLabel}>{doc.label}</Text>
                  <Text style={[styles.docState, path ? styles.docStateOk : styles.docStateNo]}>
                    {busy ? 'Saving…' : path ? '✓ Uploaded' : 'Not uploaded'}
                  </Text>
                </View>
                <Pressable
                  onPress={() => chooseImage(doc.key, doc.label)}
                  disabled={busy}
                  style={({ pressed }) => [
                    styles.uploadBtn,
                    path && styles.uploadBtnReplace,
                    (busy || pressed) && styles.uploadBtnPressed,
                  ]}
                >
                  <Text style={[styles.uploadText, path && styles.uploadTextReplace]}>
                    {busy ? '…' : path ? 'Replace' : 'Upload'}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </View>

        {!!error && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>{error}</Text>
          </View>
        )}

        <View style={styles.submitRow}>
          <Text style={styles.submitCount}>{doneCount} of {DOCUMENT_FIELDS.length} uploaded</Text>
          <PrimaryButton
            label="Submit for Review"
            onPress={handleSubmit}
            loading={submitting}
            disabled={!allDone || submitting}
            style={styles.submitBtn}
          />
        </View>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },

  progressWrap: { marginBottom: spacing.lg },
  hint: { ...typography.caption, color: colors.textMuted, lineHeight: 18, marginBottom: spacing.lg },

  docList: { gap: spacing.md },
  docItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.md,
    gap: spacing.md,
  },
  docIcon: {
    width: 48,
    height: 48,
    borderRadius: radii.sm,
    backgroundColor: colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  docIconText: { flexShrink: 1, fontSize: 20 },
  docThumb: {
    width: 48,
    height: 48,
    borderRadius: radii.sm,
    backgroundColor: colors.bgElevated,
  },
  docBody: { flex: 1, minWidth: 0 },
  docLabel: { color: colors.text, fontSize: 14, fontWeight: '600' },
  docState: { ...typography.caption, marginTop: 2 },
  docStateOk: { color: colors.success },
  docStateNo: { color: colors.textMuted },
  uploadBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
  },
  uploadBtnReplace: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  uploadBtnPressed: { opacity: 0.7 },
  uploadText: { flexShrink: 1, color: colors.primaryText, fontSize: 13, fontWeight: '700' },
  uploadTextReplace: { color: colors.text },

  banner: {
    marginTop: spacing.lg,
    backgroundColor: colors.dangerTint,
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  bannerText: { flexShrink: 1, color: colors.danger, fontSize: 13, lineHeight: 18 },

  submitRow: { marginTop: spacing.xl, gap: spacing.md },
  submitCount: { ...typography.label, color: colors.textSecondary },
  submitBtn: { width: '100%' },
});
