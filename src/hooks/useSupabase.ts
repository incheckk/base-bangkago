import { useCallback, useEffect, useRef, useState } from 'react';

import { useRealtimeQuery } from './useRealtimeQuery';
import { mapBangkeroRow, mapBookingRow, mapPortRow } from '../services/mappers';
import { supabase } from '../services/supabase';
import type { BangkeroDoc, BookingDoc, PortDoc } from '../types/models';

interface Result<T> {
  data: T;
  loading: boolean;
  error: string | null;
}

/**
 * Newest first, sorted in memory.
 */
const byNewest = (a: BookingDoc, b: BookingDoc) =>
  new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

/**
 * Every hook below follows the same shape: fetch once on mount (and again on
 * focus/foreground), then let useRealtimeQuery re-run the same fetch on any
 * change to the tables it reads. `seq` drops out-of-order responses so a slow
 * stale read can never overwrite a newer one.
 */

/** All active ports, sorted client-side by sortOrder. */
export function usePorts(): Result<PortDoc[]> {
  const [data, setData] = useState<PortDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const id = ++seq.current;
    const { data: rows, error: err } = await supabase.from('ports').select('*');
    if (id !== seq.current) return;
    if (err) { setError(err.message); setLoading(false); return; }
    setData(
      (rows ?? [])
        .map(mapPortRow)
        .filter((p) => p.isActive)
        .sort((a, b) => a.sortOrder - b.sortOrder)
    );
    setLoading(false);
    setError(null);
  }, []);

  useEffect(() => { setLoading(true); void load(); }, [load]);
  useRealtimeQuery(load, [{ table: 'ports' }]);

  return { data, loading, error };
}

/** Live count of bangkeros currently online. */
export function useAvailableBangkeroCount(): Result<number> {
  const [data, setData] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const id = ++seq.current;
    const { count, error: err } = await supabase
      .from('bangkeros')
      .select('*', { count: 'exact', head: true })
      .eq('is_available', true);
    if (id !== seq.current) return;
    if (err) { setError(err.message); setLoading(false); return; }
    setData(count ?? 0);
    setLoading(false);
    setError(null);
  }, []);

  useEffect(() => { setLoading(true); void load(); }, [load]);
  useRealtimeQuery(load, [{ table: 'bangkeros' }]);

  return { data, loading, error };
}

/** A passenger's most recent bookings. */
export function useRecentBookings(passengerId: string | null, max = 5): Result<BookingDoc[]> {
  const [data, setData] = useState<BookingDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!passengerId) { setData([]); setLoading(false); return; }
    const id = ++seq.current;
    const { data: rows, error: err } = await supabase
      .from('bookings')
      .select('*')
      .eq('user_id', passengerId);
    if (id !== seq.current) return;
    if (err) { setError(err.message); setLoading(false); return; }
    setData((rows ?? []).map(mapBookingRow).sort(byNewest).slice(0, max));
    setLoading(false);
    setError(null);
  }, [passengerId, max]);

  useEffect(() => { setLoading(true); void load(); }, [load]);
  useRealtimeQuery(
    load,
    passengerId ? [{ table: 'bookings', filter: `user_id=eq.${passengerId}` }] : [],
  );

  return { data, loading, error };
}

/**
 * Open requests a given bangkero should see.
 * Declines are filtered client-side.
 */
export function useOpenRequests(bangkeroUid: string | null): Result<BookingDoc[]> {
  const [data, setData] = useState<BookingDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!bangkeroUid) { setData([]); setLoading(false); return; }
    const id = ++seq.current;
    const { data: rows, error: err } = await supabase
      .from('bookings')
      .select('*')
      .eq('trip_stat', 'open');
    if (id !== seq.current) return;
    if (err) { setError(err.message); setLoading(false); return; }
    setData(
      (rows ?? [])
        .map(mapBookingRow)
        .filter((b) => !b.rejectedBy.includes(bangkeroUid))
        .sort(byNewest)
    );
    setLoading(false);
    setError(null);
  }, [bangkeroUid]);

  useEffect(() => { setLoading(true); void load(); }, [load]);
  useRealtimeQuery(load, bangkeroUid ? [{ table: 'bookings' }] : []);

  return { data, loading, error };
}

/** Bookings assigned to this bangkero, newest first. */
export function useMyTrips(bangkeroUid: string | null, max = 10): Result<BookingDoc[]> {
  const [data, setData] = useState<BookingDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!bangkeroUid) { setData([]); setLoading(false); return; }
    const id = ++seq.current;
    const { data: rows, error: err } = await supabase
      .from('bookings')
      .select('*')
      .eq('operator_id', bangkeroUid);
    if (id !== seq.current) return;
    if (err) { setError(err.message); setLoading(false); return; }
    setData((rows ?? []).map(mapBookingRow).sort(byNewest).slice(0, max));
    setLoading(false);
    setError(null);
  }, [bangkeroUid, max]);

  useEffect(() => { setLoading(true); void load(); }, [load]);
  useRealtimeQuery(
    load,
    bangkeroUid ? [{ table: 'bookings', filter: `operator_id=eq.${bangkeroUid}` }] : [],
  );

  return { data, loading, error };
}

/** The signed-in bangkero's own row. */
export function useBangkero(uid: string | null): Result<BangkeroDoc | null> {
  const [data, setData] = useState<BangkeroDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!uid) { setData(null); setLoading(false); return; }
    const id = ++seq.current;
    const { data: row, error: err } = await supabase
      .from('bangkeros')
      .select('*')
      .eq('id', uid)
      .maybeSingle();
    if (id !== seq.current) return;
    if (err) { setError(err.message); setLoading(false); return; }
    setData(row ? mapBangkeroRow(row) : null);
    setLoading(false);
    setError(null);
  }, [uid]);

  useEffect(() => { setLoading(true); void load(); }, [load]);
  useRealtimeQuery(load, uid ? [{ table: 'bangkeros', filter: `id=eq.${uid}` }] : []);

  return { data, loading, error };
}

/** One booking, live. */
export function useBooking(bookingId: string | null): Result<BookingDoc | null> {
  const [data, setData] = useState<BookingDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!bookingId) { setData(null); setLoading(false); return; }
    const id = ++seq.current;
    const { data: row, error: err } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', bookingId)
      .maybeSingle();
    if (id !== seq.current) return;
    if (err) { setError(err.message); setLoading(false); return; }
    setData(row ? mapBookingRow(row) : null);
    setLoading(false);
    setError(null);
  }, [bookingId]);

  useEffect(() => { setLoading(true); void load(); }, [load]);
  useRealtimeQuery(
    load,
    bookingId ? [{ table: 'bookings', filter: `id=eq.${bookingId}` }] : [],
  );

  return { data, loading, error };
}
