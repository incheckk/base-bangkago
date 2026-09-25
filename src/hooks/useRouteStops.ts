import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { useChannelId } from './useChannelId';
import { getStopsByRoute } from '../services/route.service';
import type { RouteStopDoc } from '../types/models';

export function useRouteStops(routeId: string | null) {
  const [data, setData] = useState<RouteStopDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const channelId = useChannelId();

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

    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase.channel(`route-stops-changes-${channelId}`);
      channel
        .on('postgres_changes', { event: '*', schema: 'public', table: 'route_stops', filter: `route_id=eq.${routeId}` }, load)
        .subscribe();
    } catch {
      // realtime unavailable — the screen keeps working without live updates
    }

    return () => { cancelled = true; if (channel) supabase.removeChannel(channel); };
  }, [routeId, channelId]);

  return { data, loading, error };
}
