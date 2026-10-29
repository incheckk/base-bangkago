import { useState, useEffect, useCallback, useRef } from 'react';
import { useRealtimeQuery } from './useRealtimeQuery';
import { getTrackingByBangka, getAllVesselPositions, logPosition, getFleetBoats } from '../services/tracking.service';
import type { FleetBoat } from '../services/tracking.service';
import type { VesselTrackingDoc } from '../types/models';

export function useVesselTracking(bangkaId: string | null) {
  const [data, setData] = useState<VesselTrackingDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!bangkaId) { setData([]); setLoading(false); return; }
    const id = ++seq.current;
    try {
      const rows = await getTrackingByBangka(bangkaId);
      if (id !== seq.current) return;
      setData(rows);
      setLoading(false);
      setError(null);
    } catch (e: any) {
      if (id !== seq.current) return;
      setError(e.message ?? 'Failed to load vessel tracking');
      setLoading(false);
    }
  }, [bangkaId]);

  useEffect(() => { void load(); }, [load]);
  useRealtimeQuery(
    load,
    bangkaId ? [{ table: 'vessel_tracking', filter: `bangka_id=eq.${bangkaId}` }] : [],
  );

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

/**
 * Boat names for the fleet screen. These change rarely, so they are fetched
 * once per visit — the live part of that screen is vessel_tracking.
 */
export function useFleetBoats() {
  const [data, setData] = useState<FleetBoat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    getFleetBoats()
      .then((rows) => { if (alive) { setData(rows); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  return { data, loading };
}

export function useAllVesselTracking() {
  const [data, setData] = useState<VesselTrackingDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const id = ++seq.current;
    try {
      const rows = await getAllVesselPositions();
      if (id !== seq.current) return;
      setData(rows);
      setLoading(false);
      setError(null);
    } catch (e: any) {
      if (id !== seq.current) return;
      setError(e.message ?? 'Failed to load vessel positions');
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useRealtimeQuery(load, [{ table: 'vessel_tracking' }]);

  return { data, loading, error };
}
