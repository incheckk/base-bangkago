import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { getStopsByRoute } from '../services/route.service';
import type { RouteStopDoc } from '../types/models';

export function useRouteStops(routeId: string | null) {
  const [data, setData] = useState<RouteStopDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!routeId) { setData([]); setLoading(false); return; }
    let cancelled = false;

    const load = async () => {
      try {
        const rows = await getStopsByRoute(routeId);
        if (cancelled) return;
        setData(rows);
        setLoading(false);
        setError(null);
      } catch (e: any) {
        if (cancelled) return;
        setError(e.message ?? 'Failed to load route stops');
        setLoading(false);
      }
    };

    load();

    const channel = supabase
      .channel('route-stops-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'route_stops', filter: `route_id=eq.${routeId}` }, load)
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [routeId]);

  return { data, loading, error };
}
