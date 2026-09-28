import { supabase } from './supabase';
import type { VesselTrackingDoc } from '../types/models';

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
 */
export async function getBangkaIdForBangkero(bangkeroId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('bangkas')
    .select('id')
    .eq('bangkero_id', bangkeroId)
    .order('id')
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
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
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const position = await getLatestPosition(data.id);
  return position ? { bangkaId: data.id, position } : null;
}
