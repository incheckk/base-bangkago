import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { getDemandForRoute } from '../services/demand.service';
import type { DemandPredictionDoc } from '../types/models';

export function useDemandPredictions(routeId: string | null) {
  const [data, setData] = useState<DemandPredictionDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!routeId) { setData([]); setLoading(false); return; }
    let cancelled = false;

    const load = async () => {
      try {
        const rows = await getDemandForRoute(routeId);
        if (cancelled) return;
        setData(rows);
        setLoading(false);
        setError(null);
      } catch (e: any) {
        if (cancelled) return;
        setError(e.message ?? 'Failed to load demand predictions');
        setLoading(false);
      }
    };

    load();

    const channel = supabase
      .channel('demand-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'demand_predictions', filter: `route_id=eq.${routeId}` }, load)
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [routeId]);

  return { data, loading, error };
}
