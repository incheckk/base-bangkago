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
