import { router } from 'expo-router';
import { useState } from 'react';
import {
  ScrollView, StyleSheet, Text, View,
} from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { useTripManifest } from '@/hooks/useTripManifest';
import { useAuth } from '@/hooks/useAuth';
import { colors, radii, spacing, typography } from '@/theme/tokens';

export default function ArrivedScreen() {
  const { user } = useAuth();
  const { manifest, passengers, loading } = useTripManifest(user?.id ?? null);

  const [completing, setCompleting] = useState(false);

  const departureTime = manifest?.actualDepartureTime
    ? new Date(manifest.actualDepartureTime)
    : null;
  const now = new Date();
  const durationMin = departureTime
    ? Math.round((now.getTime() - departureTime.getTime()) / 60000)
    : null;

  async function handleComplete() {
    setCompleting(true);
    setTimeout(() => {
      router.push('/(bangkero)/post-trip');
    }, 800);
  }

  return (
    <ScreenContainer padded={false}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.back} onPress={() => router.back()}>← Back</Text>

        <View style={styles.hero}>
          <View style={styles.checkCircle}>
            <Text style={styles.checkIcon}>✓</Text>
          </View>
          <Text style={styles.title}>Arrived at Destination</Text>
          <Text style={styles.subtitle}>
            {durationMin !== null ? `Trip duration: ${durationMin} minutes` : 'Trip completed'}
          </Text>
        </View>

        {loading ? (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderText}>Loading trip details…</Text>
          </View>
        ) : (
          <>
            <Text style={styles.sectionLabel}>DISEMBARKATION</Text>
            <View style={styles.card}>
              <View style={styles.cardRow}>
                <Text style={styles.cardLabel}>Passengers</Text>
                <Text style={styles.cardValue}>{passengers.length} to disembark</Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.cardRow}>
                <Text style={styles.cardLabel}>Status</Text>
                <Text style={[styles.cardValue, styles.statusPending]}>Pending</Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.cardRow}>
                <Text style={styles.cardLabel}>Parcels</Text>
                <Text style={styles.cardValue}>{manifest?.totalParcelsOnBoard ?? 0} to unload</Text>
              </View>
            </View>

            <View style={styles.footer}>
              <PrimaryButton
                label="Complete Trip"
                onPress={handleComplete}
                loading={completing}
                disabled={completing}
              />
              <View style={{ height: spacing.md }} />
              <PrimaryButton
                label="View Summary"
                variant="secondary"
                onPress={() => router.push('/(bangkero)/trips')}
              />
            </View>
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  back: { color: colors.primary, fontSize: 14, fontWeight: '600', marginBottom: spacing.lg },

  hero: {
    alignItems: 'center',
    marginVertical: spacing.xxl,
  },
  checkCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  checkIcon: {
    color: colors.text,
    fontSize: 36,
    fontWeight: '700',
  },
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },

  placeholder: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.xl,
    alignItems: 'center',
  },
  placeholderText: { color: colors.textMuted, fontSize: 14 },

  sectionLabel: { ...typography.label, marginBottom: spacing.md },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  cardLabel: { color: colors.textSecondary, fontSize: 14 },
  cardValue: { color: colors.text, fontSize: 14, fontWeight: '600' },
  statusPending: { color: colors.warning },
  divider: { height: 1, backgroundColor: colors.borderSubtle },

  footer: { marginTop: spacing.xxl },
});
