import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { AdminScreenHeader } from '@/components/AdminScreenHeader';
import { MapContainer } from '@/components/MapContainer';
import { ScreenContainer } from '@/components/ScreenContainer';
import { useAllVesselTracking } from '@/hooks/useVesselTracking';
import { usePorts } from '@/hooks/useSupabase';
import { colors, radii, spacing, typography } from '@/theme/tokens';
export default function FleetOverviewScreen() {
  const tracking = useAllVesselTracking();
  const ports = usePorts();

  return (
    <ScreenContainer padded={false}>
      <AdminScreenHeader title="Fleet Overview" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        <View style={styles.mapArea}>
          <MapContainer ports={ports.data} height={200} />
          <View style={styles.countBadge}>
            <View style={styles.dot} />
            <Text style={styles.countText} numberOfLines={1}>
              {tracking.loading
                ? 'Loading…'
                : `${tracking.data.length} vessel${tracking.data.length === 1 ? '' : 's'} tracked`}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>ACTIVE VESSELS</Text>
          {tracking.loading ? (
            <View style={styles.stateBox}>
              <Text style={styles.loadingText}>Loading vessels…</Text>
            </View>
          ) : tracking.data.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyIcon}>🚤</Text>
              <Text style={styles.emptyTitle}>No vessels tracked</Text>
              <Text style={styles.emptyText}>No active vessel data available.</Text>
            </View>
          ) : (
            <View style={styles.list}>
              {tracking.data.map((v) => (
                <View key={v.trackId} style={styles.vesselCard}>
                  <View style={styles.vesselHeader}>
                    <View style={styles.vesselDot} />
                    <Text style={styles.vesselId}>Vessel {v.bangkaId}</Text>
                  </View>
                  <View style={styles.vesselInfo}>
                    <View style={styles.infoBlock}>
                      <Text style={styles.infoLabel}>Speed</Text>
                      <Text style={styles.infoValue} numberOfLines={1}>
                        {v.speed !== null ? `${v.speed} kn` : 'N/A'}
                      </Text>
                    </View>
                    <View style={styles.infoBlock}>
                      <Text style={styles.infoLabel}>Latitude</Text>
                      <Text style={styles.infoValue}>{v.latitude.toFixed(4)}</Text>
                    </View>
                    <View style={styles.infoBlock}>
                      <Text style={styles.infoLabel}>Longitude</Text>
                      <Text style={styles.infoValue}>{v.longitude.toFixed(4)}</Text>
                    </View>
                    <View style={styles.infoBlock}>
                      <Text style={styles.infoLabel}>Last Update</Text>
                      <Text style={styles.infoValue} numberOfLines={1}>
                        {new Date(v.recordedAt).toLocaleTimeString('en-PH', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },

  mapArea: {
    marginBottom: spacing.xl,
    position: 'relative',
  },
  mapPlaceholder: {
    height: 200,
    backgroundColor: colors.bgElevated,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapIcon: { fontSize: 48, marginBottom: spacing.sm },
  mapText: { color: colors.text, fontSize: 16, fontWeight: '700' },
  mapSub: { color: colors.textMuted, fontSize: 13, marginTop: spacing.xs },
  countBadge: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.scrim,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.warning },
  countText: { flexShrink: 1, color: colors.text, fontSize: 12, fontWeight: '600' },

  section: { marginBottom: spacing.xl },
  sectionLabel: { ...typography.label, marginBottom: spacing.md },

  stateBox: { minHeight: 80, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: colors.textMuted, fontSize: 13 },

  emptyBox: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyIcon: { fontSize: 32, marginBottom: spacing.sm },
  emptyTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  emptyText: { ...typography.caption, marginTop: spacing.xs },

  list: { gap: spacing.md },
  vesselCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
  },
  vesselHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  vesselDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.warning },
  vesselId: { flexShrink: 1, color: colors.text, fontSize: 15, fontWeight: '700' },
  vesselInfo: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  infoBlock: { minWidth: '40%' },
  infoLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '600', marginBottom: 2 },
  infoValue: { flexShrink: 1, color: colors.text, fontSize: 14, fontWeight: '600' },
});
