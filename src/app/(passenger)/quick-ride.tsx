import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { ScreenContainer } from '@/components/ScreenContainer';
import { colors, elevation, radii, spacing, touchTarget, typography } from '@/theme/tokens';

/**
 * Shortcuts, not the booking form — tapping one opens Book a Ride with the
 * departure port already filled in.
 *
 * Fares and durations mirror the seeded `routes` rows so this screen agrees
 * with the database instead of quoting numbers from a different region.
 */
const QUICK_ROUTES: {
  fromId: string; from: string; to: string; fare: number; minutes: number;
}[] = [
  { fromId: 'mactan-pier-2', from: 'Mactan Pier 2', to: 'Olango Island Port', fare: 150, minutes: 15 },
  { fromId: 'mactan-pier-1', from: 'Mactan Pier 1', to: 'Olango Island Port', fare: 180, minutes: 20 },
  { fromId: 'mactan-pier-2', from: 'Mactan Pier 2', to: 'Caohagan Island', fare: 280, minutes: 35 },
  { fromId: 'mactan-pier-1', from: 'Mactan Pier 1', to: 'Nalusuan Island', fare: 400, minutes: 55 },
];

export default function QuickRide() {
  return (
    <ScreenContainer padded={false}>
      {/* No side menu here: this is a booking flow, not a dashboard. A drawer
          mid-task invites the user to wander off half-way through a booking,
          and back is the only navigation this screen owes them. */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={({ pressed }) => [styles.backBtn, pressed && styles.backBtnPressed]}
        >
          <Icon name="back" size={22} color={colors.text} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Book a Ride</Text>
        <Text style={styles.subtitle}>Pick a popular route, or search for a destination.</Text>

        <Pressable
          onPress={() => router.push('/(passenger)/search-boat')}
          accessibilityRole="search"
          style={({ pressed }) => [styles.searchBar, pressed && styles.searchBarPressed]}
        >
          <Icon name="port" size={18} color={colors.textMuted} />
          <Text style={styles.searchPlaceholder}>Where are you going?</Text>
          <Icon name="forward" size={16} color={colors.textMuted} />
        </Pressable>

        <Text style={styles.sectionLabel}>POPULAR ROUTES</Text>
        <View style={styles.routeList}>
          {QUICK_ROUTES.map((r, i) => (
            <Pressable
              key={`${r.fromId}-${r.to}-${i}`}
              // Carries the departure port through, so the form opens part-filled.
              onPress={() => router.push({
                pathname: '/(passenger)/book-ride',
                params: { fromId: r.fromId, from: r.from },
              })}
              accessibilityRole="button"
              accessibilityLabel={`${r.from} to ${r.to}, ${r.fare} pesos, ${r.minutes} minutes`}
              style={({ pressed }) => [styles.routeCard, pressed && styles.routePressed]}
            >
              <View style={styles.routeRail}>
                <View style={styles.railDot} />
                <View style={styles.railLine} />
                <View style={[styles.railDot, styles.railDotEnd]} />
              </View>

              <View style={styles.routeBody}>
                <Text style={styles.routeFrom} numberOfLines={1}>{r.from}</Text>
                <Text style={styles.routeTo} numberOfLines={1}>{r.to}</Text>
                <View style={styles.routeMeta}>
                  <Icon name="history" size={12} color={colors.textMuted} />
                  <Text style={styles.routeTime}>{r.minutes} min</Text>
                </View>
              </View>

              <View style={styles.routeFareWrap}>
                <Text style={styles.routeFare}>₱{r.fare}</Text>
                <Text style={styles.routeFareUnit}>per pax</Text>
              </View>
            </Pressable>
          ))}
        </View>

        <Pressable
          onPress={() => router.push('/(passenger)/fares-info')}
          style={({ pressed }) => [styles.infoBtn, pressed && styles.infoBtnPressed]}
        >
          <Icon name="info" size={16} color={colors.primary} />
          <Text style={styles.infoText}>View Fares & Info</Text>
        </Pressable>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.xl, paddingTop: spacing.md,
  },
  backBtn: {
    width: touchTarget, height: touchTarget,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: radii.pill,
    marginLeft: -spacing.sm, // optically aligns the glyph with the title below
  },
  backBtnPressed: { backgroundColor: colors.surface },

  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.huge },
  title: { ...typography.h1, marginTop: spacing.sm },
  subtitle: { ...typography.caption, marginTop: spacing.xs, marginBottom: spacing.xl },

  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderRadius: radii.lg,
    borderWidth: 1, borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.lg, height: 52,
    ...elevation.e1,
  },
  searchBarPressed: { borderColor: colors.primary, backgroundColor: colors.surfaceAlt },
  searchPlaceholder: { ...typography.body, color: colors.textMuted, flex: 1 },


  sectionLabel: { ...typography.label, marginTop: spacing.huge, marginBottom: spacing.md },
  routeList: { gap: spacing.md },

  routeCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderRadius: radii.lg,
    borderWidth: 1, borderColor: colors.borderSubtle,
    padding: spacing.lg,
    ...elevation.e1,
  },
  routePressed: { borderColor: colors.primary, backgroundColor: colors.surfaceAlt },

  // Same origin/destination rail as the booking form, so a route reads the
  // same way wherever it appears.
  routeRail: { alignItems: 'center', paddingVertical: spacing.xxs },
  railDot: {
    width: 8, height: 8, borderRadius: radii.pill,
    backgroundColor: colors.primary,
  },
  railDotEnd: { borderRadius: radii.xs, backgroundColor: colors.textSecondary },
  railLine: { width: 2, height: 22, backgroundColor: colors.border, marginVertical: spacing.xxs },

  routeBody: { flex: 1 },
  routeFrom: { ...typography.bodyStrong },
  routeTo: { ...typography.bodyStrong, marginTop: spacing.md },
  routeMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm },
  routeTime: { ...typography.caption, color: colors.textMuted, fontSize: 11 },

  routeFareWrap: { alignItems: 'flex-end' },
  routeFare: { ...typography.h2, color: colors.primary },
  routeFareUnit: { ...typography.label, letterSpacing: 0, fontSize: 10 },

  infoBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    marginTop: spacing.xl, backgroundColor: colors.surface,
    borderRadius: radii.lg, borderWidth: 1, borderColor: colors.borderSubtle,
    minHeight: touchTarget,
  },
  infoBtnPressed: { borderColor: colors.primary, backgroundColor: colors.surfaceAlt },
  infoText: { ...typography.caption, color: colors.primary, fontWeight: '700' },
});
