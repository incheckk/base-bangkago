import { supabase } from './supabase';
import type { IslandPackageDoc } from '../types/models';

const PACKAGE_SELECT =
  '*, bangkas!island_packages_bangka_id_fkey(id,bangka_name,capacity,is_active,is_deleted,deleted_at,bangkeros!inner(verification_stat,is_deleted))';
const PACKAGE_DETAIL_SELECT =
  '*, bangkas!island_packages_bangka_id_fkey(id,bangka_name,capacity,is_active,is_deleted,deleted_at)';

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

function isMissingPackageDeletedAtColumn(error: { code?: string; message?: string }): boolean {
  const message = (error.message ?? '').toLowerCase();
  if (error.code !== '42703' && error.code !== 'PGRST204') return false;
  return message.includes('deleted_at') && (
    message.includes('island_packages') ||
    (error.code === '42703' && !message.includes('bangkas'))
  );
}

async function queryIslandPackages(includeDeletedAt: boolean) {
  const base = supabase
    .from('island_packages')
    .select(PACKAGE_SELECT)
    .eq('is_active', true);
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
  }

  if (result.error) throw result.error;
  return (result.data ?? []).map(mapRow);
}

export async function getIslandPackage(packageId: string): Promise<IslandPackageDoc | null> {
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

  if (result.error) throw result.error;
  return result.data ? mapRow(result.data) : null;
}
