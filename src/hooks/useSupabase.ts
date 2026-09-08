import { useEffect, useState } from 'react';

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
 * Every hook below follows the same shape: fetch once, then subscribe to a
 * Supabase Realtime channel that re-runs the same fetch on any change.
 */

/** All active ports, sorted client-side by sortOrder. */
export function usePorts(): Result<PortDoc[]> {
  const [data, setData] = useState<PortDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const { data: rows, error: err } = await supabase.from('ports').select('*');
      if (cancelled) return;
      if (err) { setError(err.message); setLoading(false); return; }
      setData(
        (rows ?? [])
          .map(mapPortRow)
          .filter((p) => p.isActive)
          .sort((a, b) => a.sortOrder - b.sortOrder)
      );
      setLoading(false);
      setError(null);
    };

    load();

    const channel = supabase
      .channel('ports-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ports' }, load)
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, []);

  return { data, loading, error };
}

/** Live count of bangkeros currently online. */
export function useAvailableBangkeroCount(): Result<number> {
  const [data, setData] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const { count, error: err } = await supabase
        .from('bangkeros')
        .select('*', { count: 'exact', head: true })
        .eq('is_available', true);
      if (cancelled) return;
      if (err) { setError(err.message); setLoading(false); return; }
      setData(count ?? 0);
      setLoading(false);
      setError(null);
    };

    load();

    const channel = supabase
      .channel('bangkeros-availability')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bangkeros' }, load)
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, []);

  return { data, loading, error };
}

/** A passenger's most recent bookings. */
export function useRecentBookings(passengerId: string | null, max = 5): Result<BookingDoc[]> {
  const [data, setData] = useState<BookingDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!passengerId) { setData([]); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);

    const load = async () => {
      const { data: rows, error: err } = await supabase
        .from('bookings')
        .select('*')
        .eq('user_id', passengerId);
      if (cancelled) return;
      if (err) { setError(err.message); setLoading(false); return; }
      setData((rows ?? []).map(mapBookingRow).sort(byNewest).slice(0, max));
      setLoading(false);
      setError(null);
    };

    load();

    const channel = supabase
      .channel(`bookings-passenger-${passengerId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bookings', filter: `user_id=eq.${passengerId}` },
        load
      )
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [passengerId, max]);

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

  useEffect(() => {
    if (!bangkeroUid) { setData([]); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);

    const load = async () => {
      const { data: rows, error: err } = await supabase
        .from('bookings')
        .select('*')
        .eq('trip_stat', 'open');
      if (cancelled) return;
      if (err) { setError(err.message); setLoading(false); return; }
      setData(
        (rows ?? [])
          .map(mapBookingRow)
          .filter((b) => !b.rejectedBy.includes(bangkeroUid))
          .sort(byNewest)
      );
      setLoading(false);
      setError(null);
    };

    load();

    const channel = supabase
      .channel('bookings-open-requests')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, load)
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [bangkeroUid]);

  return { data, loading, error };
}

/** Bookings assigned to this bangkero, newest first. */
export function useMyTrips(bangkeroUid: string | null, max = 10): Result<BookingDoc[]> {
  const [data, setData] = useState<BookingDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bangkeroUid) { setData([]); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);

    const load = async () => {
      const { data: rows, error: err } = await supabase
        .from('bookings')
        .select('*')
        .eq('operator_id', bangkeroUid);
      if (cancelled) return;
      if (err) { setError(err.message); setLoading(false); return; }
      setData((rows ?? []).map(mapBookingRow).sort(byNewest).slice(0, max));
      setLoading(false);
      setError(null);
    };

    load();

    const channel = supabase
      .channel(`bookings-bangkero-${bangkeroUid}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bookings', filter: `operator_id=eq.${bangkeroUid}` },
        load
      )
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [bangkeroUid, max]);

  return { data, loading, error };
}

/** The signed-in bangkero's own row. */
export function useBangkero(uid: string | null): Result<BangkeroDoc | null> {
  const [data, setData] = useState<BangkeroDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) { setData(null); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);

    const load = async () => {
      const { data: row, error: err } = await supabase
        .from('bangkeros')
        .select('*')
        .eq('id', uid)
        .maybeSingle();
      if (cancelled) return;
      if (err) { setError(err.message); setLoading(false); return; }
      setData(row ? mapBangkeroRow(row) : null);
      setLoading(false);
      setError(null);
    };

    load();

    const channel = supabase
      .channel(`bangkero-${uid}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bangkeros', filter: `id=eq.${uid}` },
        load
      )
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [uid]);

  return { data, loading, error };
}

/** One booking, live. */
export function useBooking(bookingId: string | null): Result<BookingDoc | null> {
  const [data, setData] = useState<BookingDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bookingId) { setData(null); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);

    const load = async () => {
      const { data: row, error: err } = await supabase
        .from('bookings')
        .select('*')
        .eq('id', bookingId)
        .maybeSingle();
      if (cancelled) return;
      if (err) { setError(err.message); setLoading(false); return; }
      setData(row ? mapBookingRow(row) : null);
      setLoading(false);
      setError(null);
    };

    load();

    const channel = supabase
      .channel(`booking-${bookingId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bookings', filter: `id=eq.${bookingId}` },
        load
      )
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [bookingId]);

  return { data, loading, error };
}
