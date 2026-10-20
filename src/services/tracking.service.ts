import AsyncStorage from '@react-native-async-storage/async-storage';

import type { VesselTrackingDoc } from '../types/models';
import { supabase } from './supabase';

function mapRow(row: any): VesselTrackingDoc {
  return {
    trackId: row.id,
    latitude: row.latitude,
    longitude: row.longitude,
    speed: row.speed,
    recordedAt: row.recorded_at,
    bangkaId: row.bangka_id,
  };
}

export async function logPosition(
  bangkaId: string,
  latitude: number,
  longitude: number,
  speed?: number
): Promise<void> {
  const { error } = await supabase
    .from('vessel_tracking')
    .insert({
      bangka_id: bangkaId,
      latitude,
      longitude,
      speed: speed ?? null,
    });

  if (error) throw error;
}

/**
 * One call per GPS tick: logs the fix AND syncs the boat's presence in
 * the port-queue perimeters (008). Falls back to a plain insert when
 * migration 008 is not applied yet, so tracking never fully breaks.
 */
export async function reportPosition(
  bangkaId: string,
  latitude: number,
  longitude: number,
  speed?: number
): Promise<void> {
  const { error } = await supabase.rpc('report_boat_position', {
    p_lat: latitude,
    p_lng: longitude,
    p_speed: speed ?? null,
  });
  if (error) return logPosition(bangkaId, latitude, longitude, speed);
}

/**
 * The bangka row to fly (one per bangkero). Needed before the first
 * GPS tick — getLatestPositionForBangkero cannot seed tracking because
 * it returns null when no fix has ever been logged.
 *
 * Multi-boat operators fly the boat with the freshest GPS fix (the one
 * actually moving); otherwise the first by name — deterministic, never
 * an arbitrary `order(id)` pick.
 */
export async function getBangkaIdForBangkero(bangkeroId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('bangkas')
    .select('id')
    .eq('bangkero_id', bangkeroId)
    .eq('is_active', true)
    .order('bangka_name');
  if (error) throw error;
  const boats = (data ?? []) as { id: string }[];
  if (boats.length === 0) return null;
  if (boats.length === 1) return boats[0].id;
  try {
    // Latest-first globally (see getAllVesselPositions) — first own hit wins.
    const own = new Set(boats.map((b) => b.id));
    const ranked = (await getAllVesselPositions()).filter((p) => own.has(p.bangkaId));
    if (ranked.length > 0) return ranked[0].bangkaId;
  } catch {
    // No fixes yet (or tracking unreadable) — fall through to default.
  }
  return boats[0].id;
}

export async function getTrackingByBangka(
  bangkaId: string,
  limit = 50
): Promise<VesselTrackingDoc[]> {
  const { data, error } = await supabase
    .from('vessel_tracking')
    .select('*')
    .eq('bangka_id', bangkaId)
    .order('recorded_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []).map(mapRow);
}

export async function getAllVesselPositions(): Promise<VesselTrackingDoc[]> {
  const { data, error } = await supabase
    .from('vessel_tracking')
    .select('*')
    .order('recorded_at', { ascending: false });

  if (error) throw error;

  const seen = new Set<string>();
  const latest: VesselTrackingDoc[] = [];
  for (const row of data ?? []) {
    if (!seen.has(row.bangka_id)) {
      seen.add(row.bangka_id);
      latest.push(mapRow(row));
    }
  }
  return latest;
}

export async function getLatestPosition(
  bangkaId: string
): Promise<VesselTrackingDoc | null> {
  const { data, error } = await supabase
    .from('vessel_tracking')
    .select('*')
    .eq('bangka_id', bangkaId)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data) : null;
}

/**
 * Latest fix for whatever boat an operator flies — for bookings that were
 * never assigned a bangka_id (accept only records the operator).
 */
export async function getLatestPositionForBangkero(
  bangkeroId: string
): Promise<{ bangkaId: string; position: VesselTrackingDoc } | null> {
  const { data, error } = await supabase
    .from('bangkas')
    .select('id')
    .eq('bangkero_id', bangkeroId)
    .eq('is_active', true)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const position = await getLatestPosition(data.id);
  return position ? { bangkaId: data.id, position } : null;
}

// =============================================================
// Offline outbox (core sailing batch)
//
// Every GPS fix is written to AsyncStorage FIRST and only then sent.
// Offline at sea is the normal case, not the error case: the tick keeps
// queueing, the flush drains when the connection returns. Migration 056
// (sync_track_points) replays the batch with the client's real
// timestamps, so history survives the outage intact.
// =============================================================

/** One GPS fix, as the outbox stores it (client clock is the truth). */
export interface TrackFix {
  lat: number;
  lng: number;
  speed: number | null;
  /** ISO 8601 — when the fix was actually taken, not when it was sent. */
  recordedAt: string;
}

const outboxKey = (bangkaId: string) => `track_outbox:v1:${bangkaId}`;
/** Two hours of 10-second fixes; past that the FIFO drops the oldest. */
const OUTBOX_CAP = 720;
/** sync_track_points accepts at most this many per call (056). */
const FLUSH_BATCH = 500;

async function readOutbox(bangkaId: string): Promise<TrackFix[]> {
  try {
    const raw = await AsyncStorage.getItem(outboxKey(bangkaId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeOutbox(bangkaId: string, fixes: TrackFix[]): Promise<void> {
  const trimmed = fixes.slice(-OUTBOX_CAP);
  try {
    if (trimmed.length === 0) await AsyncStorage.removeItem(outboxKey(bangkaId));
    else await AsyncStorage.setItem(outboxKey(bangkaId), JSON.stringify(trimmed));
  } catch {
    // Storage full/racing — the next tick rewrites it.
  }
}

/** Queue one fix. Returns the queue depth after the write. */
export async function enqueueFix(bangkaId: string, fix: TrackFix): Promise<number> {
  const fixes = await readOutbox(bangkaId);
  fixes.push(fix);
  await writeOutbox(bangkaId, fixes);
  return Math.min(fixes.length, OUTBOX_CAP);
}

/** Newest queued fix — the boat's true position while offline. */
export async function peekLastQueuedFix(bangkaId: string): Promise<TrackFix | null> {
  const fixes = await readOutbox(bangkaId);
  return fixes.length > 0 ? fixes[fixes.length - 1] : null;
}

/** How many fixes are waiting to sync — the "N points saved" chip. */
export async function getOutboxDepth(bangkaId: string): Promise<number> {
  return (await readOutbox(bangkaId)).length;
}

/**
 * Send the queue in batches through sync_track_points (056). Returns
 * the number of fixes drained. Throws `missingFunction` when 056 is
 * not applied yet (same tolerance pattern as reportPosition/008) so
 * the caller can fall back to the legacy single-point path.
 */
export async function flushOutbox(bangkaId: string): Promise<number> {
  const fixes = await readOutbox(bangkaId);
  if (fixes.length === 0) return 0;

  const batch = fixes.slice(0, FLUSH_BATCH);
  const { error } = await supabase.rpc('sync_track_points', {
    p_bangka_id: bangkaId,
    p_points: batch.map((f) => ({
      lat: f.lat,
      lng: f.lng,
      speed: f.speed,
      recorded_at: f.recordedAt,
    })),
  });
  if (error) {
    const e = new Error(error.message) as Error & { missingFunction?: boolean };
    if (error.message.includes('sync_track_points')) e.missingFunction = true;
    throw e;
  }

  await writeOutbox(bangkaId, fixes.slice(batch.length));
  return batch.length;
}
