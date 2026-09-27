import { useState, useEffect, useCallback, useRef } from 'react';
import { useRealtimeQuery } from './useRealtimeQuery';
import { getDemandForRoute } from '../services/demand.service';
import type { DemandPredictionDoc } from '../types/models';

export function useDemandPredictions(routeId: string | null) {
  const [data, setData] = useState<DemandPredictionDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!routeId) { setData([]); setLoading(false); return; }
    const id = ++seq.current;
    try {
      const rows = await getDemandForRoute(routeId);
      if (id !== seq.current) return;
      setData(rows);
      setLoading(false);
      setError(null);
    } catch (e: any) {
      if (id !== seq.current) return;
      setError(e.message ?? 'Failed to load demand predictions');
      setLoading(false);
    }
  }, [routeId]);

  useEffect(() => { void load(); }, [load]);
  useRealtimeQuery(
    load,
    routeId ? [{ table: 'demand_predictions', filter: `route_id=eq.${routeId}` }] : [],
  );

  return { data, loading, error };
}
