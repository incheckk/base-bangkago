import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { Icon, type IconName } from './Icon';
import { useLiveWeather } from '../hooks/useLiveWeather';
import type { LiveWeather } from '../services/weather.service';
import { colors, radii, spacing, typography } from '../theme/tokens';

/**
 * Sea-weather strip backed by Open-Meteo (free for non-commercial use, no key).
 * Wind and wave height are the two numbers that decide whether a bangka sails;
 * the credit line is required by CC BY 4.0 and must stay.
 */

const ICON_FOR = {
  clear: 'sun',
  partly: 'partlySunny',
  cloud: 'cloud',
  fog: 'cloud',
  rain: 'rain',
  storm: 'storm',
} as const;

const TINT_FOR = {
  clear: colors.warning,
  partly: colors.warning,
  cloud: colors.textSecondary,
  fog: colors.textSecondary,
  rain: colors.info,
  storm: colors.danger,
} as const;

/**
 * One sentence a bangkero can act on. Wind and wave height decide it — the
 * WMO code only colors the icon. Thresholds are the demo's: 25 km/h or 1 m
 * is "take care", 40 km/h or 1.5 m is "consider delaying".
 */
function sailingAdvice(w: LiveWeather): { color: string; text: string } {
  if (w.kind === 'storm' || w.windKmh >= 40 || (w.waveM ?? 0) >= 1.5) {
    return { color: colors.danger, text: 'Rough sea — consider delaying the trip.' };
  }
  if (w.windKmh >= 25 || (w.waveM ?? 0) >= 1.0) {
    return { color: colors.warning, text: 'Choppy — sail with care, life jackets on.' };
  }
  if (w.waveM === null) {
    return { color: colors.textSecondary, text: 'Light wind — good to sail. Wave height unavailable.' };
  }
  return { color: colors.primary, text: 'Calm sea, light wind — good to sail.' };
}

interface Props {
  latitude: number;
  longitude: number;
  /** Shown on the right, e.g. "Mactan". */
  place?: string;
  /** `bar` = one dense line for dashboards; default is the card. */
  variant?: 'card' | 'bar';
  style?: ViewStyle;
}

export function WeatherCard({ latitude, longitude, place, variant = 'card', style }: Props) {
  const { data, error, refresh } = useLiveWeather(latitude, longitude);

  if (!data && !error) {
    return (
      <View style={[variant === 'bar' ? styles.bar : styles.card, style]}>
        <Text style={styles.muted}>Checking sea weather…</Text>
      </View>
    );
  }

  if (!data) {
    return (
      <Pressable
        onPress={() => void refresh()}
        accessibilityRole="button"
        accessibilityLabel="Retry weather"
        style={[variant === 'bar' ? styles.bar : styles.card, style]}
      >
        <Text style={styles.muted}>Sea weather unavailable — tap to retry</Text>
      </Pressable>
    );
  }

  const waves = data.waveM !== null ? `${data.waveM} m waves` : 'waves n/a';
  const advice = sailingAdvice(data);

  if (variant === 'bar') {
    return (
      <Pressable
        onPress={() => void refresh()}
        accessibilityRole="button"
        accessibilityLabel={`Sea weather: ${data.condition}, ${data.tempC} degrees, wind ${data.windKmh} km/h ${data.windDir}, ${waves}`}
        style={[styles.bar, style]}
      >
        <Icon name={ICON_FOR[data.kind] as IconName} size={16} color={TINT_FOR[data.kind]} />
        <Text style={styles.barText} numberOfLines={1}>
          {data.tempC}°C · {data.condition} · {data.windKmh} km/h {data.windDir} · {waves}
          {data.stale ? ' · cached' : ''}
        </Text>
      </Pressable>
    );
  }

  return (
    <View style={[styles.card, style]}>
      <View style={styles.head}>
        <Icon name={ICON_FOR[data.kind] as IconName} size={28} color={TINT_FOR[data.kind]} />
        <View style={styles.headText}>
          <Text style={styles.temp}>{data.tempC}°C</Text>
          <Text style={styles.condition} numberOfLines={1}>{data.condition}</Text>
        </View>
        {!!place && <Text style={styles.place} numberOfLines={1}>{place}</Text>}
      </View>

      <View style={styles.metrics}>
        <Text style={styles.metric}>
          Wind {data.windKmh} km/h {data.windDir}
        </Text>
        <Text style={styles.metric}>{waves}</Text>
      </View>

      <Text style={[styles.advice, { color: advice.color }]}>{advice.text}</Text>

      <Text style={styles.credit}>
        {data.stale ? 'Cached reading · ' : ''}Weather data by Open-Meteo
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headText: { flex: 1, minWidth: 0 },
  temp: { ...typography.h2 },
  condition: { ...typography.caption, color: colors.textSecondary },
  place: { ...typography.label, color: colors.textMuted, flexShrink: 0 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, marginTop: spacing.md },
  metric: { ...typography.bodyStrong, color: colors.textSecondary, fontSize: 13 },
  advice: { ...typography.bodyStrong, fontSize: 13, marginTop: spacing.sm },
  credit: { ...typography.caption, color: colors.textMuted, fontSize: 10, marginTop: spacing.sm },

  bar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    minHeight: 32, paddingHorizontal: spacing.md,
    backgroundColor: colors.surface, borderRadius: radii.sm,
    borderWidth: 1, borderColor: colors.borderSubtle,
  },
  barText: { ...typography.caption, color: colors.textSecondary, flex: 1, minWidth: 0 },
  muted: { ...typography.caption, color: colors.textMuted },
});
