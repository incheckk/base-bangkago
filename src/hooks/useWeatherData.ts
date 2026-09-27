import { useState, useEffect, useCallback, useRef } from 'react';
import { useRealtimeQuery } from './useRealtimeQuery';
import { getLatestWeather } from '../services/weather.service';
import type { WeatherDataDoc } from '../types/models';

export function useWeatherData(portId: string | null) {
  const [data, setData] = useState<WeatherDataDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!portId) { setData(null); setLoading(false); return; }
    const id = ++seq.current;
    try {
      const row = await getLatestWeather(portId);
      if (id !== seq.current) return;
      setData(row);
      setLoading(false);
      setError(null);
    } catch (e: any) {
      if (id !== seq.current) return;
      setError(e.message ?? 'Failed to load weather');
      setLoading(false);
    }
  }, [portId]);

  useEffect(() => { void load(); }, [load]);
  useRealtimeQuery(
    load,
    portId ? [{ table: 'weather_data', filter: `port_id=eq.${portId}` }] : [],
  );

  return { data, loading, error };
}
