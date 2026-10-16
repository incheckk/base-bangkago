/**
 * Safety alerts service for web dashboards.
 * Mirrors mobile safety alert operations.
 */
(function() {
  'use strict';
  var svc = window.bangkagoServices;
  var EVIDENCE_BUCKET = 'compliance-evidence';
  var MAX_EVIDENCE_FILES = 5;
  var MAX_EVIDENCE_SIZE = 20 * 1024 * 1024;

  function mapRow(row) {
    return {
      alertId: row.id,
      message: row.message,
      severity: row.severity,
      isResolved: row.is_resolved,
      createdAt: row.created_at,
      bangkaId: row.bangka_id,
      portId: row.port_id,
      evidencePaths: row.evidence_paths || [],
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
    if (data.evidencePaths?.length) insertData.evidence_paths = data.evidencePaths;
    var r = await c.from('safety_alerts').insert(insertData).select().single();
    if (r.error) throw r.error;
    return mapRow(r.data);
  }

  async function uploadEvidence(files) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    if (!files || files.length === 0) return [];
    if (files.length > MAX_EVIDENCE_FILES) {
      throw new Error('Attach no more than ' + MAX_EVIDENCE_FILES + ' files.');
    }

    var auth = await c.auth.getUser();
    var uid = auth.data?.user?.id;
    if (auth.error || !uid) throw new Error('You must be signed in to upload evidence.');

    var allowedTypes = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
      pdf: 'application/pdf', mp4: 'video/mp4'
    };
    var bucket = c.storage.from(EVIDENCE_BUCKET);
    var uploadedPaths = [];

    try {
      for (var i = 0; i < files.length; i++) {
        var file = files[i];
        var extension = (file.name.split('.').pop() || '').toLowerCase();
        var contentType = Object.prototype.hasOwnProperty.call(allowedTypes, extension)
          ? allowedTypes[extension]
          : null;
        if (!contentType) throw new Error('Unsupported evidence file: ' + file.name);
        if (file.size > MAX_EVIDENCE_SIZE) {
          throw new Error(file.name + ' exceeds the 20 MB file limit.');
        }
        if (file.type && file.type !== contentType) {
          throw new Error('File type does not match its extension: ' + file.name);
        }

        var safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '') || ('evidence.' + extension);
        var folderId = window.crypto?.randomUUID
          ? window.crypto.randomUUID()
          : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
        var path = uid + '/reports/' + folderId + '/' + safeName;
        var result = await bucket.upload(path, await file.arrayBuffer(), {
          contentType: contentType,
          upsert: false
        });
        if (result.error) {
          var uploadError = (result.error.message || '').toLowerCase();
          if (uploadError.includes('bucket not found')) {
            throw new Error('Evidence storage is not configured. Apply migrations/039_compliance_evidence.sql in this Supabase project, then try again.');
          }
          if (uploadError.includes('row-level security policy')) {
            throw new Error('Supabase blocked this evidence upload. Re-run the updated migrations/039_compliance_evidence.sql and confirm your users.user_role is admin or coastguard.');
          }
          throw result.error;
        }
        uploadedPaths.push(path);
      }
      return uploadedPaths;
    } catch (error) {
      if (uploadedPaths.length) await bucket.remove(uploadedPaths);
      throw error;
    }
  }

  async function removeEvidence(paths) {
    if (!paths || paths.length === 0) return;
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var result = await c.storage.from(EVIDENCE_BUCKET).remove(paths);
    if (result.error) throw result.error;
  }

  async function getEvidenceUrl(path) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var result = await c.storage.from(EVIDENCE_BUCKET).createSignedUrl(path, 3600);
    if (result.error) throw result.error;
    if (!result.data?.signedUrl) throw new Error('Could not create a secure evidence link.');
    return result.data.signedUrl;
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
    // recipients: 'all_operators', 'coastguard', 'admins', 'all'
    // ('lgu' removed — not a valid users.user_role since migration 025)
    var roleMap = {
      'all_operators': 'bangkero',
      'coastguard': 'coastguard',
      'admins': 'admin',
      'all': null // all users
    };
    if (recipients && !Object.prototype.hasOwnProperty.call(roleMap, recipients)) {
      throw new Error('Unknown recipients: ' + recipients);
    }
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

  window.bangkagoAlerts = { listAll, create, uploadEvidence, removeEvidence, getEvidenceUrl, resolve, notify };
})();