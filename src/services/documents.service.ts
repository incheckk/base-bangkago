import * as ImagePicker from 'expo-image-picker';
import type { Href } from 'expo-router';

import type { VerificationStatus } from '../types/models';
import { supabase } from './supabase';

// =============================================================
// The four verification documents + the GCash QR. Images are picked
// on the phone, uploaded to the public `docs` bucket (migration 011)
// under {uid}/…, and only the object PATH is stored on the bangkeros
// row — in the columns that have existed since 002 but had no writer.
// =============================================================

export type DocKey = 'govId' | 'boatReg' | 'coastal' | 'brgy';

export interface DocField {
  key: DocKey;
  label: string;
  icon: string;
  /** Bangkeros column the path is written to. */
  column: string;
}

export const DOCUMENT_FIELDS: DocField[] = [
  { key: 'govId', label: "Government-Issued ID", icon: '🪪', column: 'gov_issued_id' },
  { key: 'boatReg', label: 'Boat Registration Certificate', icon: '🚤', column: 'boat_registration_cert' },
  { key: 'coastal', label: 'Coastal Permit', icon: '🌊', column: 'coastal_permit' },
  { key: 'brgy', label: 'Barangay Clearance', icon: '📜', column: 'brgy_clearance' },
];

export type DocPaths = Record<DocKey, string | null>;

/** Where the profile menu / banners send the bangkero for their current state. */
export function documentsRoute(stat: VerificationStatus | undefined): Href {
  if (stat === 'verified') return '/(bangkero)/documents-approved';
  if (stat === 'pending') return '/(bangkero)/boat-under-review';
  if (stat === 'rejected') return '/(bangkero)/documents-rejected';
  // 'incomplete' (037) and the initial undefined while loading: the
  // upload screen is the only sensible default — you can't skip it.
  return '/(bangkero)/verify-boat';
}

export async function getDocPaths(uid: string): Promise<DocPaths> {
  const { data, error } = await supabase
    .from('bangkeros')
    .select('gov_issued_id, boat_registration_cert, coastal_permit, brgy_clearance')
    .eq('id', uid)
    .maybeSingle();
  if (error) throw error;
  return {
    govId: data?.gov_issued_id ?? null,
    boatReg: data?.boat_registration_cert ?? null,
    coastal: data?.coastal_permit ?? null,
    brgy: data?.brgy_clearance ?? null,
  };
}

export interface VerificationState {
  status: 'pending' | 'approved' | 'rejected';
  remarks: string | null;
  submittedAt: string | null;
}

/** Newest review round for this bangkero (RLS: own rows only). */
export async function getLatestVerification(uid: string): Promise<VerificationState | null> {
  const { data, error } = await supabase
    .from('bangkero_verification')
    .select('status, remarks, created_at')
    .eq('bangkero_id', uid)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data
    ? { status: data.status, remarks: data.remarks, submittedAt: data.created_at }
    : null;
}

export type PickSource = 'camera' | 'gallery';

/**
 * Camera or photo library, one code path. Returns the local uri, or
 * null when the user backs out. Throws on a denied permission so the
 * screen can say why nothing happened.
 */
async function launchPicker(
  source: PickSource,
  wantBase64: boolean
): Promise<ImagePicker.ImagePickerAsset | null> {
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    quality: 0.7,
    base64: wantBase64,
    // iOS hands HEIC back inside the file by default; the admin dashboard
    // can only render JPEG/PNG.
    preferredAssetRepresentationMode:
      ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  };

  let result: ImagePicker.ImagePickerResult;
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      throw new Error('Camera access is required — allow it in settings to take a photo.');
    }
    result = await ImagePicker.launchCameraAsync(options);
  } else {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      throw new Error('Photo access is required — allow it in settings to choose an image.');
    }
    result = await ImagePicker.launchImageLibraryAsync(options);
  }

  if (result.canceled) return null;
  return result.assets?.[0] ?? null;
}

/** Local uri — for screens that show the picked photo before uploading it. */
export async function pickImage(source: PickSource): Promise<string | null> {
  return (await launchPicker(source, false))?.uri ?? null;
}

