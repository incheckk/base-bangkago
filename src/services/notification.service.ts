import { isRunningInExpoGo } from 'expo';

import { supabase } from './supabase';
import type { NotificationDoc } from '../types/models';

function mapNotificationRow(row: any): NotificationDoc {
  return {
    notificationId: row.id,
    title: row.title,
    message: row.message,
    isRead: row.is_read,
    createdAt: row.created_at,
    userId: row.user_id,
  };
}

export async function fetchNotifications(userId: string): Promise<NotificationDoc[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) throw error;
  return (data ?? []).map(mapNotificationRow);
}

export async function markNotificationRead(id: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('id', id);

  if (error) throw error;
}

/** Badge clear — one write when the inbox opens; realtime syncs every badge. */
export async function markAllNotificationsRead(userId: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('user_id', userId)
    .eq('is_read', false);

  if (error) throw error;
}

/** Manual tidy-up — the inbox's "Clear old" button drops anything past a day. */
export async function clearOldNotifications(userId: string): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabase
    .from('notifications')
    .delete()
    .eq('user_id', userId)
    .lt('created_at', cutoff);

  if (error) throw error;
}

export async function createNotification(
  userId: string,
  title: string,
  message: string
): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .insert({ user_id: userId, title, message });

  if (error) throw error;
}

/**
 * Fires a notification on THIS device only (no push, no DB row) — for moments
 * where the event matters only to whoever is holding the phone right now.
 * Silently gives up when permission is unavailable.
 */
export async function scheduleLocalNotification(title: string, body: string): Promise<void> {
  // Expo Go: evaluating expo-notifications runs a push-token side effect that
  // THROWS on Android Expo Go (push removed since SDK 53). Metro reports the
  // module failure to LogBox BEFORE our catch sees it, so the only fix is to
  // never load the module there — and with no setNotificationHandler in this
  // app, Expo Go would not display it in the foreground anyway. The in-app
  // surfaces carry the message. Dev/production builds load it normally.
  if (isRunningInExpoGo()) return;
  try {
    const Notifications = await import('expo-notifications');
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      if (req.status !== 'granted') return;
    }
    await Notifications.scheduleNotificationAsync({
      content: { title, body },
      trigger: null,
    });
  } catch {
    // notifications unavailable — the in-app surfaces still carry the message
  }
}
