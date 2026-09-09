import { supabase } from './supabase';
import type { WeatherDataDoc } from '../types/models';

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
