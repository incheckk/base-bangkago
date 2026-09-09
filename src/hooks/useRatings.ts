import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { getRatingsByUser, submitRating } from '../services/rating.service';
import type { RatingDoc } from '../types/models';

interface Result {
  data: RatingDoc[];
  loading: boolean;
  error: string | null;
  submitRating: (rating: Omit<RatingDoc, 'ratingId' | 'createdAt'>) => Promise<void>;
}

export function useRatings(userId: string | null): Result {
  const [data, setData] = useState<RatingDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) { setData([]); setLoading(false); return; }
    let cancelled = false;

    const load = async () => {
      try {
        const rows = await getRatingsByUser(userId);
        if (cancelled) return;
        setData(rows);
        setLoading(false);
        setError(null);
      } catch (e: any) {
        if (cancelled) return;
        setError(e.message ?? 'Failed to load ratings');
        setLoading(false);
      }
    };

    load();

    const channel = supabase
      .channel('ratings-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ratings', filter: `user_id=eq.${userId}` }, load)
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [userId]);

  const doSubmitRating = async (rating: Omit<RatingDoc, 'ratingId' | 'createdAt'>) => {
    try {
      await submitRating({
        score: rating.score,
        comment: rating.comment ?? undefined,
        bookingId: rating.bookingId,
        userId: rating.userId,
        bangkeroId: rating.bangkeroId,
      });
    } catch (e: any) {
      setError(e.message ?? 'Failed to submit rating');
    }
  };

  return { data, loading, error, submitRating: doSubmitRating };
}
