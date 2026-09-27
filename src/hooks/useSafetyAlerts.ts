import { useState, useEffect, useCallback, useRef } from 'react';
import { useRealtimeQuery } from './useRealtimeQuery';
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
  const seq = useRef(0);

  const load = useCallback(async () => {
    const id = ++seq.current;
    try {
      const rows = await getAlerts(portId ?? undefined, true);
      if (id !== seq.current) return;
      setData(rows);
      setLoading(false);
      setError(null);
    } catch (e: any) {
      if (id !== seq.current) return;
      setError(e.message ?? 'Failed to load alerts');
      setLoading(false);
    }
  }, [portId]);

  useEffect(() => { void load(); }, [load]);
  useRealtimeQuery(load, [{ table: 'safety_alerts' }]);

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
