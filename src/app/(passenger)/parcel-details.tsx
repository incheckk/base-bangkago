import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { ScreenContainer } from '@/components/ScreenContainer';
import { StatusPill } from '@/components/StatusPill';
import { colors, radii, spacing, typography } from '@/theme/tokens';

export default function ParcelDetails() {
  const params = useLocalSearchParams<{
    parcelId?: string;
    receiverName?: string;
    status?: string;
    fromPort?: string;
    toPort?: string;
    items?: string;
    totalKg?: string;
    fare?: string;
    createdAt?: string;
  }>();

  return (
    <ScreenContainer padded={false}>
      <View style={styles.container}>
        <Text style={styles.back} onPress={() => router.back()}>← Back</Text>
        <Text style={styles.title}>Parcel Details</Text>

        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.label}>Status</Text>
            <View style={styles.statusBadge}>
              <Text style={styles.statusText}>{params.status ?? 'pending'}</Text>
            </View>
          </View>
          <View style={styles.divider} />

          <View style={styles.row}>
            <Text style={styles.label}>Receiver</Text>
            <Text style={styles.value}>{params.receiverName ?? 'N/A'}</Text>
          </View>
          <View style={styles.divider} />

          <View style={styles.row}>
            <Text style={styles.label}>Route</Text>
            <Text style={styles.value}>{params.fromPort ?? '?'} → {params.toPort ?? '?'}</Text>
          </View>
          <View style={styles.divider} />

          <View style={styles.row}>
            <Text style={styles.label}>Total Weight</Text>
            <Text style={styles.value}>{params.totalKg ?? '0'} kg</Text>
          </View>
          <View style={styles.divider} />

          <View style={styles.row}>
            <Text style={styles.label}>Fare</Text>
            <Text style={styles.fareValue}>₱{params.fare ?? '0'}</Text>
          </View>
          <View style={styles.divider} />

          <View style={styles.row}>
            <Text style={styles.label}>Booked</Text>
            <Text style={styles.value}>
              {params.createdAt
                ? new Date(params.createdAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
                : 'N/A'}
            </Text>
          </View>
        </View>

        {params.items && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Items</Text>
            <Text style={styles.itemsText}>{params.items}</Text>
          </View>
        )}
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  back: { color: colors.primary, fontSize: 14, fontWeight: '600', marginBottom: spacing.lg },
  title: { ...typography.h1, marginBottom: spacing.xl },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  cardTitle: { ...typography.label, marginBottom: spacing.md },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm },
  label: { ...typography.caption, flex: 1 },
  value: { color: colors.text, fontSize: 14, fontWeight: '600', flex: 2, textAlign: 'right' },
  fareValue: { color: colors.primary, fontSize: 16, fontWeight: '700', flex: 2, textAlign: 'right' },
  divider: { height: 1, backgroundColor: colors.borderSubtle, marginVertical: spacing.xs },
  itemsText: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  statusBadge: { backgroundColor: colors.surfaceAlt, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radii.pill },
  statusText: { color: colors.primary, fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },
});
