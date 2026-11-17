import { supabase } from './supabase';
import type { IslandPackageDoc } from '../types/models';

function mapRow(row: any): IslandPackageDoc {
  return {
    packageId: row.id,
    packageName: row.package_name,
    description: row.description,
    price: Number(row.price),
    durationHours: Number(row.duration_hours),
    stops: Array.isArray(row.stops) ? (row.stops as string[]) : [],
    isActive: row.is_active !== false,
  };
}

// 091 soft-deletes packages by stamping deleted_at; older DBs do not have the column.
function isMissingDeletedAtColumn(error: { code?: string; message?: string }): boolean {
  if (error.code !== '42703' && error.code !== 'PGRST204') return false;
  return /deleted_at/i.test(error.message ?? '');
}

async function queryCatalog(filterDeleted: boolean) {
  const base = supabase
    .from('island_packages')
    .select('*')
    .eq('is_active', true);

  return (filterDeleted ? base.is('deleted_at', null) : base).order('price');
}

export async function getIslandPackages(): Promise<IslandPackageDoc[]> {
  let result = await queryCatalog(true);
  if (result.error && isMissingDeletedAtColumn(result.error)) {
    result = await queryCatalog(false);
  }

  if (result.error) throw result.error;
  return (result.data ?? []).map(mapRow);
}

// Soft-deleted packages stay readable here so booking and trip history still render.
export async function getIslandPackage(packageId: string): Promise<IslandPackageDoc | null> {
  let result = await supabase
    .from('island_packages')
    .select('*')
    .eq('id', packageId)
    .maybeSingle();

  if (result.error && isMissingDeletedAtColumn(result.error)) {
    result = await supabase
      .from('island_packages')
      .select('*')
      .eq('id', packageId)
      .maybeSingle();
  }

  if (result.error) throw result.error;
  return result.data ? mapRow(result.data) : null;
}
