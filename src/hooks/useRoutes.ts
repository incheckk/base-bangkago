import { useState, useEffect, useCallback, useRef } from 'react';
import { useRealtimeQuery } from './useRealtimeQuery';
import { getAllRoutes } from '../services/route.service';
import type { RouteDoc } from '../types/models';

export function useRoutes() {
  const [data, setData] = useState<RouteDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const id = ++seq.current;
    try {
      const rows = await getAllRoutes();
      if (id !== seq.current) return;
      setData(rows);
      setLoading(false);
      setError(null);
    } catch (e: any) {
      if (id !== seq.current) return;
      setError(e.message ?? 'Failed to load routes');
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useRealtimeQuery(load, [{ table: 'routes' }]);

  return { data, loading, error, refresh: load };
}
