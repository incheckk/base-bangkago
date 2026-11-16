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
  var COMPLIANCE_REPORT_PREFIX = '[Compliance Report]';
  var LEGACY_COMPLIANCE_REPORT_PREFIX = 'Zone:';

  function mapRow(row) {
    return {
      alertId: row.id,
      message: row.message,
      severity: row.severity,
      isResolved: row.is_resolved,
      dismissedAt: row.dismissed_at || null,
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
    if (filters.messagePrefix) q = q.like('message', filters.messagePrefix + '%');
    if (filters.excludeComplianceReports) {
      q = q
        .not('message', 'like', COMPLIANCE_REPORT_PREFIX + '%')
        .not('message', 'like', LEGACY_COMPLIANCE_REPORT_PREFIX + '%');
    }
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

  async function resolve(alertId) {
    const c = svc.getClient(); if (!c) throw new Error('No client');
    const r = await c.from('safety_alerts')
      .update({ is_resolved: true })
      .eq('id', alertId)
      .select('id')
      .maybeSingle();
    if (r.error) throw r.error;
    if (!r.data) throw new Error('The alert no longer exists or you do not have permission to resolve it.');
  }

  async function dismissComplianceReport(alertId) {
    const c = svc.getClient(); if (!c) throw new Error('No client');
    const r = await c.from('safety_alerts')
      .update({ dismissed_at: new Date().toISOString() })
      .eq('id', alertId)
      .is('dismissed_at', null)
      .select('id')
      .maybeSingle();
    if (r.error) {
      if ((r.error.code === 'PGRST204' || r.error.code === '42703') && /dismissed_at/i.test(r.error.message || '')) {
        throw new Error('Persistent report dismissal is not configured. Apply migrations/090_compliance_report_dismissal.sql after migration 089, then retry.');
      }
      throw r.error;
    }
    if (!r.data) throw new Error('The report was already dismissed, no longer exists, or you do not have permission to dismiss it.');
  }

  async function notify(recipients, message) {
    const c = svc.getClient(); if (!c) throw new Error('No client');
    // Recipients are role groups or 'all'.
    const roleMap = {
      'passenger': 'passenger',
      'bangkero': 'bangkero',
      'admin': 'admin',
      'coastguard': 'coastguard',
      'all': null,
      'all_operators': 'bangkero',
      'admins': 'admin'
    };
    if (!Object.prototype.hasOwnProperty.call(roleMap, recipients)) {
      throw new Error('Unknown recipients: ' + recipients);
    }
    const targetRole = roleMap[recipients];
    const users = [];
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
      let query = c.from('users').select('id').order('id', { ascending: true });
      if (targetRole) query = query.eq('user_role', targetRole);
      const r = await query.range(offset, offset + pageSize - 1);
      if (r.error) throw r.error;
      const page = r.data || [];
      users.push(...page);
      if (page.length < pageSize) break;
    }
    if (users.length === 0) return { count: 0 };

    const notifications = users.map(u => ({
      user_id: u.id,
      title: 'Safety Alert',
      message: message,
      is_read: false,
      category: 'safety'
    }));
    let sentCount = 0;
    for (let start = 0; start < notifications.length; start += pageSize) {
      const batch = notifications.slice(start, start + pageSize);
      const n = await c.from('notifications').insert(batch);
      if (n.error) {
        let detail = n.error.message || 'Unknown database error';
        if ((n.error.code === 'PGRST204' || n.error.code === '42703') && /category/i.test(detail)) {
          detail = 'Safety notification categories are not configured. Apply migrations/079_release_charter_profiles_categories_locks.sql, then retry.';
        }
        if (sentCount) {
          throw new Error(`Notifications reached ${sentCount} of ${users.length} users before sending failed: ${detail}`);
        }
        if (detail !== n.error.message) throw new Error(detail);
        throw n.error;
      }
      sentCount += batch.length;
    }
    return { count: sentCount };
  }

  window.bangkagoAlerts = { listAll, create, uploadEvidence, removeEvidence, getEvidenceUrl, resolve, dismissComplianceReport, notify };
})();