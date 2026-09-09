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
    .order('created_at', { ascending: false });

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
