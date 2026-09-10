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
  { key: 'verified', label: 'Verified' },
  { key: 'pending', label: 'Pending' },
  { key: 'rejected', label: 'Rejected' },
];

const STATUS_STYLE: Record<VerificationStatus, { fg: string; bg: string }> = {
  verified: { fg: colors.primary, bg: 'rgba(52,214,176,0.14)' },
  pending: { fg: colors.warning, bg: colors.warningTint },
  rejected: { fg: colors.danger, bg: 'rgba(224,82,82,0.14)' },
};

export default function OperatorsScreen() {
  const [filter, setFilter] = useState('all');
  const statusParam = filter === 'all' ? undefined : (filter as VerificationStatus);
  const { data, loading, error } = useOperators(statusParam);

  if (loading) {
    return (
      <View style={styles.center}>
        <LoadingState label="Loading operators…" />
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
      <Text style={styles.eyebrow}>MANAGEMENT</Text>
      <View style={styles.titleRow}>
        <Text style={styles.title}>Operators</Text>
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{data.length}</Text>
        </View>
      </View>

      <FilterChips filters={FILTERS} active={filter} onChange={setFilter} />

      {data.length === 0 ? (
        <EmptyState
          icon="⛵"
          title="No operators found"
          message="No operators match the selected filter."
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
                <View style={styles.cardBottom}>
                  <View style={[styles.statusDot, { backgroundColor: st.fg }]} />
                  <Text style={styles.statusLabel}>
                    {op.isAvailable ? 'Available' : 'Offline'}
                  </Text>
                </View>
              </Pressable>
            );
          })}
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
  eyebrow: { ...typography.label, marginBottom: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.xl },
  title: { ...typography.h1 },
  countBadge: {
    backgroundColor: colors.warning,
    borderRadius: radii.pill,
    minWidth: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  countText: { color: colors.primaryText, fontSize: 13, fontWeight: '700' },
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
  cardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusLabel: { color: colors.textSecondary, fontSize: 12 },
});
