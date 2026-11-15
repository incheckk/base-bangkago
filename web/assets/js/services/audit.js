/**
 * Audit log service for the admin Audit Log page.
 * Reads audit_log — admin-SELECT-only via RLS. Migration 080 records
 * semantic user actions in the same transaction as app and web writes.
 */
(function() {
  'use strict';
  var svc = window.bangkagoServices;

  // The page loads a bounded window first and grows by this step.
  var PAGE = 500;

  function mapRow(row) {
    return {
      id: row.id,
      actorId: row.actor_id,
      actorName: row.actor_name || 'Account unavailable',
      actorRole: row.actor_role || 'unknown',
      action: row.action,
      eventName: row.event_name || 'Historical activity',
      targetTable: row.target_table,
      targetId: row.target_id,
      targetLabel: row.target_label || 'Record',
      oldData: row.old_data || null,
      newData: row.new_data || null,
      createdAt: row.created_at
    };
  }

  // Identity and target labels are snapshotted by the trigger; no follow-up
  // user-table query is needed when the admin opens the activity feed.
  async function listAudit(limit) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var r = await c.from('audit_log').select(
      'id, actor_id, actor_role, actor_name, action, event_name, target_table, target_id, target_label, old_data, new_data, created_at'
    )
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit || PAGE);
    if (r.error) throw r.error;

    return (r.data || []).map(mapRow);
  }

  window.bangkagoAudit = { listAudit: listAudit, PAGE: PAGE };
})();
