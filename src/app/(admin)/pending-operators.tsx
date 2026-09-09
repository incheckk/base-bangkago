import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

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
  verified: { fg: colors.primary, bg: 'rgba(52,214,176,0.14)' },
  pending: { fg: '#F59E0B', bg: 'rgba(245,158,11,0.14)' },
  rejected: { fg: colors.danger, bg: 'rgba(224,82,82,0.14)' },
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
    <ScrollView style={styles.screen} contentContainerStyle={styles.scroll}>
      <Text style={styles.back} onPress={() => router.back()}>← Back</Text>

      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.eyebrow}>APPROVALS</Text>
          <Text style={styles.title}>Pending Approvals</Text>
        </View>
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{data.length}</Text>
        </View>
      </View>

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
                    <Text style={styles.name}>{op.displayName}</Text>
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
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl, flexGrow: 1 },
  back: { color: colors.primary, fontSize: 14, fontWeight: '600', marginBottom: spacing.lg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xl,
  },
  headerLeft: { flex: 1 },
  eyebrow: { ...typography.label, marginBottom: 2 },
  title: { ...typography.h1 },
  countBadge: {
    backgroundColor: '#F59E0B',
    borderRadius: radii.pill,
    minWidth: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  countText: { color: '#1A1A1A', fontSize: 15, fontWeight: '700' },

  list: { gap: spacing.md, marginTop: spacing.sm },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
  },
  cardPressed: { borderColor: '#F59E0B' },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.text, fontSize: 18, fontWeight: '700' },
  cardInfo: { flex: 1 },
  name: { color: colors.text, fontSize: 15, fontWeight: '700' },
  permit: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  badge: {
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radii.pill,
  },
  badgeText: { fontSize: 12, fontWeight: '700' },

  docsRow: {
    flexDirection: 'row',
    gap: spacing.lg,
    marginTop: spacing.md,
  },
  docDotWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  docDot: { width: 7, height: 7, borderRadius: 4 },
  docDotLabel: { color: colors.textSecondary, fontSize: 11 },

  reviewLink: { color: '#F59E0B', fontSize: 13, fontWeight: '600', marginTop: spacing.md },
});
