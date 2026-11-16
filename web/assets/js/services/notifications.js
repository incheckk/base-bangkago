/**
 * Shared notifications service for web dashboards.
 *
 * Rows are scoped by the `notifications_select_own` RLS policy, so every
 * query below can stay user-agnostic: the database only ever returns the
 * signed-in account's rows.
 */
(function () {
  'use strict';

  var svc = window.bangkagoServices;

  function client() {
    var c = svc.getClient();
    if (!c) throw new Error('Supabase client is not ready yet');
    return c;
  }

  function mapRow(row) {
    return {
      id: row.id,
      category: row.category || 'system',
      title: row.title,
      message: row.message,
      isRead: !!row.is_read,
      createdAt: row.created_at,
    };
  }

  async function list(limit) {
    var res = await client()
      .from('notifications')
      .select('id, category, title, message, is_read, created_at')
      .order('created_at', { ascending: false })
      .limit(limit || 100);
    if (res.error) throw res.error;
    return (res.data || []).map(mapRow);
  }

  async function unreadCount() {
    var res = await client()
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('is_read', false);
    if (res.error) throw res.error;
    return res.count || 0;
  }

  async function markRead(id) {
    var res = await client()
      .from('notifications')
      .update({ is_read: true })
      .eq('id', id)
      .select('id')
      .maybeSingle();
    if (res.error) throw res.error;
    if (!res.data) throw new Error('Notification is no longer available or you do not have permission to update it.');
  }

  async function markAllRead() {
    var res = await client()
      .from('notifications')
      .update({ is_read: true })
      .eq('is_read', false);
    if (res.error) throw res.error;
  }

  async function clearOld() {
    var cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    var res = await client()
      .from('notifications')
      .delete()
      .lt('created_at', cutoff);
    if (res.error) throw res.error;
  }

  window.bangkagoNotifications = {
    list: list,
    unreadCount: unreadCount,
    markRead: markRead,
    markAllRead: markAllRead,
    clearOld: clearOld
  };
})();
