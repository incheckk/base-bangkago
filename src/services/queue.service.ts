import { mapPortQueueRow } from './mappers';
import { supabase } from './supabase';
import { getAllVesselPositions, getLatestPositionForBangkero } from './tracking.service';
import type { PortQueueDoc } from '../types/models';

/** How long a boat must sit inside a perimeter before it joins the list. */
export const DWELL_MS = 5 * 60_000;
/** How long an open request is held for the top eligible boat. */
export const HOLD_MS = 3 * 60_000;
/** A fix older than this no longer counts for dispatch eligibility. */
export const FRESH_MS = 3 * 60_000;

/** `${startPortId}__${endPortId}` (see booking.service routeIdFor). */
export const startPortOf = (routeId: string) => routeId.split('__')[0] ?? '';
export const endPortOf = (routeId: string) => routeId.split('__')[1] ?? '';

/** Great-circle distance in meters. */
export function haversineM(
  lat1: number, lng1: number, lat2: number, lng2: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** "1.2 km" above 1km, "450 m" below — the labels both sides show. */
export function formatDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

/**
 * The FCFS list at one port: active rows (left_at IS NULL) in the order
 * the boats entered the perimeter, with boat name + availability joined.
 */
export async function getPortQueue(portId: string): Promise<PortQueueDoc[]> {
  const { data, error } = await supabase
    .from('port_queue')
    .select('*, bangkeros(display_name, is_available)')
    .eq('port_id', portId)
    .is('left_at', null)
    .order('entered_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapPortQueueRow);
}

/** Every port's active list at once — the admin's per-port view. */
export async function getAllActiveQueues(): Promise<(PortQueueDoc & { portName: string | null })[]> {
  const { data, error } = await supabase
    .from('port_queue')
    .select('*, ports(port_name), bangkeros(display_name, is_available)')
    .is('left_at', null)
    .order('entered_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    ...mapPortQueueRow(row),
    portName: row.ports?.port_name ?? null,
  }));
}

export interface MyQueueState {
  entry: PortQueueDoc | null;
  /** 1-based place in the port's FCFS order; null when not listed. */
  rank: number | null;
  total: number;
}

/** This boat's active row plus its place in line (cross-port exclusive: ≤1 row). */
export async function getMyQueue(bangkeroUid: string): Promise<MyQueueState> {
  const { data, error } = await supabase
    .from('port_queue')
    .select('*, bangkeros(display_name, is_available)')
    .eq('bangkero_id', bangkeroUid)
    .is('left_at', null)
    .limit(1)
    .maybeSingle();
  if (error) throw error;

  const entry = data ? mapPortQueueRow(data) : null;
  if (!entry) return { entry: null, rank: null, total: 0 };

  const queue = await getPortQueue(entry.portId);
  const rank = queue.findIndex((q) => q.bangkeroId === bangkeroUid);
  return {
    entry,
    rank: rank >= 0 ? rank + 1 : null,
    total: queue.length,
  };
}

/**
 * The booking form's seat ceiling for a departure port: the largest boat
 * that could actually take this request — listed, past the dwell, online.
 * null when nobody is waiting there (the caller keeps its fallback and
 * shows the "request will wait" hint).
 */
export async function getQueuedSeatCeiling(portId: string | null): Promise<number | null> {
  if (!portId) return null;
  const cutoff = new Date(Date.now() - DWELL_MS).toISOString();
  const { data, error } = await supabase
    .from('port_queue')
    .select('bangkero_id, bangkeros!inner(is_available)')
    .eq('port_id', portId)
    .is('left_at', null)
    .lte('entered_at', cutoff)
    .eq('bangkeros.is_available', true);
  if (error) throw error;

  const bangkeroIds = (data ?? []).map((row: any) => row.bangkero_id as string);
  if (bangkeroIds.length === 0) return null;

  const { data: bangkas, error: bangkaErr } = await supabase
    .from('bangkas')
    .select('capacity')
    .in('bangkero_id', bangkeroIds);
  if (bangkaErr) throw bangkaErr;

  const caps = (bangkas ?? [])
    .map((row: { capacity: number | null }) => Number(row.capacity))
    .filter((n) => Number.isFinite(n) && n > 0);
  return caps.length ? Math.max(...caps) : null;
}

/**
 * Distance from the passenger to the nearest boat waiting at the port —
 * or null when nothing can be computed (no fixes logged yet).
 */
export async function getNearestQueuedBoatDistance(
  portId: string,
  passengerLat: number,
  passengerLng: number
): Promise<number | null> {
  const queue = await getPortQueue(portId);
  if (queue.length === 0) return null;

  const bangkeroIds = queue.map((q) => q.bangkeroId);
  const { data: bangkas, error } = await supabase
    .from('bangkas')
    .select('id, bangkero_id')
    .in('bangkero_id', bangkeroIds);
  if (error) throw error;

  const wanted = new Set((bangkas ?? []).map((b: any) => b.id));
  const latestByBangka = await getAllVesselPositions();
  let best: number | null = null;
  for (const pos of latestByBangka) {
    if (!wanted.has(pos.bangkaId)) continue;
    const d = haversineM(passengerLat, passengerLng, pos.latitude, pos.longitude);
    if (best === null || d < best) best = d;
  }
  return best;
}

/** The boat's own last fix — the bangkero-side distance badge. */
export async function getMyLastFix(
  bangkeroUid: string
): Promise<{ latitude: number; longitude: number; recordedAt: string } | null> {
  const found = await getLatestPositionForBangkero(bangkeroUid);
  if (!found) return null;
  return {
    latitude: found.position.latitude,
    longitude: found.position.longitude,
    recordedAt: found.position.recordedAt,
  };
}

/** This operator's boat capacity — the client-side fit-check chip. */
export async function getMyBangkaCapacity(bangkeroUid: string): Promise<number | null> {
  const { data, error } = await supabase
    .from('bangkas')
    .select('capacity')
    .eq('bangkero_id', bangkeroUid)
    .order('id')
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.capacity != null ? Number(data.capacity) : null;
}

/**
 * Sweep every open request whose hold is missing or expired. Safe to
 * call as often as you like: when nothing would change the RPC only
 * runs SELECTs (no writes → no realtime event loop).
 */
export async function refreshHolds(): Promise<void> {
  const { error } = await supabase.rpc('refresh_holds');
  if (error) throw error;
}
