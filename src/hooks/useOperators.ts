import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { useChannelId } from './useChannelId';
import { getAllBangkeros, getBangkerosByStatus } from '../services/admin.service';
import type { BangkeroDoc } from '../types/models';

export function useOperators(status?: string) {
  const [data, setData] = useState<BangkeroDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const channelId = useChannelId();

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

    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase.channel(`operators-changes-${channelId}`);
      channel
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bangkeros' }, load)
        .subscribe();
    } catch {
      // realtime unavailable — the screen keeps working without live updates
    }

    return () => { cancelled = true; if (channel) supabase.removeChannel(channel); };
  }, [status, channelId]);

  return { data, loading, error };
}
