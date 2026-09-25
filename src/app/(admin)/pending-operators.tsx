import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ScreenContainer } from '@/components/ScreenContainer';
import { AdminScreenHeader } from '@/components/AdminScreenHeader';
import { FilterChips } from '@/components/FilterChips';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { useOperators } from '@/hooks/useOperators';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import type { VerificationStatus } from '@/types/models';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'verified', label: 'Verified' },
];

const STATUS_STYLE: Record<VerificationStatus, { fg: string; bg: string }> = {
  verified: { fg: colors.primary, bg: colors.primaryTint },
  pending: { fg: colors.warning, bg: colors.warningTint },
  rejected: { fg: colors.danger, bg: colors.dangerTint },
};

export default function PendingOperatorsScreen() {
  const [filter, setFilter] = useState('all');
  const statusParam = filter === 'all' ? undefined : (filter as VerificationStatus);
  const { data, loading, error } = useOperators(statusParam);

  if (loading) {
    return (
      <View style={styles.center}>
        <LoadingState label="Loading pending operators…" />
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

  return (
    <ScreenContainer padded={false}>
      <AdminScreenHeader
        eyebrow="APPROVALS"
        title="Pending Approvals"
        subtitle={`${data.length} awaiting review`}
      />
      <ScrollView contentContainerStyle={styles.scroll}>

      <FilterChips filters={FILTERS} active={filter} onChange={setFilter} />

      {data.length === 0 ? (
        <EmptyState
          icon="✅"
          title="All caught up"
          message="No operators pending review."
        />
      ) : (
        <View style={styles.list}>
          {data.map((op) => {
            const st = STATUS_STYLE[op.verificationStat];
            return (
              <Pressable
                key={op.uid}
                onPress={() => router.push(`/(admin)/operator/${op.uid}`)}
                style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
              >
                <View style={styles.cardTop}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>
                      {op.displayName.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.cardInfo}>
                    <Text style={styles.name} numberOfLines={1}>{op.displayName}</Text>
                    <Text style={styles.permit}>
                      {op.permitNumber ?? 'No permit number'}
                    </Text>
                  </View>
                  <View style={[styles.badge, { backgroundColor: st.bg }]}>
                    <Text style={[styles.badgeText, { color: st.fg }]}>
                      {op.verificationStat.charAt(0).toUpperCase() + op.verificationStat.slice(1)}
                    </Text>
                  </View>
                </View>

                <View style={styles.docsRow}>
                  <DocDot label="Gov't ID" uploaded={!!op.govIssuedId} />
                  <DocDot label="Boat Reg" uploaded={!!op.boatRegistrationCert} />
                  <DocDot label="Coastal" uploaded={!!op.coastalPermit} />
                  <DocDot label="Brgy" uploaded={!!op.brgyClearance} />
                </View>

                <Text style={styles.reviewLink}>Tap to review →</Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </ScrollView>
    </ScreenContainer>
  );
}

function DocDot({ label, uploaded }: { label: string; uploaded: boolean }) {
  return (
    <View style={styles.docDotWrap}>
      <View style={[styles.docDot, { backgroundColor: uploaded ? colors.primary : colors.danger }]} />
      <Text style={styles.docDotLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl, flexGrow: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xl,
  },
  countBadge: {
    backgroundColor: colors.warning,
    borderRadius: radii.pill,
    minWidth: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },

  list: { gap: spacing.md, marginTop: spacing.sm },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
  },
  cardPressed: { borderColor: colors.warning },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { flexShrink: 1, color: colors.text, fontSize: 18, fontWeight: '700' },
  cardInfo: { flex: 1 },
  name: { flexShrink: 1, color: colors.text, fontSize: 15, fontWeight: '700' },
  permit: { flexShrink: 1, color: colors.textMuted, fontSize: 12, marginTop: 2 },
  badge: {
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radii.pill,
  },
  badgeText: { flexShrink: 1, fontSize: 12, fontWeight: '700' },

  docsRow: {
    flexDirection: 'row',
    gap: spacing.lg,
    marginTop: spacing.md,
  },
  docDotWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  docDot: { width: 7, height: 7, borderRadius: 4 },
  docDotLabel: { flexShrink: 1, color: colors.textSecondary, fontSize: 11 },

  reviewLink: { color: colors.warning, fontSize: 13, fontWeight: '600', marginTop: spacing.md },
});
