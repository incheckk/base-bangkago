import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { ScreenContainer } from '@/components/ScreenContainer';
import { LoadingState, ErrorState, EmptyState } from '@/components/States';
import { useAuth } from '@/hooks/useAuth';
import { useTripManifest } from '@/hooks/useTripManifest';
import { colors, radii, spacing, typography } from '@/theme/tokens';

export default function AllPassengers() {
  const { user } = useAuth();
  const { manifest, passengers, loading, error } = useTripManifest(user?.id ?? null);

  return (
    <ScreenContainer padded={false}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.back} onPress={() => router.back()}>← Back</Text>

        <Text style={styles.eyebrow}>TRIP MANIFEST</Text>
        <Text style={styles.title}>All Passengers</Text>

        {manifest && (
          <View style={styles.headerCard}>
            <Text style={styles.headerRef}>Manifest #{manifest.manifestId.slice(0, 8)}</Text>
            <Text style={styles.headerCount}>
              {passengers.length} passenger{passengers.length !== 1 ? 's' : ''} on board
            </Text>
          </View>
        )}

        {loading ? (
          <LoadingState label="Loading manifest…" />
        ) : error ? (
          <ErrorState message={error} />
        ) : passengers.length === 0 ? (
          <EmptyState
            icon="🧳"
            title="No passengers"
            message="Passengers will appear here once they board."
          />
        ) : (
          passengers.map((p) => (
            <View key={p.manifestPassengerId} style={styles.card}>
              <View style={styles.cardTop}>
                <Text style={styles.name}>{p.passengerName}</Text>
                <View style={[styles.badge, p.boardedAt && styles.badgeOn]}>
                  <Text style={[styles.badgeText, p.boardedAt && styles.badgeTextOn]}>
                    {p.boardedAt ? 'Boarded' : 'Pending'}
                  </Text>
                </View>
              </View>
              <View style={styles.cardMeta}>
                {p.actualWeightKg != null && (
                  <Text style={styles.metaText}>{p.actualWeightKg} kg</Text>
                )}
                {p.boardedAt && (
                  <Text style={styles.metaText}>
                    Boarded {new Date(p.boardedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                )}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },

  back: { color: colors.primary, fontSize: 14, fontWeight: '600', marginBottom: spacing.lg },
  eyebrow: { ...typography.label, marginBottom: 2 },
  title: { ...typography.h1, marginBottom: spacing.xl },

  headerCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  headerRef: { ...typography.caption, color: colors.textMuted, fontSize: 11, marginBottom: 4 },
  headerCount: { color: colors.primary, fontSize: 15, fontWeight: '700' },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  name: { color: colors.text, fontSize: 15, fontWeight: '700', flex: 1 },
  badge: {
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(169,190,196,0.14)',
  },
  badgeOn: { backgroundColor: 'rgba(52,214,176,0.14)' },
  badgeText: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  badgeTextOn: { color: colors.primary },

  cardMeta: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  metaText: { ...typography.caption, color: colors.textMuted, fontSize: 12 },
});
