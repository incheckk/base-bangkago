import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ScreenContainer } from '@/components/ScreenContainer';
import { AdminScreenHeader } from '@/components/AdminScreenHeader';
import { PrimaryButton } from '@/components/PrimaryButton';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { useAuth } from '@/hooks/useAuth';
import { useOperators } from '@/hooks/useOperators';
import { friendlyError } from '@/services/booking.service';
import { verifyBangkero } from '@/services/admin.service';
import { docPublicUrl } from '@/services/documents.service';
import { colors, radii, spacing, typography } from '@/theme/tokens';

/**
 * The four documents as the bangkero actually uploaded them — real
 * thumbnails, tap for a full-screen look. Status comes from the path
 * on the bangkeros row (nothing else writes those columns); the
 * decision is one Approve / Reject All pair because verification is
 * granted per bangkero, never per photo (verifyBangkero, admin.service).
 */
const DOC_TYPES: {
  key: string;
  label: string;
  icon: string;
  field: 'govIssuedId' | 'boatRegistrationCert' | 'coastalPermit' | 'brgyClearance';
}[] = [
  { key: 'govId', label: "Gov't ID", icon: '🪪', field: 'govIssuedId' },
  { key: 'boatReg', label: 'Boat Registration', icon: '📜', field: 'boatRegistrationCert' },
  { key: 'coastal', label: 'Coastal Permit', icon: '🌊', field: 'coastalPermit' },
  { key: 'brgy', label: 'Brgy Clearance', icon: '🏢', field: 'brgyClearance' },
];

export default function DocumentReviewScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { user } = useAuth();
  const { data, loading, error } = useOperators();
  const [remarks, setRemarks] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [decided, setDecided] = useState<'approved' | 'rejected' | null>(null);
  const [preview, setPreview] = useState<{ label: string; url: string } | null>(null);

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
      setDecided(status);
    } catch (e) {
      setActionError(friendlyError(e));
    }
    setActionLoading(false);
  }

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
            {operator.permitNumber ?? 'No permit number'} ·{' '}
            <Text style={[
              styles.opStat,
              { color: operator.verificationStat === 'verified' ? colors.success : colors.warning },
            ]}>
              {operator.verificationStat}
            </Text>
          </Text>
        </View>
      </View>

      <Text style={styles.sectionLabel}>DOCUMENTS</Text>
      {DOC_TYPES.map((doc) => {
        const path = operator[doc.field];
        const url = docPublicUrl(path);
        const uploaded = !!path;
        return (
          <Pressable
            key={doc.key}
            disabled={!url}
            onPress={() => url && setPreview({ label: doc.label, url })}
            style={({ pressed }) => [
              styles.docCard,
              uploaded ? styles.docCardOk : styles.docCardMissing,
              pressed && url && styles.docCardPressed,
            ]}
          >
            <View style={styles.docTop}>
              {url ? (
                <Image source={{ uri: url }} style={styles.docThumb} />
              ) : (
                <View style={styles.docThumbEmpty}>
                  <Text style={styles.docThumbIcon}>{doc.icon}</Text>
                </View>
              )}
              <View style={styles.docBody}>
                <Text style={styles.docLabel}>{doc.label}</Text>
                <Text style={[styles.docStatus, { color: uploaded ? colors.success : colors.danger }]}>
                  {uploaded ? 'Uploaded — tap to view' : 'Missing — nothing was uploaded'}
                </Text>
              </View>
              {uploaded && <Text style={styles.docView}>⤢</Text>}
            </View>
          </Pressable>
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

      {decided && (
        <View style={[styles.banner, decided === 'approved' ? styles.bannerOk : styles.bannerBad]}>
          <Text style={[styles.bannerText, { color: decided === 'approved' ? colors.success : colors.danger }]}>
            {decided === 'approved'
              ? 'Approved — the bangkero’s phone now shows Verified and they can go online.'
              : 'Rejected — the bangkero sees your remarks and can re-upload their documents.'}
          </Text>
        </View>
      )}

      <View style={styles.bottomActions}>
        <PrimaryButton
          label="Approve All"
          onPress={() => void decide('approved')}
          loading={actionLoading}
          disabled={actionLoading}
          style={styles.bottomBtn}
        />
        <PrimaryButton
          label="Reject All"
          onPress={() => void decide('rejected')}
          variant="danger"
          loading={actionLoading}
          disabled={actionLoading}
          style={styles.bottomBtn}
        />
      </View>
      </ScrollView>

      {/* Full-screen document preview */}
      <Modal
        visible={!!preview}
        transparent
        animationType="fade"
        onRequestClose={() => setPreview(null)}
      >
        <View style={styles.modalBg}>
          <Pressable
            style={styles.modalClose}
            onPress={() => setPreview(null)}
            accessibilityRole="button"
            accessibilityLabel="Close preview"
          >
            <Text style={styles.modalCloseText}>✕</Text>
          </Pressable>
          {preview && (
            <>
              <Image source={{ uri: preview.url }} style={styles.modalImg} resizeMode="contain" />
              <Text style={styles.modalLabel}>{preview.label}</Text>
            </>
          )}
        </View>
      </Modal>
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
    marginTop: spacing.lg,
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
  opStat: { fontWeight: '700', textTransform: 'capitalize' },

  sectionLabel: { ...typography.label, marginBottom: spacing.md },

  docCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  docCardOk: { borderColor: colors.success },
  docCardMissing: { borderColor: colors.dangerBorder },
  docCardPressed: { opacity: 0.8 },
  docTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  docThumb: { width: 56, height: 56, borderRadius: radii.sm, backgroundColor: colors.bgElevated },
  docThumbEmpty: {
    width: 56, height: 56, borderRadius: radii.sm,
    backgroundColor: colors.bgElevated, alignItems: 'center', justifyContent: 'center',
  },
  docThumbIcon: { fontSize: 22 },
  docBody: { flex: 1, minWidth: 0 },
  docLabel: { color: colors.text, fontSize: 15, fontWeight: '700' },
  docStatus: { fontSize: 12, fontWeight: '600', marginTop: 3 },
  docView: { color: colors.textMuted, fontSize: 20 },

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
  bannerOk: { backgroundColor: colors.successTint, borderColor: colors.success },
  bannerBad: { backgroundColor: colors.dangerTint, borderColor: colors.danger },
  bannerText: { flexShrink: 1, color: colors.danger, fontSize: 13, lineHeight: 18 },

  bottomActions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  bottomBtn: { flex: 1 },

  // ---------- full-screen preview ----------
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  modalClose: {
    position: 'absolute',
    top: spacing.xxl + 24,
    right: spacing.xl,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  modalCloseText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  modalImg: { width: '100%', height: '75%' },
  modalLabel: { ...typography.label, color: '#fff', marginTop: spacing.lg },
});
