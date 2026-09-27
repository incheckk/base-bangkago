import { useState, useEffect, useCallback, useRef } from 'react';
import { useRealtimeQuery } from './useRealtimeQuery';
import { getAdminStats } from '../services/admin.service';
import type { AdminStats } from '../services/admin.service';

export function useAdminStats() {
  const [data, setData] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const id = ++seq.current;
    try {
      const stats = await getAdminStats();
      if (id !== seq.current) return;
      setData(stats);
      setLoading(false);
      setError(null);
    } catch (e: any) {
      if (id !== seq.current) return;
      setError(e.message ?? 'Failed to load admin stats');
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useRealtimeQuery(load, [
    { table: 'bookings' },
    { table: 'users' },
    { table: 'bangkeros' },
    { table: 'safety_alerts' },
    { table: 'payments' },
  ]);

  return { data, loading, error };
}
