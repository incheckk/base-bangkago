import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ScreenContainer } from '@/components/ScreenContainer';
import { SideDrawer } from '@/components/SideDrawer';
import { useAuth } from '@/hooks/useAuth';
import { colors, radii, spacing, typography } from '@/theme/tokens';

const QUICK_ROUTES = [
  { from: 'Puerto Galera', to: 'Batangas', fare: 350, time: '~45 min' },
  { from: 'Puerto Galera', to: 'Calapan', fare: 250, time: '~30 min' },
  { from: 'Calapan', to: 'Puerto Galera', fare: 250, time: '~30 min' },
  { from: 'Batangas', to: 'Puerto Galera', fare: 350, time: '~45 min' },
];

export default function QuickRide() {
  const { profile } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <ScreenContainer padded={false}>
      <SideDrawer
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Menu"
        items={[
          { icon: '🏠', label: 'Home', onPress: () => router.replace('/(passenger)/home') },
          { icon: '📋', label: 'My Bookings', onPress: () => router.push('/(passenger)/bookings') },
          { icon: '🗺️', label: 'Trip History', onPress: () => router.push('/(passenger)/trips') },
          { icon: '👤', label: 'Profile', onPress: () => router.push('/(passenger)/profile') },
        ]}
      />

      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.backBtn}>← Back</Text>
        </Pressable>
        <Pressable onPress={() => setDrawerOpen(true)} hitSlop={8}>
          <Text style={styles.menuIcon}>☰</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Book a Ride</Text>
        <Text style={styles.subtitle}>Select your route or search for a destination</Text>

        <Pressable
          onPress={() => router.push('/(passenger)/search-boat')}
          style={({ pressed }) => [styles.searchBar, pressed && styles.searchBarPressed]}
        >
          <Text style={styles.searchIcon}>🔍</Text>
          <Text style={styles.searchPlaceholder}>Where are you going?</Text>
        </Pressable>

        <Text style={styles.sectionLabel}>POPULAR ROUTES</Text>
        <View style={styles.routeList}>
          {QUICK_ROUTES.map((r, i) => (
            <Pressable
              key={i}
              onPress={() => router.push('/(passenger)/book-ride')}
              style={({ pressed }) => [styles.routeCard, pressed && styles.routePressed]}
            >
              <View style={styles.routeHeader}>
                <Text style={styles.routeFrom}>{r.from}</Text>
                <Text style={styles.routeArrow}>→</Text>
                <Text style={styles.routeTo}>{r.to}</Text>
              </View>
              <View style={styles.routeMeta}>
                <Text style={styles.routeFare}>₱{r.fare}</Text>
                <Text style={styles.routeTime}>{r.time}</Text>
              </View>
            </Pressable>
          ))}
        </View>

        <Pressable
          onPress={() => router.push('/(passenger)/fares-info')}
          style={({ pressed }) => [styles.infoBtn, pressed && styles.infoBtnPressed]}
        >
          <Text style={styles.infoText}>View Fares & Info</Text>
        </Pressable>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.xl, paddingTop: spacing.md,
  },
  backBtn: { color: colors.primary, fontSize: 15, fontWeight: '600' },
  menuIcon: { fontSize: 24, color: colors.text, padding: spacing.sm },

  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  title: { ...typography.h1, marginTop: spacing.lg },
  subtitle: { ...typography.caption, marginTop: spacing.xs, marginBottom: spacing.xl },

  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.lg, height: 52, marginBottom: spacing.xl,
  },
  searchBarPressed: { borderColor: colors.primary },
  searchIcon: { fontSize: 18 },
  searchPlaceholder: { color: colors.textMuted, fontSize: 15 },

  sectionLabel: { ...typography.label, marginBottom: spacing.md },
  routeList: { gap: spacing.md },
  routeCard: {
    backgroundColor: colors.surface, borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.borderSubtle, padding: spacing.lg,
  },
  routePressed: { borderColor: colors.primary },
  routeHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  routeFrom: { color: colors.text, fontSize: 15, fontWeight: '700' },
  routeArrow: { color: colors.primary, fontSize: 15, fontWeight: '700' },
  routeTo: { color: colors.text, fontSize: 15, fontWeight: '700' },
  routeMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  routeFare: { color: colors.primary, fontSize: 14, fontWeight: '700' },
  routeTime: { color: colors.textMuted, fontSize: 13 },

  infoBtn: {
    marginTop: spacing.xl, backgroundColor: colors.surface,
    borderRadius: radii.md, borderWidth: 1, borderColor: colors.borderSubtle,
    paddingVertical: spacing.lg, alignItems: 'center',
  },
  infoBtnPressed: { borderColor: colors.primary },
  infoText: { color: colors.primary, fontSize: 14, fontWeight: '700' },
});