/**
 * JPEG bytes straight from the picker, for uploads. Never re-read the
 * picked file: that read comes back as the 14-byte text "File not found"
 * on some photos, and iOS files are HEIC while the picker's base64 export
 * is always JPEG.
 */
export async function pickImageBase64(source: PickSource): Promise<string | null> {
  const base64 = (await launchPicker(source, true))?.base64;
  if (!base64) {
    throw new Error('That photo could not be read from this phone. Take a new photo.');
  }
  return base64;
}

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** base64 → bytes (Hermes has no atob). */
function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array((clean.length * 3) >> 2);
  let buffer = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < clean.length; i += 1) {
    buffer = (buffer << 6) | B64_ALPHABET.indexOf(clean[i]);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o] = (buffer >> bits) & 0xff;
      o += 1;
      buffer &= (1 << bits) - 1;
    }
  }
  return out.slice(0, o);
}

async function putImage(uid: string, name: string, base64: string): Promise<string> {
  const bytes = base64ToBytes(base64);
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (!jpeg && !png) {
    throw new Error('That photo could not be read from this phone. Take a new photo.');
  }
  const ext = png ? 'png' : 'jpg';
  const path = `${uid}/${name}.${ext}`;
  const { error } = await supabase.storage
    .from('docs')
    .upload(path, bytes, { contentType: png ? 'image/png' : 'image/jpeg', upsert: true });
  if (error) throw error;
  return path;
}

/** Upload one document and write its path onto the bangkeros row. */
export async function uploadDocImage(
  uid: string,
  key: DocKey,
  base64: string
): Promise<void> {
  const field = DOCUMENT_FIELDS.find((d) => d.key === key);
  if (!field) throw new Error('unknown document');
  const path = await putImage(uid, key, base64);
  const { error } = await supabase
    .from('bangkeros')
    .update({ [field.column]: path, updated_at: new Date().toISOString() })
    .eq('id', uid);
  if (error) throw error;
}

/** Clear one document's path (the storage object is left for GC). */
export async function removeDocImage(uid: string, key: DocKey): Promise<void> {
  const field = DOCUMENT_FIELDS.find((d) => d.key === key);
  if (!field) throw new Error('unknown document');
  const { error } = await supabase
    .from('bangkeros')
    .update({ [field.column]: null, updated_at: new Date().toISOString() })
    .eq('id', uid);
  if (error) throw error;
}

/**
 * Submit for review: requires all four paths, records a pending
 * round (insert allowed by 003 — bangkero_id = auth.uid()) and moves
 * bangkeros back to 'pending' so the admin's pending list and the
 * phone's state machine agree.
 */
export async function submitForReview(uid: string): Promise<void> {
  const paths = await getDocPaths(uid);
  if (!DOCUMENT_FIELDS.every((f) => paths[f.key])) {
    throw new Error('Upload all four documents before submitting.');
  }
  const { error } = await supabase
    .from('bangkero_verification')
    .insert({ bangkero_id: uid, status: 'pending' });
  if (error) throw error;
  const { error: upd } = await supabase
    .from('bangkeros')
    .update({ verification_stat: 'pending', updated_at: new Date().toISOString() })
    .eq('id', uid);
  if (upd) throw upd;
}

/** Display URL for a stored path (public bucket — demo). */
export function docPublicUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return supabase.storage.from('docs').getPublicUrl(path).data.publicUrl;
}

// =============================================================
// GCash QR — same bucket, one object per bangkero.
// =============================================================

const QR_NAME = 'gcash-qr';

export async function saveGcashQr(uid: string, base64: string): Promise<string> {
  const path = await putImage(uid, QR_NAME, base64);
  const { error } = await supabase
    .from('bangkeros')
    .update({ gcash_qr_url: path, updated_at: new Date().toISOString() })
    .eq('id', uid);
  if (error) throw error;
  return path;
}

export async function removeGcashQr(uid: string): Promise<void> {
  const { error } = await supabase
    .from('bangkeros')
    .update({ gcash_qr_url: null, updated_at: new Date().toISOString() })
    .eq('id', uid);
  if (error) throw error;
}
