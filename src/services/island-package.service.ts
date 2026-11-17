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

<<<<<<< HEAD
function isMissingPackageDeletedAtColumn(error: { code?: string; message?: string }): boolean {
  const message = (error.message ?? '').toLowerCase();
  if (error.code !== '42703' && error.code !== 'PGRST204') return false;
  return message.includes('deleted_at') && (
    message.includes('island_packages') ||
    (error.code === '42703' && !message.includes('bangkas'))
  );
=======
// 091 soft-deletes packages by stamping deleted_at; a DB that has not run it lacks the column.
function isMissingDeletedAtColumn(error: { code?: string; message?: string }): boolean {
  return (error.code === '42703' || error.code === 'PGRST204')
    && /deleted_at/i.test(error.message ?? '');
>>>>>>> 983725ce103a5bc73cecb15bf03de4a217eafe83
}

async function queryCatalog(filterDeleted: boolean) {
  const base = supabase
    .from('island_packages')
    .select('*')
    .eq('is_active', true);
<<<<<<< HEAD
  const packageFilter = includeDeletedAt ? base.is('deleted_at', null) : base;

  return packageFilter
    .eq('bangkas.is_active', true)
    .eq('bangkas.is_deleted', false)
    .is('bangkas.deleted_at', null)
    .eq('bangkas.bangkeros.verification_stat', 'verified')
    .eq('bangkas.bangkeros.is_deleted', false)
    .order('price');
}

export async function getIslandPackages(): Promise<IslandPackageDoc[]> {
  let result = await queryIslandPackages(true);
  if (result.error && isMissingPackageDeletedAtColumn(result.error)) {
    result = await queryIslandPackages(false);
=======
  return (filterDeleted ? base.is('deleted_at', null) : base).order('price');
}

/**
 * Packages are admin-managed catalog rows. They carry no boat: 084 allows
 * `bangka_id = NULL`, and dispatch assigns a bangkero from the accepted trip
 * (the boat also has to fit the seats, not just own the package).
 */
export async function getIslandPackages(): Promise<IslandPackageDoc[]> {
  let result = await queryCatalog(true);
  if (result.error && isMissingDeletedAtColumn(result.error)) {
    result = await queryCatalog(false);
>>>>>>> 983725ce103a5bc73cecb15bf03de4a217eafe83
  }

  if (result.error) throw result.error;
  return (result.data ?? []).map(mapRow);
}

// Soft-deleted packages stay readable here so booking and trip history still render.
export async function getIslandPackage(packageId: string): Promise<IslandPackageDoc | null> {
<<<<<<< HEAD
  const query = (includeDeletedAt: boolean) => {
    const base = supabase
      .from('island_packages')
      .select(PACKAGE_DETAIL_SELECT)
      .eq('id', packageId);
    return includeDeletedAt ? base.is('deleted_at', null) : base;
  };

  let result = await query(true).maybeSingle();
  if (result.error && isMissingPackageDeletedAtColumn(result.error)) {
    result = await query(false).maybeSingle();
  }
=======
  const { data, error } = await supabase
    .from('island_packages')
    .select('*')
    .eq('id', packageId)
    .maybeSingle();
>>>>>>> 983725ce103a5bc73cecb15bf03de4a217eafe83

  if (error) throw error;
  return data ? mapRow(data) : null;
}
