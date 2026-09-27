import { useState, useEffect, useCallback, useRef } from 'react';
import { useRealtimeQuery } from './useRealtimeQuery';
import { getAllBangkeros, getBangkerosByStatus } from '../services/admin.service';
import type { BangkeroDoc } from '../types/models';

export function useOperators(status?: string) {
  const [data, setData] = useState<BangkeroDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const id = ++seq.current;
    try {
      const rows = status ? await getBangkerosByStatus(status) : await getAllBangkeros();
      if (id !== seq.current) return;
      setData(rows);
      setLoading(false);
      setError(null);
    } catch (e: any) {
      if (id !== seq.current) return;
      setError(e.message ?? 'Failed to load operators');
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { void load(); }, [load]);
  useRealtimeQuery(load, [{ table: 'bangkeros' }]);

  return { data, loading, error };
}
