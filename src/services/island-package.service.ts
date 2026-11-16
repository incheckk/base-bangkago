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
    isActive: row.is_active !== false,
  };
}

/**
 * Packages are admin-managed catalog rows. They carry no boat: 084 allows
 * `bangka_id = NULL`, and dispatch assigns a bangkero from the accepted trip
 * (the boat also has to fit the seats, not just own the package).
 */
export async function getIslandPackages(): Promise<IslandPackageDoc[]> {
  const { data, error } = await supabase
    .from('island_packages')
    .select('*')
    .eq('is_active', true)
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
