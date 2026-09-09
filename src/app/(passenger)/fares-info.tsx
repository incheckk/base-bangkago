import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { ScreenContainer } from '@/components/ScreenContainer';
import { LoadingState } from '@/components/States';
import { getAllRoutes, getAllPorts } from '@/services/route.service';
import type { RouteDoc, PortDoc } from '@/types/models';
import { colors, radii, spacing, typography } from '@/theme/tokens';

const INFO = [
  { icon: '⏰', title: 'Operating Hours', desc: '5:00 AM – 6:00 PM daily' },
  { icon: '🎫', title: 'Booking Policy', desc: 'Book up to 24 hours in advance. Cancel for free up to 2 hours before departure.' },
  { icon: '🧳', title: 'Luggage Allowance', desc: '1 carry-on bag included. Additional luggage may incur extra fees.' },
  { icon: '⚠️', title: 'Safety', desc: 'Life jackets provided. Trips may be cancelled due to weather conditions.' },
];

export default function FaresInfo() {
  const [routes, setRoutes] = useState<RouteDoc[]>([]);
  const [ports, setPorts] = useState<PortDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getAllRoutes(), getAllPorts()])
      .then(([r, p]) => { setRoutes(r); setPorts(p); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function getPortName(id: string) {
    return ports.find((p) => p.portId === id)?.portName ?? id;
  }

  if (loading) return <LoadingState />;

  return (
    <ScreenContainer padded={false}>
      <View style={styles.header}>
        <Text style={styles.backBtn} onPress={() => router.back()}>← Back</Text>
        <Text style={styles.headerTitle}>Fares & Info</Text>
        <View style={{ width: 50 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Route Fares</Text>
        <Text style={styles.subtitle}>All fares are per person, one way</Text>

        {routes.map((r) => (
          <View key={r.routeId} style={styles.routeCard}>
            <View style={styles.routeHeader}>
              <Text style={styles.routeFrom}>{getPortName(r.startPortId)}</Text>
              <Text style={styles.routeArrow}>→</Text>
              <Text style={styles.routeTo}>{getPortName(r.endPortId)}</Text>
            </View>
            <View style={styles.routeMeta}>
              <Text style={styles.routeFare}>₱{r.baseFare}</Text>
              {r.estimatedMinutes && (
                <>
                  <Text style={styles.routeDot}>·</Text>
                  <Text style={styles.routeDetail}>~{r.estimatedMinutes} min</Text>
                </>
              )}
              {r.distanceKm && (
                <>
                  <Text style={styles.routeDot}>·</Text>
                  <Text style={styles.routeDetail}>{r.distanceKm} km</Text>
                </>
              )}
            </View>
          </View>
        ))}

        <Text style={[styles.title, { marginTop: spacing.xxl }]}>Good to Know</Text>
        {INFO.map((item, i) => (
          <View key={i} style={styles.infoCard}>
            <Text style={styles.infoIcon}>{item.icon}</Text>
            <View style={styles.infoContent}>
              <Text style={styles.infoTitle}>{item.title}</Text>
              <Text style={styles.infoDesc}>{item.desc}</Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.md,
  },
  backBtn: { color: colors.primary, fontSize: 15, fontWeight: '600' },
  headerTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },

  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  title: { ...typography.h2, marginBottom: spacing.xs },
  subtitle: { ...typography.caption, marginBottom: spacing.xl },

  routeCard: {
    backgroundColor: colors.surface, borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.borderSubtle,
    padding: spacing.lg, marginBottom: spacing.sm,
  },
  routeHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  routeFrom: { color: colors.text, fontSize: 14, fontWeight: '700' },
  routeArrow: { color: colors.primary, fontSize: 14, fontWeight: '700' },
  routeTo: { color: colors.text, fontSize: 14, fontWeight: '700' },
  routeMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  routeFare: { color: colors.primary, fontSize: 15, fontWeight: '800' },
  routeDot: { color: colors.textMuted },
  routeDetail: { color: colors.textSecondary, fontSize: 13 },

  infoCard: {
    flexDirection: 'row', gap: spacing.md,
    backgroundColor: colors.surface, borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.borderSubtle,
    padding: spacing.lg, marginBottom: spacing.sm,
  },
  infoIcon: { fontSize: 22 },
  infoContent: { flex: 1 },
  infoTitle: { color: colors.text, fontSize: 14, fontWeight: '700', marginBottom: 4 },
  infoDesc: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
});
