import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { useOperators } from '@/hooks/useOperators';
import { colors, radii, spacing, typography } from '@/theme/tokens';

const DOC_TYPES = [
  { key: 'govId', label: "Gov't ID", icon: '🪪' },
  { key: 'boatReg', label: 'Boat Registration', icon: '📜' },
  { key: 'coastalPermit', label: 'Coastal Permit', icon: '🌊' },
  { key: 'brgyClearance', label: 'Brgy Clearance', icon: '🏢' },
];

export default function DocumentReviewScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { data, loading, error } = useOperators();
  const [remarks, setRemarks] = useState('');
  const [docs, setDocs] = useState<Record<string, 'uploaded' | 'pending' | 'missing'>>({
    govId: 'pending',
    boatReg: 'pending',
    coastalPermit: 'pending',
    brgyClearance: 'pending',
  });

  if (loading) {
    return (
      <View style={styles.center}>
        <LoadingState label="Loading documents…" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <ErrorState message={error} />
      </View>
    );
  }

  const operator = id
    ? data.find((o) => o.uid === id)
    : data.find((o) => o.verificationStat === 'pending') ?? data[0];

  if (!operator) {
    return (
      <View style={styles.center}>
        <EmptyState icon="👤" title="Not found" message="Operator not found." />
      </View>
    );
  }

  const toggleDocStatus = (key: string) => {
    setDocs((prev) => {
      const current = prev[key];
      const next = current === 'uploaded' ? 'missing' : current === 'missing' ? 'pending' : 'uploaded';
      return { ...prev, [key]: next };
    });
  };

  const approveDoc = (key: string) => {
    setDocs((prev) => ({ ...prev, [key]: 'uploaded' }));
  };

  const rejectDoc = (key: string) => {
    setDocs((prev) => ({ ...prev, [key]: 'missing' }));
  };

  const approveAll = () => {
    const next: typeof docs = {};
    for (const d of DOC_TYPES) next[d.key] = 'uploaded';
    setDocs(next);
  };

  const rejectAll = () => {
    const next: typeof docs = {};
    for (const d of DOC_TYPES) next[d.key] = 'missing';
    setDocs(next);
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.scroll}>
      <Text style={styles.back} onPress={() => router.back()}>← Back</Text>
      <Text style={styles.eyebrow}>REVIEW</Text>
      <Text style={styles.title}>Document Review</Text>

      <View style={styles.opCard}>
        <View style={styles.opAvatar}>
          <Text style={styles.opAvatarText}>
            {operator.displayName.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.opInfo}>
          <Text style={styles.opName}>{operator.displayName}</Text>
          <Text style={styles.opPermit}>
            {operator.permitNumber ?? 'No permit number'}
          </Text>
        </View>
      </View>

      <Text style={styles.sectionLabel}>DOCUMENTS</Text>
      {DOC_TYPES.map((doc) => {
        const status = docs[doc.key];
        const isUploaded = status === 'uploaded';
        const isMissing = status === 'missing';
        return (
          <View
            key={doc.key}
            style={[
              styles.docCard,
              isUploaded && styles.docCardOk,
              isMissing && styles.docCardMissing,
            ]}
          >
            <View style={styles.docTop}>
              <Text style={styles.docIcon}>{doc.icon}</Text>
              <Text style={styles.docLabel}>{doc.label}</Text>
              <Text style={[
                styles.docStatus,
                { color: isUploaded ? colors.primary : isMissing ? colors.danger : colors.warning },
              ]}>
                {isUploaded ? 'Uploaded' : isMissing ? 'Missing' : 'Pending'}
              </Text>
            </View>
            <View style={styles.docActions}>
              <PrimaryButton
                label="Approve"
                onPress={() => approveDoc(doc.key)}
                variant="primary"
                style={styles.docBtn}
              />
              <PrimaryButton
                label="Reject"
                onPress={() => rejectDoc(doc.key)}
                variant="danger"
                style={styles.docBtn}
              />
            </View>
          </View>
        );
      })}

      <Text style={[styles.sectionLabel, { marginTop: spacing.xl }]}>REMARKS</Text>
      <View style={styles.remarksWrap}>
        <TextInput
          style={styles.remarksInput}
          placeholder="Add rejection remarks (optional)…"
          placeholderTextColor={colors.textMuted}
          value={remarks}
          onChangeText={setRemarks}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
        />
      </View>

      <View style={styles.bottomActions}>
        <PrimaryButton
          label="Approve All"
          onPress={approveAll}
          style={styles.bottomBtn}
        />
        <PrimaryButton
          label="Reject All"
          onPress={rejectAll}
          variant="danger"
          style={styles.bottomBtn}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl, flexGrow: 1 },
  back: { color: colors.primary, fontSize: 14, fontWeight: '600', marginBottom: spacing.lg },
  eyebrow: { ...typography.label, marginBottom: 2 },
  title: { ...typography.h1, marginBottom: spacing.xl },

  opCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  opAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  opAvatarText: { color: colors.text, fontSize: 20, fontWeight: '700' },
  opInfo: { flex: 1 },
  opName: { color: colors.text, fontSize: 16, fontWeight: '700' },
  opPermit: { color: colors.textMuted, fontSize: 13, marginTop: 2 },

  sectionLabel: { ...typography.label, marginBottom: spacing.md },

  docCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  docCardOk: { borderColor: 'rgba(52,214,176,0.3)' },
  docCardMissing: { borderColor: 'rgba(224,82,82,0.3)' },
  docTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  docIcon: { fontSize: 24 },
  docLabel: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '700' },
  docStatus: { fontSize: 13, fontWeight: '600' },
  docActions: { flexDirection: 'row', gap: spacing.sm },
  docBtn: { flex: 1, height: 40 },

  remarksWrap: { marginBottom: spacing.xl },
  remarksInput: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    color: colors.text,
    fontSize: 14,
    padding: spacing.lg,
    minHeight: 80,
  },

  bottomActions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  bottomBtn: { flex: 1 },
});
