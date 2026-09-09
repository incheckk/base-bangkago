import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
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

  useEffect(() => {
    if (!userId) { setData([]); setLoading(false); return; }
    let cancelled = false;

    const load = async () => {
      try {
        const rows = await fetchNotifications(userId);
        if (cancelled) return;
        setData(rows);
        setLoading(false);
        setError(null);
      } catch (e: any) {
        if (cancelled) return;
        setError(e.message ?? 'Failed to load notifications');
        setLoading(false);
      }
    };

    load();

    const channel = supabase
      .channel('notifications-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, load)
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [userId]);

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
