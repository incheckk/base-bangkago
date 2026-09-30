import { supabase } from './supabase';
import type { RatingDoc } from '../types/models';

function mapRatingRow(row: any): RatingDoc {
  return {
    ratingId: row.id,
    score: row.score,
    comment: row.comment,
    createdAt: row.created_at,
    bookingId: row.booking_id,
    userId: row.user_id,
    bangkeroId: row.bangkero_id,
  };
}

export async function submitRating(rating: {
  score: number;
  comment?: string;
  bookingId: string;
  userId: string;
  bangkeroId: string;
}): Promise<RatingDoc> {
  const { data, error } = await supabase
    .from('ratings')
    .insert({
      score: rating.score,
      comment: rating.comment ?? null,
      booking_id: rating.bookingId,
      user_id: rating.userId,
      bangkero_id: rating.bangkeroId,
    })
    .select()
    .single();

  if (error) throw error;
  return mapRatingRow(data);
}

export async function getRatingsByUser(userId: string): Promise<RatingDoc[]> {
  const { data, error } = await supabase
    .from('ratings')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []).map(mapRatingRow);
}

export async function getRatingsByBooking(bookingId: string): Promise<RatingDoc[]> {
  const { data, error } = await supabase
    .from('ratings')
    .select('*')
    .eq('booking_id', bookingId);

  if (error) throw error;
  return (data ?? []).map(mapRatingRow);
}

export async function getRatingsByBangkero(bangkeroId: string): Promise<RatingDoc[]> {
  const { data, error } = await supabase
    .from('ratings')
    .select('*')
    .eq('bangkero_id', bangkeroId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []).map(mapRatingRow);
}

export async function getAverageRating(bangkeroId: string): Promise<number> {
  const { data, error } = await supabase
    .from('ratings')
    .select('score')
    .eq('bangkero_id', bangkeroId);

  if (error) throw error;
  if (!data || data.length === 0) return 0;
  return data.reduce((sum, r) => sum + r.score, 0) / data.length;
}

/**
 * Every bangkero's average + count in ONE query — the admin operators
 * list renders ★ per row without an N+1. Unrated bangkeros simply have
 * no entry (callers show "New" / "—").
 */
export async function getAverageRatingsMap(): Promise<Record<string, { avg: number; count: number }>> {
  const { data, error } = await supabase
    .from('ratings')
    .select('bangkero_id, score');

  if (error) throw error;
  const map: Record<string, { avg: number; count: number }> = {};
  for (const row of data ?? []) {
    const key = row.bangkero_id as string;
    if (!map[key]) map[key] = { avg: 0, count: 0 };
    map[key].avg += row.score;
    map[key].count += 1;
  }
  for (const key of Object.keys(map)) {
    map[key].avg = map[key].avg / map[key].count;
  }
  return map;
}

/** Star deductions applied by incident (mirrors 007_accepted_trip_rules.sql). */
export const PENALTY_MISSED_PICKUP = 0.5;
export const PENALTY_FALSE_ONBOARD = 1.0;
/** At or below this effective rating a bangkero can no longer accept bookings. */
export const MIN_ACCEPT_RATING = 3.0;

/**
 * What the accept gate sees: the passenger average — an unrated bangkero gets
 * the benefit of the doubt as 5.0 — minus accumulated penalties.
 *
 * Fails open on any lookup error (including the rating_penalty column missing
 * before migration 007): a transient failure must never block accepting work.
 */
export async function getEffectiveRating(bangkeroId: string): Promise<number> {
  try {
    const [ratingsRes, bangkeroRes] = await Promise.all([
      supabase.from('ratings').select('score').eq('bangkero_id', bangkeroId),
      supabase.from('bangkeros').select('*').eq('id', bangkeroId).maybeSingle(),
    ]);
    if (ratingsRes.error) throw ratingsRes.error;
    if (bangkeroRes.error) throw bangkeroRes.error;

    const rows = ratingsRes.data ?? [];
    const avg = rows.length === 0
      ? 5
      : rows.reduce((sum, r) => sum + r.score, 0) / rows.length;
    const penalty = Number(bangkeroRes.data?.rating_penalty ?? 0) || 0;
    return Math.max(0, avg - penalty);
  } catch {
    return 5;
  }
}

/**
 * Deducts stars via the SECURITY DEFINER RPC (RLS stops passengers writing
 * bangkeros directly). Accepts only the fixed incident increments.
 */
export async function applyRatingPenalty(bangkeroId: string, stars: number): Promise<void> {
  const { error } = await supabase.rpc('apply_bangkero_penalty', {
    p_bangkero: bangkeroId,
    p_stars: stars,
  });
  if (error) throw error;
}
