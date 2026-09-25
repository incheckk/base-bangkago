import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { useChannelId } from './useChannelId';
import { getAlerts, resolveAlert } from '../services/safety-alert.service';
import type { SafetyAlertDoc } from '../types/models';

interface Result {
  data: SafetyAlertDoc[];
  loading: boolean;
  error: string | null;
  resolveAlert: (id: string) => Promise<void>;
}

export function useSafetyAlerts(portId: string | null): Result {
  const [data, setData] = useState<SafetyAlertDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const channelId = useChannelId();

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const rows = await getAlerts(portId ?? undefined, true);
        if (cancelled) return;
        setData(rows);
        setLoading(false);
        setError(null);
      } catch (e: any) {
        if (cancelled) return;
        setError(e.message ?? 'Failed to load alerts');
        setLoading(false);
      }
    };

    load();

    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase.channel(`safety-alerts-changes-${channelId}`);
      channel
        .on('postgres_changes', { event: '*', schema: 'public', table: 'safety_alerts' }, load)
        .subscribe();
    } catch {
      // realtime unavailable — the screen keeps working without live updates
    }

    return () => { cancelled = true; if (channel) supabase.removeChannel(channel); };
  }, [portId, channelId]);

  const doResolveAlert = async (id: string) => {
    try {
      await resolveAlert(id);
      setData((prev) => prev.map((a) => (a.alertId === id ? { ...a, isResolved: true } : a)));
    } catch (e: any) {
      setError(e.message ?? 'Failed to resolve alert');
    }
  };

  return { data, loading, error, resolveAlert: doResolveAlert };
}
