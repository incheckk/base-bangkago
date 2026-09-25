import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { useChannelId } from './useChannelId';
import { getIslandPackages } from '../services/island-package.service';
import type { IslandPackageDoc } from '../types/models';

export function useIslandPackages() {
  const [data, setData] = useState<IslandPackageDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const channelId = useChannelId();

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

    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase.channel(`island-packages-changes-${channelId}`);
      channel
        .on('postgres_changes', { event: '*', schema: 'public', table: 'island_packages' }, load)
        .subscribe();
    } catch {
      // realtime unavailable — the screen keeps working without live updates
    }

    return () => { cancelled = true; if (channel) supabase.removeChannel(channel); };
  }, [channelId]);

  return { data, loading, error };
}
