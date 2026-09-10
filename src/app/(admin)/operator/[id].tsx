import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { TicketCard } from '@/components/TicketCard';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { useAllTrips } from '@/hooks/useAllTrips';
import { useOperators } from '@/hooks/useOperators';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import type { VerificationStatus, BangkeroDoc } from '@/types/models';

const STATUS_STYLE: Record<VerificationStatus, { fg: string; bg: string }> = {
  verified: { fg: colors.primary, bg: 'rgba(52,214,176,0.14)' },
  pending: { fg: colors.warning, bg: colors.warningTint },
  rejected: { fg: colors.danger, bg: 'rgba(224,82,82,0.14)' },
};

const DOC_STATUS = ['Uploaded', 'Pending', 'Missing'] as const;

interface DocItem {
  label: string;
  status: (typeof DOC_STATUS)[number];
}

function getDocs(op: BangkeroDoc): DocItem[] {
  return [
    { label: "Gov't ID", status: op.govIssuedId ? 'Uploaded' : 'Missing' },
    { label: 'Boat Registration', status: op.boatRegistrationCert ? 'Uploaded' : 'Missing' },
    { label: 'Coastal Permit', status: op.coastalPermit ? 'Uploaded' : 'Missing' },
    { label: 'Brgy Clearance', status: op.brgyClearance ? 'Uploaded' : 'Missing' },
  ];
}

export default function OperatorDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, loading, error } = useOperators();
  const { data: trips } = useAllTrips();
  const [actionLoading, setActionLoading] = useState(false);

  if (loading) {
    return (
      <View style={styles.center}>
        <LoadingState label="Loading operator…" />
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

  const operator = data.find((o) => o.uid === id);
  if (!operator) {
    return (
      <View style={styles.center}>
        <EmptyState icon="👤" title="Not found" message="Operator not found." />
      </View>
    );
  }

  const st = STATUS_STYLE[operator.verificationStat];
  const docs = getDocs(operator);
  const recentTrips = trips.filter((t) => t.operatorId === id).slice(0, 5);

  const handleApprove = () => {
    setActionLoading(true);
    setTimeout(() => setActionLoading(false), 800);
  };

  const handleReject = () => {
    setActionLoading(true);
    setTimeout(() => setActionLoading(false), 800);
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.scroll}>
      <Text style={styles.back} onPress={() => router.back()}>← Back</Text>

      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {operator.displayName.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.headerInfo}>
          <Text style={styles.name}>{operator.displayName}</Text>
          <Text style={styles.permit}>
            {operator.permitNumber ?? 'No permit number'}
          </Text>
        </View>
        <View style={[styles.badge, { backgroundColor: st.bg }]}>
          <Text style={[styles.badgeText, { color: st.fg }]}>
            {operator.verificationStat.charAt(0).toUpperCase() + operator.verificationStat.slice(1)}
          </Text>
        </View>
      </View>

      <Text style={styles.sectionLabel}>VERIFICATION DOCUMENTS</Text>
      <View style={styles.docsGrid}>
        {docs.map((doc) => {
          const isUploaded = doc.status === 'Uploaded';
          const isMissing = doc.status === 'Missing';
          return (
            <View
              key={doc.label}
              style={[
                styles.docCard,
                isMissing && styles.docCardMissing,
                isUploaded && styles.docCardOk,
              ]}
            >
              <Text style={styles.docIcon}>
                {isUploaded ? '✅' : isMissing ? '❌' : '⏳'}
              </Text>
              <Text style={styles.docLabel}>{doc.label}</Text>
              <Text style={[
                styles.docStatus,
                { color: isUploaded ? colors.primary : isMissing ? colors.danger : colors.warning },
              ]}>
                {doc.status}
              </Text>
            </View>
          );
        })}
      </View>

      {operator.verificationStat === 'pending' && (
        <View style={styles.actions}>
          <PrimaryButton
            label="Approve"
            onPress={handleApprove}
            loading={actionLoading}
            style={styles.actionBtn}
          />
          <PrimaryButton
            label="Reject"
            onPress={handleReject}
            loading={actionLoading}
            variant="danger"
            style={styles.actionBtn}
          />
        </View>
      )}

      <Text style={[styles.sectionLabel, { marginTop: spacing.xxl }]}>RECENT TRIPS</Text>
      {recentTrips.length === 0 ? (
        <EmptyState
          icon="🚤"
          title="No trips yet"
          message="This operator has no trip history."
        />
      ) : (
        <View style={styles.tripList}>
          {recentTrips.map((t) => (
            <TicketCard key={t.bookingId} booking={t} compact />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl, flexGrow: 1 },
  back: { color: colors.primary, fontSize: 14, fontWeight: '600', marginBottom: spacing.lg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.text, fontSize: 24, fontWeight: '700' },
  headerInfo: { flex: 1 },
  name: { color: colors.text, fontSize: 18, fontWeight: '700' },
  permit: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  badge: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.pill,
  },
  badgeText: { fontSize: 13, fontWeight: '700' },

  sectionLabel: { ...typography.label, marginBottom: spacing.md },

  docsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  docCard: {
    width: '47%',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    alignItems: 'center',
  },
  docCardMissing: { borderColor: 'rgba(224,82,82,0.3)' },
  docCardOk: { borderColor: 'rgba(52,214,176,0.3)' },
  docIcon: { fontSize: 28, marginBottom: spacing.sm },
  docLabel: { color: colors.text, fontSize: 13, fontWeight: '700', marginBottom: spacing.xs },
  docStatus: { fontSize: 12, fontWeight: '600' },

  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.xl,
  },
  actionBtn: { flex: 1 },

  tripList: { gap: spacing.md },
});
