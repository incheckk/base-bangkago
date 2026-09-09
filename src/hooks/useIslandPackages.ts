import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { getIslandPackages } from '../services/island-package.service';
import type { IslandPackageDoc } from '../types/models';

export function useIslandPackages() {
  const [data, setData] = useState<IslandPackageDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const rows = await getIslandPackages();
        if (cancelled) return;
        setData(rows);
        setLoading(false);
        setError(null);
      } catch (e: any) {
        if (cancelled) return;
        setError(e.message ?? 'Failed to load island packages');
        setLoading(false);
      }
    };

    load();

    const channel = supabase
      .channel('island-packages-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'island_packages' }, load)
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, []);

  return { data, loading, error };
}
