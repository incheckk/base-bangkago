import { supabase } from './supabase';
import type { IslandPackageDoc } from '../types/models';

function mapRow(row: any): IslandPackageDoc {
  return {
    packageId: row.id,
    packageName: row.package_name,
    description: row.description,
    price: row.price,
    maxCapacity: row.max_capacity,
    durationHours: row.duration_hours,
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
