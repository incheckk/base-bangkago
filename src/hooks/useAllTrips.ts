import { useState, useEffect, useCallback, useRef } from 'react';
import { useRealtimeQuery } from './useRealtimeQuery';
import { mapBookingRow } from '../services/mappers';
import { getAllBookings, getBookingsByStatus } from '../services/admin.service';
import type { BookingDoc } from '../types/models';

export function useAllTrips(status?: string) {
  const [data, setData] = useState<BookingDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const id = ++seq.current;
    try {
      const rows = status ? await getBookingsByStatus(status) : await getAllBookings();
      if (id !== seq.current) return;
      setData(rows.map(mapBookingRow));
      setLoading(false);
      setError(null);
    } catch (e: any) {
      if (id !== seq.current) return;
      setError(e.message ?? 'Failed to load trips');
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { void load(); }, [load]);
  useRealtimeQuery(load, [{ table: 'bookings' }]);

  return { data, loading, error };
}
