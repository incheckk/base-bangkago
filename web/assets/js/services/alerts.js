/**
 * Safety alerts service for web dashboards.
 * Mirrors mobile safety alert operations.
 */
(function() {
  'use strict';
  var svc = window.bangkagoServices;

  function mapRow(row) {
    return {
      alertId: row.id,
      message: row.message,
      severity: row.severity,
      isResolved: row.is_resolved,
      createdAt: row.created_at,
      bangkaId: row.bangka_id,
      portId: row.port_id,
      // joined fields
      bangkaName: row.bangkas?.bangka_name ?? null,
      portName: row.ports?.port_name ?? null
    };
  }

  async function listAll(filters) {
    filters = filters || {};
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var q = c.from('safety_alerts').select('*, bangkas(bangka_name), ports(port_name)');
    if (filters.severity) q = q.eq('severity', filters.severity);
    if (filters.isResolved !== undefined) q = q.eq('is_resolved', filters.isResolved);
    if (filters.bangkaId) q = q.eq('bangka_id', filters.bangkaId);
    if (filters.portId) q = q.eq('port_id', filters.portId);
    q = q.order('created_at', { ascending: false });
    if (filters.limit) q = q.limit(filters.limit);
    var r = await q;
    if (r.error) throw r.error;
    return (r.data || []).map(mapRow);
  }

  async function create(data) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var insertData = {
      message: data.message,
      severity: data.severity || 'low',
      bangka_id: data.bangkaId || null,
      port_id: data.portId || null
    };
    var r = await c.from('safety_alerts').insert(insertData).select().single();
    if (r.error) throw r.error;
    return mapRow(r.data);
  }

  async function resolve(alertId, notes) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    // Check if resolution_notes column exists, if not just update is_resolved
    var updateData = { is_resolved: true };
    // Try to add resolution_notes - if column doesn't exist, Supabase will ignore or error
    // We'll try with the column and if it fails, retry without
    try {
      updateData.resolution_notes = notes || null;
      var r = await c.from('safety_alerts').update(updateData).eq('id', alertId);
      if (r.error) throw r.error;
    } catch (e) {
      // Column might not exist, retry without
      var r = await c.from('safety_alerts').update({ is_resolved: true }).eq('id', alertId);
      if (r.error) throw r.error;
    }
  }

  async function notify(alertId, recipients, message) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    // recipients: 'all_operators', 'coastguard', 'lgu', 'admins', 'all'
    var roleMap = {
      'all_operators': 'bangkero',
      'coastguard': 'coastguard',
      'lgu': 'lgu',
      'admins': 'admin',
      'all': null // all users
    };
    var targetRole = roleMap[recipients];
    var query = c.from('users').select('id');
    if (targetRole) query = query.eq('user_role', targetRole);
    var r = await query;
    if (r.error) throw r.error;
    var users = r.data || [];
    if (users.length === 0) return { count: 0 };

    var notifications = users.map(u => ({
      user_id: u.id,
      title: 'Safety Alert',
      message: message,
      is_read: false
    }));
    var n = await c.from('notifications').insert(notifications);
    if (n.error) throw n.error;
    return { count: users.length };
  }

  window.bangkagoAlerts = { listAll, create, resolve, notify };
})();