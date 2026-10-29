import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { Icon, type IconName } from './Icon';
import { useLiveWeather } from '../hooks/useLiveWeather';
import { sailVerdict, type LiveWeather } from '../services/weather.service';
import { colors, radii, spacing, typography } from '../theme/tokens';

/**
 * Sea-weather strip backed by Open-Meteo (free for non-commercial use, no key).
 * The verdict is written for someone who will never read a wind speed: a
 * plain "good / be careful / don't go" sentence first, the numbers second.
 * Wind and wave height still decide it (sailVerdict), and the CC BY credit
 * line is required and must stay.
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

const VERDICT = {
  good: {
    title: 'Good day to sail',
    short: 'Good to sail',
    sentence: 'The sea is calm and the wind is light.',
    color: colors.primary,
  },
  care: {
    title: 'Sail with care',
    short: 'Sail with care',
    sentence: 'The water is choppy. Wear life vests and go slowly.',
    color: colors.warning,
  },
  rough: {
    title: 'Not safe to sail',
    short: 'Not safe today',
    sentence: 'Big waves and strong wind. Wait until the sea calms down.',
    color: colors.danger,
  },
} as const;

function plainAdvice(w: LiveWeather) {
  const v = VERDICT[sailVerdict(w)];
  if (v === VERDICT.good && w.waveM === null) {
    return { ...v, sentence: 'The wind is light. Wave height is not available right now.' };
  }
  return v;
}

interface Props {
  latitude: number;
  longitude: number;
  /** Shown on the right, e.g. "Mactan". */
  place?: string;
  /** `bar` = the two-line home strip; default is the card. */
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

  const waves = data.waveM !== null ? `${data.waveM} m waves` : 'wave height unavailable';
  const advice = plainAdvice(data);
  const details = `${data.tempC}°C · wind ${data.windKmh} km/h ${data.windDir} · ${waves}`;

  if (variant === 'bar') {
    return (
      <Pressable
        onPress={() => void refresh()}
        accessibilityRole="button"
        accessibilityLabel={`${advice.title}. ${advice.sentence} ${details}`}
        style={[styles.bar, style]}
      >
        <Icon name={ICON_FOR[data.kind] as IconName} size={20} color={TINT_FOR[data.kind]} />
        <View style={styles.barBody}>
          <Text style={[styles.barTitle, { color: advice.color }]} numberOfLines={1}>
            {advice.short}
          </Text>
          <Text style={styles.barSub} numberOfLines={1}>
            {data.stale ? 'Saved reading · ' : ''}{advice.sentence}
          </Text>
        </View>
        <Text style={styles.barTemp} numberOfLines={1}>{data.tempC}°</Text>
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

      <Text style={[styles.verdict, { color: advice.color }]}>{advice.title}</Text>
      <Text style={styles.sentence}>{advice.sentence}</Text>

      <Text style={styles.metrics}>{details}</Text>
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

  verdict: { ...typography.title, fontSize: 18, marginTop: spacing.md },
  sentence: { ...typography.body, color: colors.textSecondary, lineHeight: 20, marginTop: 2 },
  metrics: { ...typography.caption, color: colors.textMuted, marginTop: spacing.md },
  credit: { ...typography.caption, color: colors.textMuted, fontSize: 10, marginTop: spacing.xs },

  bar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    minHeight: 56, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.borderSubtle,
  },
  barBody: { flex: 1, minWidth: 0 },
  barTitle: { ...typography.bodyStrong, fontSize: 14 },
  barSub: { ...typography.caption, color: colors.textMuted, fontSize: 11, marginTop: 1 },
  barTemp: { ...typography.bodyStrong, color: colors.textSecondary, flexShrink: 0 },
  muted: { ...typography.caption, color: colors.textMuted },
});
