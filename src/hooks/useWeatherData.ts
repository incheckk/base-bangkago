import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { getLatestWeather } from '../services/weather.service';
import type { WeatherDataDoc } from '../types/models';

export function useWeatherData(portId: string | null) {
  const [data, setData] = useState<WeatherDataDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

    const channel = supabase
      .channel('weather-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'weather_data', filter: `port_id=eq.${portId}` }, load)
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [portId]);

  return { data, loading, error };
}
