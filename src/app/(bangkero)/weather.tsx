import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { ScreenContainer } from '@/components/ScreenContainer';
import { useWeatherData } from '@/hooks/useWeatherData';
import { colors, radii, spacing, typography } from '@/theme/tokens';

const CONDITION_ICON: Record<string, string> = {
  'sunny': '☀️',
  'clear': '☀️',
  'partly cloudy': '⛅',
  'cloudy': '⛅',
  'rainy': '🌧️',
  'rain': '🌧️',
  'stormy': '⛈️',
};

function getIcon(condition: string | null): string {
  if (!condition) return '🌊';
  return CONDITION_ICON[condition.toLowerCase()] ?? '🌊';
}

export default function WeatherScreen() {
  const { data, loading, error } = useWeatherData('p1');

  const condition = data?.weatherCondition ?? 'Unknown';
  const windSpeed = data?.windSpeed;
  const waveHeight = data?.waveHeight;
  const isSafe = data?.isSafe ?? false;

  return (
    <ScreenContainer padded={false}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.back} onPress={() => router.back()}>← Back</Text>

        <Text style={styles.eyebrow}>WEATHER</Text>
        <Text style={styles.title}>Sea Conditions</Text>

        {loading ? (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderText}>Loading weather data…</Text>
          </View>
        ) : error ? (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderText}>Failed to load weather data</Text>
          </View>
        ) : data ? (
          <>
            <View style={styles.heroCard}>
              <Text style={styles.heroIcon}>{getIcon(condition)}</Text>
              <Text style={styles.heroCondition}>{condition}</Text>
              <View style={[styles.badge, isSafe ? styles.badgeSafe : styles.badgeUnsafe]}>
                <Text style={[styles.badgeText, isSafe ? styles.badgeTextSafe : styles.badgeTextUnsafe]}>
                  {isSafe ? '● Safe to Sail' : '● Unsafe — Do Not Sail'}
                </Text>
              </View>
            </View>

            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <Text style={styles.statLabel}>WIND SPEED</Text>
                <Text style={styles.statValue}>{windSpeed ?? '—'}</Text>
                <Text style={styles.statUnit}>km/h</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statLabel}>WAVE HEIGHT</Text>
                <Text style={styles.statValue}>{waveHeight ?? '—'}</Text>
                <Text style={styles.statUnit}>meters</Text>
              </View>
            </View>

            <Text style={styles.sectionLabel}>SEA CONDITIONS</Text>
            <View style={styles.conditionsCard}>
              <View style={styles.conditionRow}>
                <Text style={styles.conditionLabel}>Visibility</Text>
                <Text style={styles.conditionValue}>Good</Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.conditionRow}>
                <Text style={styles.conditionLabel}>Current</Text>
                <Text style={styles.conditionValue}>Normal</Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.conditionRow}>
                <Text style={styles.conditionLabel}>Last updated</Text>
                <Text style={styles.conditionValue}>
                  {data.recordedAt ? new Date(data.recordedAt).toLocaleTimeString() : '—'}
                </Text>
              </View>
            </View>

            <Text style={styles.sectionLabel}>ROUTE INFO</Text>
            <View style={styles.routeCard}>
              <Text style={styles.routeText}>
                Weather conditions apply to your current port area. Always check conditions before departure.
              </Text>
            </View>
          </>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  back: { color: colors.primary, fontSize: 14, fontWeight: '600', marginBottom: spacing.lg },
  eyebrow: { ...typography.label, marginBottom: 2 },
  title: { ...typography.h1, marginBottom: spacing.xl },

  placeholder: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.xl,
    alignItems: 'center',
  },
  placeholderText: { color: colors.textMuted, fontSize: 14 },

  heroCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.xl,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  heroIcon: { fontSize: 48, marginBottom: spacing.md },
  heroCondition: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
    marginBottom: spacing.md,
  },
  badge: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
  },
  badgeSafe: { backgroundColor: 'rgba(52,214,176,0.15)' },
  badgeUnsafe: { backgroundColor: 'rgba(224,82,82,0.15)' },
  badgeText: { fontSize: 13, fontWeight: '700' },
  badgeTextSafe: { color: colors.primary },
  badgeTextUnsafe: { color: colors.danger },

  statsRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    alignItems: 'center',
  },
  statLabel: { ...typography.label, marginBottom: spacing.sm },
  statValue: { color: colors.text, fontSize: 28, fontWeight: '700' },
  statUnit: { ...typography.caption, color: colors.textMuted, fontSize: 11, marginTop: 2 },

  sectionLabel: { ...typography.label, marginTop: spacing.xl, marginBottom: spacing.md },

  conditionsCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
  },
  conditionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  conditionLabel: { color: colors.textSecondary, fontSize: 14 },
  conditionValue: { color: colors.text, fontSize: 14, fontWeight: '600' },
  divider: {
    height: 1,
    backgroundColor: colors.borderSubtle,
  },

  routeCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
  },
  routeText: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 20,
  },
});
