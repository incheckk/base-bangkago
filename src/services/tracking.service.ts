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
