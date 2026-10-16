/**
 * Audit log service for the admin Audit Log page.
 * Reads audit_log (migration 038) — admin-SELECT-only via RLS.
 * Written by DB triggers, so every admin change lands here regardless
 * of whether it came from mobile, web or an RPC.
 */
(function() {
  'use strict';
  var svc = window.bangkagoServices;

  function mapRow(row) {
    var actor = row.actor || {};
    return {
      id: row.id,
      actorId: row.actor_id,
      actorName: [actor.first_name, actor.last_name].filter(Boolean).join(' ') || 'Unknown user',
      actorRole: row.actor_role || 'unknown',
      action: row.action,
      targetTable: row.target_table,
      targetId: row.target_id,
      oldData: row.old_data || null,
      newData: row.new_data || null,
      createdAt: row.created_at
    };
  }

  /**
   * @param {object} opts  { table, actorRole, search, limit }
   * Actor names come from an explicit follow-up query (not an embed)
   * so no FK-hint guesswork — same pattern as ratings.getRaterNames.
   */
  async function listAudit(opts) {
    opts = opts || {};
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var q = c.from('audit_log').select('*');
    if (opts.table) q = q.eq('target_table', opts.table);
    if (opts.actorRole) q = q.eq('actor_role', opts.actorRole);
    q = q.order('created_at', { ascending: false }).limit(opts.limit || 300);
    var r = await q;
    if (r.error) throw r.error;

    var rows = r.data || [];
    var actorIds = [];
    rows.forEach(function(row) {
      if (row.actor_id && actorIds.indexOf(row.actor_id) === -1) actorIds.push(row.actor_id);
    });
    var names = {};
    if (actorIds.length) {
      var uRes = await c.from('users').select('id, first_name, last_name').in('id', actorIds);
      (uRes.data || []).forEach(function(u) { names[u.id] = u; });
    }

    var mapped = rows.map(function(row) {
      var m = mapRow(row);
      var u = names[row.actor_id];
      if (u) m.actorName = [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Unknown user';
      return m;
    });

    if (opts.search) {
      var term = opts.search.toLowerCase();
      mapped = mapped.filter(function(m) {
        return (m.actorName || '').toLowerCase().includes(term) ||
               (m.targetTable || '').toLowerCase().includes(term) ||
               (m.targetId || '').toLowerCase().includes(term);
      });
    }
    return mapped;
  }

  window.bangkagoAudit = { listAudit: listAudit };
})();
