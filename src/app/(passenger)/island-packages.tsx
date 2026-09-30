import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PassengerScreenHeader } from '@/components/PassengerScreenHeader';
import { ScreenContainer } from '@/components/ScreenContainer';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { useIslandPackages } from '@/hooks/useIslandPackages';
import { usePorts } from '@/hooks/useSupabase';
import { colors, elevation, radii, spacing, typography } from '@/theme/tokens';

/**
 * The Island Hop catalog. Every package books as an ordinary ride whose
 * route is stops[0] → stops[last] (migration 014 seeds only pairs that
 * exist in `routes`), so dispatch and the manifest never learn about
 * packages — this screen only sells them.
 */
export default function IslandPackages() {
  const packages = useIslandPackages();
  const ports = usePorts();

  const portName = (id: string) =>
    ports.data.find((p) => p.portId === id)?.portName ?? id;

  if (packages.loading || ports.loading) {
    return (
      <ScreenContainer>
        <PassengerScreenHeader title="Island Hopping" />
        <LoadingState label="Loading packages…" />
      </ScreenContainer>
    );
  }

  if (packages.error || ports.error) {
    return (
      <ScreenContainer>
        <PassengerScreenHeader title="Island Hopping" />
        <ErrorState
          message={packages.error ?? ports.error ?? 'Could not load packages.'}
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padded={false}>
      <PassengerScreenHeader
        title="Island Hopping"
        subtitle="Curated island tours — pay a 50% GCash downpayment to hold your seats."
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {packages.data.length === 0 ? (
          <EmptyState
            icon="🏝️"
            title="No packages yet"
            message="Island hopping packages will appear here once they are set up."
          />
        ) : (
          <View style={styles.list}>
            {packages.data.map((pkg) => (
              <Pressable
                key={pkg.packageId}
                onPress={() =>
                  router.push({
                    pathname: '/(passenger)/book-package',
                    params: { packageId: pkg.packageId },
                  })
                }
                accessibilityRole="button"
                accessibilityLabel={`${pkg.packageName}, ${pkg.price} pesos per person`}
                style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
              >
                <View style={styles.cardTop}>
                  <Text style={styles.cardName} numberOfLines={2}>{pkg.packageName}</Text>
                  <View style={styles.priceWrap}>
                    <Text style={styles.price}>₱{pkg.price}</Text>
                    <Text style={styles.priceUnit}>per pax</Text>
                  </View>
                </View>

                {!!pkg.description && (
                  <Text style={styles.cardDesc} numberOfLines={2}>{pkg.description}</Text>
                )}

                <View style={styles.stopsRow}>
                  {pkg.stops.map((stopId, i) => (
                    <Text key={`${stopId}-${i}`} style={styles.stopText} numberOfLines={1}>
                      {i > 0 && <Text style={styles.stopArrow}> → </Text>}
                      {portName(stopId)}
                    </Text>
                  ))}
                </View>

                <View style={styles.metaRow}>
                  <Text style={styles.meta}>⏱ {pkg.durationHours} hrs</Text>
                  <Text style={styles.meta}>👥 up to {pkg.maxCapacity} pax</Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.huge },
  list: { gap: spacing.md },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    ...elevation.e1,
  },
  cardPressed: { borderColor: colors.primary, backgroundColor: colors.surfaceAlt },

  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  cardName: { flex: 1, ...typography.title, fontSize: 16 },
  priceWrap: { alignItems: 'flex-end' },
  price: { ...typography.h2, color: colors.primary },
  priceUnit: { ...typography.label, letterSpacing: 0, fontSize: 10 },

  cardDesc: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm },

  stopsRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: spacing.md },
  stopText: { ...typography.caption, color: colors.text, fontWeight: '600', flexShrink: 1 },
  stopArrow: { color: colors.primary, fontWeight: '700' },

  metaRow: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.md },
  meta: { ...typography.caption, color: colors.textMuted, fontSize: 11 },
});
