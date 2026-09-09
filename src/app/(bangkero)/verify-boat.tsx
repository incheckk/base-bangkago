import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { ProgressBar } from '@/components/ProgressBar';
import { ScreenContainer } from '@/components/ScreenContainer';
import { colors, radii, spacing, typography } from '@/theme/tokens';

const DOCUMENTS = [
  { key: 'govId', label: "Government-Issued ID", icon: '🪪' },
  { key: 'boatReg', label: 'Boat Registration Certificate', icon: '🚤' },
  { key: 'coastal', label: 'Coastal Permit', icon: '🌊' },
  { key: 'brgy', label: 'Barangay Clearance', icon: '📜' },
] as const;

type DocKey = typeof DOCUMENTS[number]['key'];

export default function VerifyBoat() {
  const [uploaded, setUploaded] = useState<Record<DocKey, boolean>>({
    govId: false,
    boatReg: false,
    coastal: false,
    brgy: false,
  });
  const [submitting, setSubmitting] = useState(false);

  const doneCount = Object.values(uploaded).filter(Boolean).length;
  const allDone = doneCount === DOCUMENTS.length;

  function simulateUpload(key: DocKey) {
    setUploaded((prev) => ({ ...prev, [key]: true }));
  }

  async function handleSubmit() {
    if (!allDone) return;
    setSubmitting(true);
    // Simulate submission
    await new Promise((r) => setTimeout(r, 1000));
    setSubmitting(false);
    router.push('/(bangkero)/boat-under-review');
  }

  return (
    <ScreenContainer padded={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.back} onPress={() => router.back()}>← Back</Text>
        <Text style={styles.eyebrow}>STEP 1</Text>
        <Text style={styles.title}>Upload Documents</Text>

        <View style={styles.progressWrap}>
          <ProgressBar steps={['Upload', 'Review', 'Approved']} current={0} />
        </View>

        <View style={styles.docList}>
          {DOCUMENTS.map((doc) => {
            const isUp = uploaded[doc.key];
            return (
              <View key={doc.key} style={styles.docItem}>
                <View style={styles.docIcon}>
                  <Text style={styles.docIconText}>{doc.icon}</Text>
                </View>
                <Text style={styles.docLabel}>{doc.label}</Text>
                <Pressable
                  onPress={() => simulateUpload(doc.key)}
                  style={[styles.uploadBtn, isUp && styles.uploadBtnDone]}
                  disabled={isUp}
                >
                  <Text style={[styles.uploadText, isUp && styles.uploadTextDone]}>
                    {isUp ? '✓ Uploaded' : 'Upload'}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </View>

        <PrimaryButton
          label="Submit for Review"
          onPress={handleSubmit}
          loading={submitting}
          disabled={!allDone}
          style={{ marginTop: spacing.xl }}
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
  back: { color: colors.primary, fontSize: 14, fontWeight: '600', marginBottom: spacing.lg },
  eyebrow: { ...typography.label, marginBottom: 2 },
  title: { ...typography.h1, marginBottom: spacing.xl },

  progressWrap: { marginBottom: spacing.xl },

  docList: { gap: spacing.md },
  docItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    gap: spacing.md,
  },
  docIcon: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    backgroundColor: colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  docIconText: { fontSize: 18 },
  docLabel: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '600' },
  uploadBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
  },
  uploadBtnDone: {
    backgroundColor: 'rgba(52,214,176,0.15)',
  },
  uploadText: { color: colors.primaryText, fontSize: 13, fontWeight: '700' },
  uploadTextDone: { color: colors.primary },
});
