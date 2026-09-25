import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { useChannelId } from './useChannelId';
import { getTrackingByBangka, getAllVesselPositions, logPosition } from '../services/tracking.service';
import type { VesselTrackingDoc } from '../types/models';

export function useVesselTracking(bangkaId: string | null) {
  const [data, setData] = useState<VesselTrackingDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const channelId = useChannelId();

  useEffect(() => {
    if (!bangkaId) { setData([]); setLoading(false); return; }
    let cancelled = false;

    const load = async () => {
      try {
        const rows = await getTrackingByBangka(bangkaId);
        if (cancelled) return;
        setData(rows);
        setLoading(false);
        setError(null);
      } catch (e: any) {
        if (cancelled) return;
        setError(e.message ?? 'Failed to load vessel tracking');
        setLoading(false);
      }
    };

    load();

    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase.channel(`vessel-tracking-${bangkaId}-${channelId}`);
      channel
        .on('postgres_changes', { event: '*', schema: 'public', table: 'vessel_tracking', filter: `bangka_id=eq.${bangkaId}` }, load)
        .subscribe();
    } catch {
      // realtime unavailable — the screen keeps working without live updates
    }

    return () => { cancelled = true; if (channel) supabase.removeChannel(channel); };
  }, [bangkaId, channelId]);

  const updatePosition = async (lat: number, lng: number, speed: number) => {
    if (!bangkaId) return;
    try {
      await logPosition(bangkaId, lat, lng, speed);
    } catch (e: any) {
      setError(e.message ?? 'Failed to log position');
    }
  };

  return { data, loading, error, updatePosition };
}

export function useAllVesselTracking() {
  const [data, setData] = useState<VesselTrackingDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const channelId = useChannelId();

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const rows = await getAllVesselPositions();
        if (cancelled) return;
        setData(rows);
        setLoading(false);
        setError(null);
      } catch (e: any) {
        if (cancelled) return;
        setError(e.message ?? 'Failed to load vessel positions');
        setLoading(false);
      }
    };

    load();

    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase.channel(`all-vessel-tracking-${channelId}`);
      channel
        .on('postgres_changes', { event: '*', schema: 'public', table: 'vessel_tracking' }, load)
        .subscribe();
    } catch {
      // realtime unavailable — the screen keeps working without live updates
    }

    return () => { cancelled = true; if (channel) supabase.removeChannel(channel); };
  }, [channelId]);

  return { data, loading, error };
}
