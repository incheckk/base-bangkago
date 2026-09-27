import { useState, useEffect, useCallback, useRef } from 'react';
import { useRealtimeQuery } from './useRealtimeQuery';
import { getParcelsForBangkero } from '../services/parcel.service';
import type { ParcelDoc } from '../types/models';

export function useBangkeroParcels(bangkeroUid: string | null) {
  const [data, setData] = useState<ParcelDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!bangkeroUid) { setData([]); setLoading(false); return; }
    const id = ++seq.current;
    try {
      const rows = await getParcelsForBangkero(bangkeroUid);
      if (id !== seq.current) return;
      setData(rows);
      setLoading(false);
      setError(null);
    } catch (e: any) {
      if (id !== seq.current) return;
      setError(e.message ?? 'Failed to load parcels');
      setLoading(false);
    }
  }, [bangkeroUid]);

  useEffect(() => { void load(); }, [load]);
  // Parcels hang off bookings, so both tables can invalidate the list.
  useRealtimeQuery(
    load,
    bangkeroUid ? [{ table: 'parcels' }, { table: 'bookings' }] : [],
  );

  return { data, loading, error, refresh: load };
}
