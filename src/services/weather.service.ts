import { supabase } from './supabase';
import type { WeatherDataDoc } from '../types/models';
import AsyncStorage from '@react-native-async-storage/async-storage';

function mapRow(row: any): WeatherDataDoc {
  return {
    weatherId: row.id,
    windSpeed: row.wind_speed,
    waveHeight: row.wave_height,
    weatherCondition: row.weather_condition,
    isSafe: row.is_safe,
    recordedAt: row.recorded_at,
    portId: row.port_id,
  };
}

export async function getLatestWeather(portId: string): Promise<WeatherDataDoc | null> {
  const { data, error } = await supabase
    .from('weather_data')
    .select('*')
    .eq('port_id', portId)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data) : null;
}

export async function getWeatherHistory(
  portId: string,
  limit = 24
): Promise<WeatherDataDoc[]> {
  const { data, error } = await supabase
    .from('weather_data')
    .select('*')
    .eq('port_id', portId)
    .order('recorded_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []).map(mapRow);
}

/**
 * Live weather from Open-Meteo — free for non-commercial use, no API key, no
 * billing (CC BY 4.0: the card must keep its credit line). Two calls: the
 * forecast endpoint for air temperature/wind, the marine endpoint for wave
 * height. Cached for 15 minutes so a demo does not spend the courtesy limits
 * on every re-render, and served stale when venue wifi drops.
 */
export interface LiveWeather {
  tempC: number;
  kind: 'clear' | 'partly' | 'cloud' | 'fog' | 'rain' | 'storm';
  condition: string;
  windKmh: number;
  windDir: string;
  waveM: number | null;
  fetchedAt: number;
  stale: boolean;
}

const WEATHER_TTL_MS = 15 * 60 * 1000;
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export type SailVerdict = 'good' | 'care' | 'rough';

/**
 * One shared decision, so the home card and the coastguard advisory cannot
 * disagree. Demo thresholds: 25 km/h or 1 m is "take care", 40 km/h or
 * 1.5 m is "do not sail".
 */
export function sailVerdict(
  w: Pick<LiveWeather, 'kind' | 'windKmh' | 'waveM'>
): SailVerdict {
  if (w.kind === 'storm' || w.windKmh >= 40 || (w.waveM ?? 0) >= 1.5) return 'rough';
  if (w.windKmh >= 25 || (w.waveM ?? 0) >= 1.0) return 'care';
  return 'good';
}

/** Middle of the Mactan–Olango crossing. Every surface quotes this point so
 *  two screens can never show different weather for the same sea. */
export const STRAIT_POINT = { lat: 10.27, lon: 124.03 };

/**
 * WMO codes Open-Meteo returns, in words a passenger understands. Code 3 is
 * overcast (the old range check called 1–3 all "Partly cloudy"), and drizzle
 * vs showers vs rain were all flattened to "Rain".
 */
const WMO: Record<number, { kind: LiveWeather['kind']; condition: string }> = {
  0: { kind: 'clear', condition: 'Clear sky' },
  1: { kind: 'clear', condition: 'Mostly clear' },
  2: { kind: 'partly', condition: 'Partly cloudy' },
  3: { kind: 'cloud', condition: 'Overcast' },
  45: { kind: 'fog', condition: 'Fog' },
  48: { kind: 'fog', condition: 'Freezing fog' },
  51: { kind: 'rain', condition: 'Light drizzle' },
  53: { kind: 'rain', condition: 'Drizzle' },
  55: { kind: 'rain', condition: 'Heavy drizzle' },
  61: { kind: 'rain', condition: 'Light rain' },
  63: { kind: 'rain', condition: 'Rain' },
  65: { kind: 'rain', condition: 'Heavy rain' },
  80: { kind: 'rain', condition: 'Light showers' },
  81: { kind: 'rain', condition: 'Rain showers' },
  82: { kind: 'rain', condition: 'Heavy showers' },
  95: { kind: 'storm', condition: 'Thunderstorm' },
  96: { kind: 'storm', condition: 'Thunderstorm with hail' },
  99: { kind: 'storm', condition: 'Severe thunderstorm' },
};

function describe(code: number): { kind: LiveWeather['kind']; condition: string } {
  // Snow/sleet codes never happen here; the range fallback keeps them sane.
  return WMO[code]
    ?? {
      kind: code >= 95 ? 'storm' : code >= 51 ? 'rain' : 'cloud',
      condition: code >= 51 ? 'Rain' : 'Cloudy',
    };
}

async function fetchJson(url: string): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`weather ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function getLiveWeather(lat: number, lon: number): Promise<LiveWeather> {
  const key = `weather:v2:${lat.toFixed(2)}:${lon.toFixed(2)}`;
  let cached: LiveWeather | null = null;
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw) cached = JSON.parse(raw) as LiveWeather;
  } catch {
    // cache is best-effort
  }
  if (cached && Date.now() - cached.fetchedAt < WEATHER_TTL_MS) {
    return { ...cached, stale: false };
  }

  try {
    const forecast = await fetchJson(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      '&current=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m'
    );
    const cur = forecast?.current ?? {};
    const { kind, condition } = describe(Number(cur.weather_code ?? 0));
    // Marine endpoint refuses land points; a missing wave height is not a
    // failed weather card.
    const waveM = await fetchJson(
      `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&current=wave_height`
    )
      .then((m) => {
        const w = m?.current?.wave_height;
        return typeof w === 'number' ? Math.round(w * 10) / 10 : null;
      })
      .catch(() => null);

    const deg = Number(cur.wind_direction_10m ?? 0);
    const live: LiveWeather = {
      tempC: Math.round(Number(cur.temperature_2m ?? 0)),
      kind,
      condition,
      windKmh: Math.round(Number(cur.wind_speed_10m ?? 0)),
      windDir: DIRS[Math.round(deg / 45) % 8],
      waveM,
      fetchedAt: Date.now(),
      stale: false,
    };
    AsyncStorage.setItem(key, JSON.stringify(live)).catch(() => {});
    return live;
  } catch (e) {
    if (cached) return { ...cached, stale: true };
    throw e;
  }
}

