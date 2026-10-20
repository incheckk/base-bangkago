import { useCallback, useEffect, useRef, useState } from 'react';

import { getLiveWeather, type LiveWeather } from '../services/weather.service';

/** Open-Meteo reading for one point, cached 15 min by the service. */
export function useLiveWeather(lat: number, lon: number) {
  const [data, setData] = useState<LiveWeather | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const id = ++seq.current;
    try {
      const w = await getLiveWeather(lat, lon);
      if (id !== seq.current) return;
      setData(w);
      setError(null);
    } catch (e: any) {
      if (id !== seq.current) return;
      setError(e?.message ?? 'Weather unavailable');
    }
  }, [lat, lon]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, refresh: load };
}
