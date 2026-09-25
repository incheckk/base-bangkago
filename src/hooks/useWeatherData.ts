import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { useChannelId } from './useChannelId';
import { getLatestWeather } from '../services/weather.service';
import type { WeatherDataDoc } from '../types/models';

export function useWeatherData(portId: string | null) {
  const [data, setData] = useState<WeatherDataDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const channelId = useChannelId();

  useEffect(() => {
    if (!portId) { setData(null); setLoading(false); return; }
    let cancelled = false;

    const load = async () => {
      try {
        const row = await getLatestWeather(portId);
        if (cancelled) return;
        setData(row);
        setLoading(false);
        setError(null);
      } catch (e: any) {
        if (cancelled) return;
        setError(e.message ?? 'Failed to load weather');
        setLoading(false);
      }
    };

    load();

    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase.channel(`weather-changes-${channelId}`);
      channel
        .on('postgres_changes', { event: '*', schema: 'public', table: 'weather_data', filter: `port_id=eq.${portId}` }, load)
        .subscribe();
    } catch {
      // realtime unavailable — the screen keeps working without live updates
    }

    return () => { cancelled = true; if (channel) supabase.removeChannel(channel); };
  }, [portId, channelId]);

  return { data, loading, error };
}
