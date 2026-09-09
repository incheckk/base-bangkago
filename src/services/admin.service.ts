import { supabase } from './supabase';
import type { UserDoc, BangkeroDoc } from '../types/models';

function mapUserRow(row: any): UserDoc {
  return {
    uid: row.id,
    firstName: row.first_name,
    middleName: row.middle_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone_number,
    role: row.user_role,
    profilePhoto: row.profile_photo,
    isVerified: row.is_verified,
    createdAt: row.created_at,
  };
}

function mapBangkeroRow(row: any): BangkeroDoc {
  return {
    uid: row.id,
    govIssuedId: row.gov_issued_id,
    boatRegistrationCert: row.boat_registration_cert,
    coastalPermit: row.coastal_permit,
    brgyClearance: row.brgy_clearance,
    verificationStat: row.verification_stat,
    permitNumber: row.permit_number,
    displayName: row.display_name,
    isAvailable: row.is_available,
    updatedAt: row.updated_at,
  };
}

export async function getAllUsers(): Promise<UserDoc[]> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []).map(mapUserRow);
}

export async function getUsersByRole(role: string): Promise<UserDoc[]> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('user_role', role)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []).map(mapUserRow);
}

export async function suspendUser(userId: string): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({ is_verified: false })
    .eq('id', userId);

  if (error) throw error;
}

export async function verifyBangkero(
  bangkeroId: string,
  adminId: string,
  status: 'approved' | 'rejected',
  remarks?: string
): Promise<void> {
  const { error: verError } = await supabase
    .from('bangkero_verification')
    .insert({
      bangkero_id: bangkeroId,
      admin_id: adminId,
      status,
      remarks: remarks ?? null,
    });

  if (verError) throw verError;

  const verificationStat = status === 'approved' ? 'verified' : 'rejected';
  const { error: bkError } = await supabase
    .from('bangkeros')
    .update({ verification_stat: verificationStat })
    .eq('id', bangkeroId);

  if (bkError) throw bkError;
}

export interface AdminStats {
  totalUsers: number;
  activeBangkeros: number;
  totalTrips: number;
  totalRevenue: number;
  pendingApprovals: number;
  activeAlerts: number;
  tripsToday: number;
  revenueToday: number;
  newUsersThisWeek: number;
  completedTripsToday: number;
}

export async function getAdminStats(): Promise<AdminStats> {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  const [
    usersCount,
    bangkerosCount,
    tripsCount,
    pendingCount,
    alertsCount,
    tripsTodayResult,
    revenueAllResult,
    revenueTodayResult,
    newUsersResult,
    completedTodayResult,
  ] = await Promise.all([
    supabase.from('users').select('*', { count: 'exact', head: true }),
    supabase.from('bangkeros').select('*', { count: 'exact', head: true }).eq('is_available', true),
    supabase.from('bookings').select('*', { count: 'exact', head: true }),
    supabase.from('bangkeros').select('*', { count: 'exact', head: true }).eq('verification_stat', 'pending'),
    supabase.from('safety_alerts').select('*', { count: 'exact', head: true }).eq('is_resolved', false),
    supabase.from('bookings').select('*', { count: 'exact', head: true }).gte('created_at', today),
    supabase.from('payments').select('amount').eq('payment_status', 'completed'),
    supabase.from('payments').select('amount').eq('payment_status', 'completed').gte('created_at', today),
    supabase.from('users').select('*', { count: 'exact', head: true }).gte('created_at', weekAgo),
    supabase.from('bookings').select('*', { count: 'exact', head: true }).eq('trip_stat', 'completed').gte('created_at', today),
  ]);

  const totalRevenue = (revenueAllResult.data ?? []).reduce((sum, p) => sum + (p.amount ?? 0), 0);
  const revenueToday = (revenueTodayResult.data ?? []).reduce((sum, p) => sum + (p.amount ?? 0), 0);

  return {
    totalUsers: usersCount.count ?? 0,
    activeBangkeros: bangkerosCount.count ?? 0,
    totalTrips: tripsCount.count ?? 0,
    totalRevenue,
    pendingApprovals: pendingCount.count ?? 0,
    activeAlerts: alertsCount.count ?? 0,
    tripsToday: tripsTodayResult.count ?? 0,
    revenueToday,
    newUsersThisWeek: newUsersResult.count ?? 0,
    completedTripsToday: completedTodayResult.count ?? 0,
  };
}

export async function getBangkerosByStatus(status: string): Promise<BangkeroDoc[]> {
  const { data, error } = await supabase
    .from('bangkeros')
    .select('*')
    .eq('verification_stat', status)
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return (data ?? []).map(mapBangkeroRow);
}

export async function getAllBookings(): Promise<any[]> {
  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) throw error;
  return data ?? [];
}

export async function getBookingsByStatus(status: string): Promise<any[]> {
  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('trip_stat', status)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function getAllTrips(): Promise<any[]> {
  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) throw error;
  return data ?? [];
}

export async function getAllBangkeros(): Promise<BangkeroDoc[]> {
  const { data, error } = await supabase
    .from('bangkeros')
    .select('*')
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return (data ?? []).map(mapBangkeroRow);
}
