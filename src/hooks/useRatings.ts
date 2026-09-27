import { useState, useEffect, useCallback, useRef } from 'react';
import { useRealtimeQuery } from './useRealtimeQuery';
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
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!userId) { setData([]); setLoading(false); return; }
    const id = ++seq.current;
    try {
      const rows = await getRatingsByUser(userId);
      if (id !== seq.current) return;
      setData(rows);
      setLoading(false);
      setError(null);
    } catch (e: any) {
      if (id !== seq.current) return;
      setError(e.message ?? 'Failed to load ratings');
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { void load(); }, [load]);
  useRealtimeQuery(
    load,
    userId ? [{ table: 'ratings', filter: `user_id=eq.${userId}` }] : [],
  );

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
