import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { getAdminStats } from '../services/admin.service';
import type { AdminStats } from '../services/admin.service';

export function useAdminStats() {
  const [data, setData] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const stats = await getAdminStats();
        if (cancelled) return;
        setData(stats);
        setLoading(false);
        setError(null);
      } catch (e: any) {
        if (cancelled) return;
        setError(e.message ?? 'Failed to load admin stats');
        setLoading(false);
      }
    };

    load();

    const channel = supabase
      .channel('admin-stats-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bangkeros' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'safety_alerts' }, load)
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, []);

  return { data, loading, error };
}
