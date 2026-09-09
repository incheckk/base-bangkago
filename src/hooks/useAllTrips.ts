import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { mapBookingRow } from '../services/mappers';
import { getAllBookings, getBookingsByStatus } from '../services/admin.service';
import type { BookingDoc } from '../types/models';

export function useAllTrips(status?: string) {
  const [data, setData] = useState<BookingDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const rows = status ? await getBookingsByStatus(status) : await getAllBookings();
        if (cancelled) return;
        setData(rows.map(mapBookingRow));
        setLoading(false);
        setError(null);
      } catch (e: any) {
        if (cancelled) return;
        setError(e.message ?? 'Failed to load trips');
        setLoading(false);
      }
    };

    load();

    const channel = supabase
      .channel('all-trips-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, load)
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [status]);

  return { data, loading, error };
}
