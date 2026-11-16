import { supabase } from './supabase';

// =============================================================
// app_settings — tiny key/value store (migration 015). Holds the
// ADMIN's GCash escrow QR: everyone can read it (passengers need it
// to pay, bangkeros to see where money goes), only admins write it.
// =============================================================

const GCASH_QR_KEY = 'gcash_qr_url';

/** Public URL of the admin's GCash QR, or null before it is uploaded. */
export async function getAdminGcashQr(): Promise<string | null> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', GCASH_QR_KEY)
    .maybeSingle();

  if (error) throw error;
  const value = data?.value?.trim();
  return value ? value : null;
}

/**
 * Admin uploads (or replaces) the escrow QR. The image goes to the
 * same public `docs` bucket as every other app image, under the
 * admin's own folder so the storage policy in 011 passes; the public
 * URL lands in app_settings.
 */
export async function saveAdminGcashQr(localUri: string): Promise<string> {
  const { data: authData } = await supabase.auth.getUser();
  const uid = authData.user?.id;
  if (!uid) throw new Error('You must be signed in to upload the QR.');

  const ext = /\.png(\?|$)/i.test(localUri) ? 'png' : 'jpg';
  const path = `${uid}/admin-gcash-qr.${ext}`;
  const resp = await fetch(localUri);
  const buf = await resp.arrayBuffer();
  const { error } = await supabase.storage
    .from('docs')
    .upload(path, buf, {
      contentType: ext === 'png' ? 'image/png' : 'image/jpeg',
      upsert: true,
    });
  if (error) throw error;

  const { data: pub } = supabase.storage.from('docs').getPublicUrl(path);
  const url = pub.publicUrl;

  const { error: upsertError } = await supabase
    .from('app_settings')
    .upsert({ key: GCASH_QR_KEY, value: url, updated_at: new Date().toISOString() });
  if (upsertError) throw upsertError;

  return url;
}

/** Admin clears the escrow QR (kept as an empty value — the row is the key). */
export async function clearAdminGcashQr(): Promise<void> {
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key: GCASH_QR_KEY, value: '', updated_at: new Date().toISOString() });
  if (error) throw error;
}

// =============================================================
// Commission (096) — a share of the WHOLE FARE, taken out of the
// downpayment, so the bangkero's payout is `downpayment - commission`.
// Snapshotted onto each downpayment when the payout is claimed, so
// changing the rate never rewrites history.
// =============================================================

export const DEFAULT_COMMISSION_RATE = 0.07;

export async function getCommissionRate(): Promise<number> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'commission_rate')
    .maybeSingle();
  // Pre-096 there is no row: the product default applies.
  if (error) return DEFAULT_COMMISSION_RATE;
  const rate = Number(data?.value);
  return Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_COMMISSION_RATE;
}

/** Admin-only — the RPC enforces it and the 5%–9% range. */
export async function setCommissionRate(rate: number): Promise<void> {
  const { error } = await supabase.rpc('set_commission_rate', { p_rate: rate });
  if (error) throw error;
}
