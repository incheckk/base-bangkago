import { useState, useEffect, useCallback, useRef } from 'react';
import { useRealtimeQuery } from './useRealtimeQuery';
import { getIslandPackages } from '../services/island-package.service';
import type { IslandPackageDoc } from '../types/models';

export function useIslandPackages() {
  const [data, setData] = useState<IslandPackageDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const id = ++seq.current;
    try {
      const rows = await getIslandPackages();
      if (id !== seq.current) return;
      setData(rows);
      setLoading(false);
      setError(null);
    } catch (e: any) {
      if (id !== seq.current) return;
      setError(e.message ?? 'Failed to load island packages');
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useRealtimeQuery(load, [{ table: 'island_packages' }]);

  return { data, loading, error };
}
