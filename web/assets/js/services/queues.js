/**
 * Live port queues for the admin dashboard. Mirrors
 * src/services/queue.service.ts getAllActiveQueues(): the same rows the
 * FCFS dispatch acts on (008), so this list can never disagree with the app.
 */
(function() {
  'use strict';
  var svc = window.bangkagoServices;

  function mapRow(row) {
    var bangkero = row.bangkeros || {};
    return {
      queueId: row.id,
      portId: row.port_id,
      portName: row.ports?.port_name ?? null,
      bangkeroId: row.bangkero_id,
      displayName: bangkero.display_name ?? null,
      isAvailable: bangkero.is_available !== false,
      enteredAt: row.entered_at,
      leftAt: row.left_at
    };
  }

  async function listActiveQueues() {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var r = await c.from('port_queue')
      .select('*, ports(port_name), bangkeros!inner(display_name, is_available, is_deleted)')
      .eq('bangkeros.is_deleted', false)
      .is('left_at', null)
      .order('entered_at', { ascending: true });
    if (r.error) throw r.error;
    return (r.data || []).map(mapRow);
  }

  window.bangkagoQueues = { listActiveQueues };
})();
