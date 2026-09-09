import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { getAllBangkeros, getBangkerosByStatus } from '../services/admin.service';
import type { BangkeroDoc } from '../types/models';

export function useOperators(status?: string) {
  const [data, setData] = useState<BangkeroDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const rows = status ? await getBangkerosByStatus(status) : await getAllBangkeros();
        if (cancelled) return;
        setData(rows);
        setLoading(false);
        setError(null);
      } catch (e: any) {
        if (cancelled) return;
        setError(e.message ?? 'Failed to load operators');
        setLoading(false);
      }
    };

    load();

    const channel = supabase
      .channel('operators-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bangkeros' }, load)
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [status]);

  return { data, loading, error };
}
