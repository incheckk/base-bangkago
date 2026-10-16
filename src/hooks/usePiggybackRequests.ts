import { useCallback, useEffect, useRef, useState } from 'react';

import { listPendingPiggybackRequests } from '../services/parcel-piggyback.service';
import type { ParcelDoc } from '../types/models';
import { useRealtimeQuery } from './useRealtimeQuery';

export function usePiggybackRequests(operatorId: string | null) {
  const [data, setData] = useState<ParcelDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    console.log('[piggyback-debug] load called, operatorId =', operatorId);
    if (!operatorId) {
      console.log('[piggyback-debug] no operatorId, skipping');
      setData([]);
      setLoading(false);
      return;
    }
    const id = ++seq.current;
    try {
      const result = await listPendingPiggybackRequests(operatorId);
      console.log('[piggyback-debug] result count =', result?.length, 'data =', result);
      if (id !== seq.current) return;
      setData(result);
      setLoading(false);
      setError(null);
    } catch (e) {
      if (id !== seq.current) return;
      setError(e instanceof Error ? e.message : 'Failed to load requests');
      setLoading(false);
    }
  }, [operatorId]);

  useEffect(() => { void load(); }, [load]);
  // Piggyback rows hang off bookings, so both tables can invalidate the list.
  useRealtimeQuery(
    load,
    operatorId ? [{ table: 'parcels' }, { table: 'bookings' }] : [],
  );

  return { data, loading, error, refresh: load };
}
