/**
 * GCash QR management service for web admin dashboard.
 * Mirrors mobile app-settings.service.ts
 */
(function() {
  'use strict';
  var svc = window.bangkagoServices;

  const GCASH_QR_KEY = 'gcash_qr_url';

  async function getAdminGcashQr() {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var r = await c.from('app_settings').select('value').eq('key', GCASH_QR_KEY).maybeSingle();
    if (r.error) throw r.error;
    var value = r.data?.value?.trim();
    return value ? value : null;
  }

  async function saveAdminGcashQr(file) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    
    // Get current user for folder path
    var auth = await c.auth.getUser();
    var uid = auth.data?.user?.id;
    if (!uid) throw new Error('You must be signed in to upload the QR.');

    // Validate file
    if (!file || !file.type.startsWith('image/')) {
      throw new Error('Please select a valid image file (PNG or JPG).');
    }
    if (file.size > 5 * 1024 * 1024) {
      throw new Error('File size must be less than 5MB.');
    }

    // Upload to storage
    var ext = file.type === 'image/png' ? 'png' : 'jpg';
    var path = uid + '/admin-gcash-qr.' + ext;
    
    var arrayBuffer = await file.arrayBuffer();
    var uploadResult = await c.storage.from('docs').upload(path, arrayBuffer, {
      contentType: file.type,
      upsert: true
    });
    if (uploadResult.error) throw uploadResult.error;

    // Get public URL
    var urlData = c.storage.from('docs').getPublicUrl(path);
    var url = urlData.data?.publicUrl;
    if (!url) throw new Error('Failed to get public URL for uploaded image.');

    // Save to app_settings
    var upsertResult = await c.from('app_settings').upsert({ 
      key: GCASH_QR_KEY, 
      value: url, 
      updated_at: new Date().toISOString() 
    });
    if (upsertResult.error) throw upsertResult.error;

    return url;
  }

  async function clearAdminGcashQr() {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var r = await c.from('app_settings').upsert({ 
      key: GCASH_QR_KEY, 
      value: '', 
      updated_at: new Date().toISOString() 
    });
    if (r.error) throw r.error;
  }

  window.bangkagoGcash = { getAdminGcashQr, saveAdminGcashQr, clearAdminGcashQr };
})();