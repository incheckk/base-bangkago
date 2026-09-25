import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ScreenContainer } from '@/components/ScreenContainer';
import { AdminScreenHeader } from '@/components/AdminScreenHeader';
import { PrimaryButton } from '@/components/PrimaryButton';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { useAuth } from '@/hooks/useAuth';
import { useOperators } from '@/hooks/useOperators';
import { friendlyError } from '@/services/booking.service';
import { verifyBangkero } from '@/services/admin.service';
import { colors, radii, spacing, typography } from '@/theme/tokens';

const DOC_TYPES = [
  { key: 'govId', label: "Gov't ID", icon: '🪪' },
  { key: 'boatReg', label: 'Boat Registration', icon: '📜' },
  { key: 'coastalPermit', label: 'Coastal Permit', icon: '🌊' },
  { key: 'brgyClearance', label: 'Brgy Clearance', icon: '🏢' },
];

export default function DocumentReviewScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { user } = useAuth();
  const { data, loading, error } = useOperators();
  const [remarks, setRemarks] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
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

  const approveDoc = (key: string) => {
    setDocs((prev) => ({ ...prev, [key]: 'uploaded' }));
  };

  const rejectDoc = (key: string) => {
    setDocs((prev) => ({ ...prev, [key]: 'missing' }));
  };

  async function decide(status: 'approved' | 'rejected') {
    if (!user || !operator || actionLoading) return;
    setActionLoading(true);
    setActionError(null);
    try {
      await verifyBangkero(
        operator.uid,
        user.id,
        status,
        status === 'rejected' ? remarks.trim() || undefined : undefined
      );
      const next: typeof docs = {};
      for (const d of DOC_TYPES) next[d.key] = status === 'approved' ? 'uploaded' : 'missing';
      setDocs(next);
    } catch (e) {
      setActionError(friendlyError(e));
    }
    setActionLoading(false);
  }

  const approveAll = () => decide('approved');
  const rejectAll = () => decide('rejected');

  return (
    <ScreenContainer padded={false}>
      <AdminScreenHeader eyebrow="REVIEW" title="Document Review" />
      <ScrollView contentContainerStyle={styles.scroll}>

      <View style={styles.opCard}>
        <View style={styles.opAvatar}>
          <Text style={styles.opAvatarText}>
            {operator.displayName.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.opInfo}>
          <Text style={styles.opName} numberOfLines={1}>{operator.displayName}</Text>
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

      {!!actionError && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{actionError}</Text>
        </View>
      )}

      <View style={styles.bottomActions}>
        <PrimaryButton
          label="Approve All"
          onPress={approveAll}
          loading={actionLoading}
          disabled={actionLoading}
          style={styles.bottomBtn}
        />
        <PrimaryButton
          label="Reject All"
          onPress={rejectAll}
          variant="danger"
          loading={actionLoading}
          disabled={actionLoading}
          style={styles.bottomBtn}
        />
      </View>
    </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl, flexGrow: 1 },

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
  opAvatarText: { flexShrink: 1, color: colors.text, fontSize: 20, fontWeight: '700' },
  opInfo: { flex: 1 },
  opName: { flexShrink: 1, color: colors.text, fontSize: 16, fontWeight: '700' },
  opPermit: { flexShrink: 1, color: colors.textMuted, fontSize: 13, marginTop: 2 },

  sectionLabel: { ...typography.label, marginBottom: spacing.md },

  docCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  docCardOk: { borderColor: colors.primaryBorder },
  docCardMissing: { borderColor: colors.dangerBorder },
  docTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  docIcon: { flexShrink: 1, fontSize: 24 },
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

  banner: {
    backgroundColor: colors.dangerTint,
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  bannerText: { flexShrink: 1, color: colors.danger, fontSize: 13, lineHeight: 18 },

  bottomActions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  bottomBtn: { flex: 1 },
});
