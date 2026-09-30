import { supabase } from './supabase';
import type { IslandPackageDoc } from '../types/models';

function mapRow(row: any): IslandPackageDoc {
  return {
    packageId: row.id,
    packageName: row.package_name,
    description: row.description,
    price: Number(row.price),
    maxCapacity: Number(row.max_capacity),
    durationHours: Number(row.duration_hours),
    stops: Array.isArray(row.stops) ? (row.stops as string[]) : [],
  };
}

export async function getIslandPackages(): Promise<IslandPackageDoc[]> {
  const { data, error } = await supabase
    .from('island_packages')
    .select('*')
    .order('price');

  if (error) throw error;
  return (data ?? []).map(mapRow);
}

export async function getIslandPackage(packageId: string): Promise<IslandPackageDoc | null> {
  const { data, error } = await supabase
    .from('island_packages')
    .select('*')
    .eq('id', packageId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data) : null;
}
