import { useState, useEffect, useCallback, useRef } from 'react';

import { useRealtimeQuery } from './useRealtimeQuery';
import {
  clearOldNotifications, fetchNotifications, markAllNotificationsRead, markNotificationRead,
} from '../services/notification.service';
import type { NotificationDoc } from '../types/models';

interface Result {
  data: NotificationDoc[];
  loading: boolean;
  error: string | null;
  markAsRead: (id: string) => Promise<void>;
  /** Badge clear — marks every row read in one write + mirrors locally. */
  markAllRead: () => Promise<void>;
  /** Clears rows older than a day — wired to the inbox's "Clear old" button. */
  clearOld: () => Promise<void>;
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

  const markAllRead = async () => {
    if (!userId) return;
    try {
      await markAllNotificationsRead(userId);
      setData((prev) => prev.map((n) => ({ ...n, isRead: true })));
    } catch (e: any) {
      setError(e.message ?? 'Failed to mark notifications as read');
    }
  };

  const clearOld = async () => {
    if (!userId) return;
    try {
      await clearOldNotifications(userId);
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      setData((prev) => prev.filter((n) => new Date(n.createdAt).getTime() >= cutoff));
    } catch {
      // housekeeping only — never surface it to the user
    }
  };

  const unreadCount = data.filter((n) => !n.isRead).length;

  return { data, loading, error, markAsRead, markAllRead, clearOld, unreadCount };
}
