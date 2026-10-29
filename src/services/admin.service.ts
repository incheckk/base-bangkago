import type { BangkeroDoc, UserDoc } from '../types/models';
import { manilaDayStartMs, manilaTodayIso, toManilaIso } from '../utils/date';
import { supabase } from './supabase';

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
    ratingPenalty: row.rating_penalty ?? 0,
    gcashQrUrl: row.gcash_qr_url ?? null,
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
  // Manila, not UTC: the old slice(0,10) of toISOString() moved "today"
  // at 08:00 local, so early-morning trips counted as yesterday's.
  const today = new Date(manilaDayStartMs(manilaTodayIso())).toISOString();
  const weekAgo = new Date(
    manilaDayStartMs(addDaysIso(manilaTodayIso(), -6))
  ).toISOString();

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
    supabase.from('bangkeros').select('*', { count: 'exact', head: true }).eq('is_available', true).eq('is_deleted', false),
    supabase.from('bookings').select('*', { count: 'exact', head: true }),
    supabase.from('bangkeros').select('*', { count: 'exact', head: true }).eq('verification_stat', 'pending').eq('is_deleted', false),
    supabase.from('safety_alerts').select('*', { count: 'exact', head: true }).eq('is_resolved', false),
    supabase.from('bookings').select('*', { count: 'exact', head: true }).gte('created_at', today),
    // Revenue follows the money: the fare is collected when the trip
    // completes, so only completed trips count — cancelled and no-show
    // trips contribute 0, and cash / GCash behave identically.
    supabase.from('bookings').select('total_price').eq('trip_stat', 'completed'),
    supabase.from('bookings').select('total_price').eq('trip_stat', 'completed').gte('completed_at', today),
    supabase.from('users').select('*', { count: 'exact', head: true }).gte('created_at', weekAgo),
    supabase.from('bookings').select('*', { count: 'exact', head: true }).eq('trip_stat', 'completed').gte('completed_at', today),
  ]);

  const totalRevenue = (revenueAllResult.data ?? []).reduce((sum, b) => sum + (b.total_price ?? 0), 0);
  const revenueToday = (revenueTodayResult.data ?? []).reduce((sum, b) => sum + (b.total_price ?? 0), 0);

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
    .eq('is_deleted', false)
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
    .eq('is_deleted', false)
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return (data ?? []).map(mapBangkeroRow);
}

/* ------------------------------------------------------------------ *
 * Reports
 *
 * One range, one fetch. Boundaries are Manila days (00:00 +08:00) — the
 * old UTC "today" put the first eight hours of every day on yesterday.
 * ------------------------------------------------------------------ */

export type ReportRange = 'today' | '7d' | '30d' | '6m' | '1y';

const RANGE_DAYS: Record<ReportRange, number> = {
  today: 0, '7d': 6, '30d': 29, '6m': 179, '1y': 364,
};

/** How many buckets a long range gets — days for the short ones, months after. */
const RANGE_BY_MONTH: ReportRange[] = ['6m', '1y'];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function addDaysIso(iso: string, delta: number): string {
  const d = new Date(manilaDayStartMs(iso) + delta * 86400000);
  return new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}

export interface ReportBucket {
  key: string;
  label: string;
  revenue: number;
  trips: number;
}

export interface ReportData {
  range: ReportRange;
  startIso: string;
  endIso: string;
  /** Completed trips in range, and the money they collected. */
  revenue: number;
  completed: number;
  /** Bookings created in range. */
  requests: number;
  cancelled: number;
  newUsers: number;
  /** Snapshot, not range-bound. */
  activeBangkeros: number;
  pendingApprovals: number;
  activeAlerts: number;
  statusCounts: Record<string, number>;
  buckets: ReportBucket[];
  topRoutes: { route: string; trips: number; revenue: number }[];
}

interface ReportRow {
  status: string | null;
  trip_stat: string | null;
  total_price: number | null;
  created_at: string | null;
  completed_at: string | null;
  from_port_name: string | null;
  to_port_name: string | null;
}

