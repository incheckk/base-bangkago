import { useState, useEffect, useCallback, useRef } from 'react';

import { useRealtimeQuery } from './useRealtimeQuery';
import { fetchNotifications, markNotificationRead } from '../services/notification.service';
import type { NotificationDoc } from '../types/models';

interface Result {
  data: NotificationDoc[];
  loading: boolean;
  error: string | null;
  markAsRead: (id: string) => Promise<void>;
  unreadCount: number;
}

export function useNotifications(userId: string | null): Result {
  const [data, setData] = useState<NotificationDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!userId) { setData([]); setLoading(false); return; }
    const id = ++seq.current;
    try {
      const rows = await fetchNotifications(userId);
      if (id !== seq.current) return;
      setData(rows);
      setLoading(false);
      setError(null);
    } catch (e: any) {
      if (id !== seq.current) return;
      setError(e.message ?? 'Failed to load notifications');
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { void load(); }, [load]);
  useRealtimeQuery(
    load,
    userId ? [{ table: 'notifications', filter: `user_id=eq.${userId}` }] : [],
  );

  const markAsRead = async (id: string) => {
    try {
      await markNotificationRead(id);
      setData((prev) => prev.map((n) => (n.notificationId === id ? { ...n, isRead: true } : n)));
    } catch (e: any) {
      setError(e.message ?? 'Failed to mark as read');
    }
  };

  const unreadCount = data.filter((n) => !n.isRead).length;

  return { data, loading, error, markAsRead, unreadCount };
}
