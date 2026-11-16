import { supabase } from './supabase';
import type { IslandPackageDoc } from '../types/models';

function mapRow(row: any): IslandPackageDoc {
  const boat = Array.isArray(row.bangkas) ? row.bangkas[0] : row.bangkas;
  return {
    packageId: row.id,
    packageName: row.package_name,
    description: row.description,
    price: Number(row.price),
    maxCapacity: Number(row.max_capacity),
    durationHours: Number(row.duration_hours),
    stops: Array.isArray(row.stops) ? (row.stops as string[]) : [],
    bangkaId: row.bangka_id ?? null,
    bangkaName: boat?.bangka_name ?? null,
    bangkaCapacity: boat?.capacity == null ? null : Number(boat.capacity),
    isActive: row.is_active !== false,
  };
}

export async function getIslandPackages(): Promise<IslandPackageDoc[]> {
  const { data, error } = await supabase
    .from('island_packages')
    .select('*, bangkas!island_packages_bangka_id_fkey(id,bangka_name,capacity,is_active,is_deleted,deleted_at,bangkeros!inner(verification_stat,is_deleted))')
    .eq('is_active', true)
    .eq('bangkas.is_active', true)
    .eq('bangkas.is_deleted', false)
    .is('bangkas.deleted_at', null)
    .eq('bangkas.bangkeros.verification_stat', 'verified')
    .eq('bangkas.bangkeros.is_deleted', false)
    .order('price');

  if (error) throw error;
  return (data ?? []).map(mapRow);
}

export async function getIslandPackage(packageId: string): Promise<IslandPackageDoc | null> {
  const { data, error } = await supabase
    .from('island_packages')
    .select('*, bangkas!island_packages_bangka_id_fkey(id,bangka_name,capacity,is_active,is_deleted,deleted_at)')
    .eq('id', packageId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data) : null;
}

export interface IslandPackageAvailability {
  capacity: number;
  reserved: number;
  available: number;
  bangkaName: string;
}

export async function getIslandPackageAvailability(
  packageId: string,
  sailingDate: string,
): Promise<IslandPackageAvailability> {
  const { data, error } = await supabase.rpc('island_package_availability', {
    p_package_id: packageId,
    p_sailing_date: sailingDate,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('This package has no active assigned Bangka.');
  return {
    capacity: Number(row.capacity),
    reserved: Number(row.reserved),
    available: Number(row.available),
    bangkaName: row.bangka_name,
  };
}