function makeBuckets(range: ReportRange, startIso: string, endIso: string): ReportBucket[] {
  const buckets: ReportBucket[] = [];
  if (RANGE_BY_MONTH.includes(range)) {
    const [sy, sm] = startIso.split('-').map(Number);
    const [ey, em] = endIso.split('-').map(Number);
    let y = sy;
    let m = sm;
    while (y < ey || (y === ey && m <= em)) {
      buckets.push({
        key: `${y}-${String(m).padStart(2, '0')}`,
        label: `${MONTHS[m - 1]} ${String(y).slice(2)}`,
        revenue: 0,
        trips: 0,
      });
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    }
    return buckets;
  }

  let day = startIso;
  while (day <= endIso) {
    buckets.push({
      key: day,
      label: new Date(manilaDayStartMs(day)).toLocaleDateString('en-PH', {
        month: 'short', day: 'numeric', timeZone: 'Asia/Manila',
      }),
      revenue: 0,
      trips: 0,
    });
    day = addDaysIso(day, 1);
  }
  return buckets;
}

export async function getReportData(range: ReportRange): Promise<ReportData> {
  const endIso = manilaTodayIso();
  const startIso = addDaysIso(endIso, -RANGE_DAYS[range]);
  const startTs = new Date(manilaDayStartMs(startIso)).toISOString();
  const monthMode = RANGE_BY_MONTH.includes(range);

  const [bookingsResult, usersCount, bangkerosCount, pendingCount, alertsCount] = await Promise.all([
    supabase
      .from('bookings')
      // A completion in range can belong to a request created long before it,
      // so the filter has to accept either timestamp.
      .select('status, trip_stat, total_price, created_at, completed_at, from_port_name, to_port_name')
      .or(`created_at.gte.${startTs},completed_at.gte.${startTs}`),
    supabase.from('users').select('*', { count: 'exact', head: true }).gte('created_at', startTs),
    supabase.from('bangkeros').select('*', { count: 'exact', head: true }).eq('is_available', true).eq('is_deleted', false),
    supabase.from('bangkeros').select('*', { count: 'exact', head: true }).eq('verification_stat', 'pending').eq('is_deleted', false),
    supabase.from('safety_alerts').select('*', { count: 'exact', head: true }).eq('is_resolved', false),
  ]);
  if (bookingsResult.error) throw bookingsResult.error;

  const rows = (bookingsResult.data ?? []) as ReportRow[];
  const buckets = makeBuckets(range, startIso, endIso);
  const bucketFor = new Map(buckets.map((b) => [b.key, b]));

  let revenue = 0;
  let completed = 0;
  let requests = 0;
  let cancelled = 0;
  const statusCounts: Record<string, number> = {};
  const routes = new Map<string, { trips: number; revenue: number }>();

  for (const row of rows) {
    const createdIso = toManilaIso(row.created_at);
    const completedIso = toManilaIso(row.completed_at);

    if (createdIso && createdIso >= startIso) {
      requests += 1;
      const status = row.status ?? 'unknown';
      statusCounts[status] = (statusCounts[status] ?? 0) + 1;
      if (status === 'cancelled') cancelled += 1;
    }

    if (row.trip_stat === 'completed' && completedIso && completedIso >= startIso) {
      const price = row.total_price ?? 0;
      completed += 1;
      revenue += price;

      const key = monthMode ? completedIso.slice(0, 7) : completedIso;
      const bucket = bucketFor.get(key);
      if (bucket) {
        bucket.revenue += price;
        bucket.trips += 1;
      }

      const route = `${row.from_port_name ?? '—'} → ${row.to_port_name ?? '—'}`;
      const entry = routes.get(route) ?? { trips: 0, revenue: 0 };
      entry.trips += 1;
      entry.revenue += price;
      routes.set(route, entry);
    }
  }

  return {
    range,
    startIso,
    endIso,
    revenue,
    completed,
    requests,
    cancelled,
    newUsers: usersCount.count ?? 0,
    activeBangkeros: bangkerosCount.count ?? 0,
    pendingApprovals: pendingCount.count ?? 0,
    activeAlerts: alertsCount.count ?? 0,
    statusCounts,
    buckets,
    topRoutes: [...routes.entries()]
      .map(([route, v]) => ({ route, ...v }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5),
  };
}
