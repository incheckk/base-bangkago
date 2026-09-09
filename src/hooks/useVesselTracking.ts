import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { getTrackingByBangka, getAllVesselPositions, logPosition } from '../services/tracking.service';
import type { VesselTrackingDoc } from '../types/models';

export function useVesselTracking(bangkaId: string | null) {
  const [data, setData] = useState<VesselTrackingDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

    const channel = supabase
      .channel(`vessel-tracking-${bangkaId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vessel_tracking', filter: `bangka_id=eq.${bangkaId}` }, load)
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [bangkaId]);

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

    const channel = supabase
      .channel('all-vessel-tracking')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vessel_tracking' }, load)
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, []);

  return { data, loading, error };
}
