import { useEffect, useState } from 'react';

import { mapBookingRow, mapOperatorRow, mapPierRow } from '../services/mappers';
import { supabase } from '../services/supabase';
import type { BookingDoc, OperatorDoc, PierDoc } from '../types/models';

interface Result<T> {
  data: T;
  loading: boolean;
  error: string | null;
}

/**
 * Newest first, sorted in memory — same reasoning as the Firestore version:
 * every query here filters on one column, and at prototype volume sorting
 * client-side costs nothing and needs no composite index to remember to
 * deploy.
 */
const byNewest = (a: BookingDoc, b: BookingDoc) =>
  new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

/**
 * Every hook below follows the same shape: fetch once, then subscribe to a
 * Realtime channel that just re-runs the same fetch on any change. This is
 * the Supabase equivalent of Firestore's onSnapshot — it isn't a diff-based
 * patch like onSnapshot gave for free, but at this data volume a refetch is
 * cheap and far easier to reason about than merging partial payloads by hand.
 */

/** All active piers, sorted client-side by sortOrder. */
export function usePiers(): Result<PierDoc[]> {
  const [data, setData] = useState<PierDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const { data: rows, error: err } = await supabase.from('piers').select('*');
      if (cancelled) return;
      if (err) { setError(err.message); setLoading(false); return; }
      setData(
        (rows ?? [])
          .map(mapPierRow)
          .filter((p) => p.isActive)
          .sort((a, b) => a.sortOrder - b.sortOrder)
      );
      setLoading(false);
      setError(null);
    };

    load();

    const channel = supabase
      .channel('piers-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'piers' }, load)
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, []);

  return { data, loading, error };
}

/** Live count of bangkeros currently online. Drives the "boats available" badge. */
export function useAvailableOperatorCount(): Result<number> {
  const [data, setData] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const { count, error: err } = await supabase
        .from('operators')
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
      .channel('operators-availability')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'operators' }, load)
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
        .eq('passenger_id', passengerId);
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
        { event: '*', schema: 'public', table: 'bookings', filter: `passenger_id=eq.${passengerId}` },
        load
      )
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [passengerId, max]);

  return { data, loading, error };
}

/**
 * Open requests a given bangkero should see.
 *
 * Declines are still filtered client-side rather than in the query — Postgres
 * *could* do "array does not contain" server-side, but keeping this filter
 * here matches the Firestore version's reasoning: the open-request list is
 * small by nature, so filtering after the fetch costs nothing.
 */
export function useOpenRequests(operatorUid: string | null): Result<BookingDoc[]> {
  const [data, setData] = useState<BookingDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!operatorUid) { setData([]); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);

    const load = async () => {
      const { data: rows, error: err } = await supabase
        .from('bookings')
        .select('*')
        .eq('status', 'open');
      if (cancelled) return;
      if (err) { setError(err.message); setLoading(false); return; }
      setData(
        (rows ?? [])
          .map(mapBookingRow)
          .filter((b) => !b.rejectedBy.includes(operatorUid))
          .sort(byNewest)
      );
      setLoading(false);
      setError(null);
    };

    load();

    // Realtime filters only support one column's equality per subscription,
    // and we need "any change to any booking" here (a new open request, an
    // accept that removes one, a decline that hides one) — so this listens
    // unfiltered and refetches, same as usePiers above.
    const channel = supabase
      .channel('bookings-open-requests')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, load)
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [operatorUid]);

  return { data, loading, error };
}

/** Bookings assigned to this bangkero, newest first. */
export function useMyTrips(operatorUid: string | null, max = 10): Result<BookingDoc[]> {
  const [data, setData] = useState<BookingDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!operatorUid) { setData([]); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);

    const load = async () => {
      const { data: rows, error: err } = await supabase
        .from('bookings')
        .select('*')
        .eq('operator_id', operatorUid);
      if (cancelled) return;
      if (err) { setError(err.message); setLoading(false); return; }
      setData((rows ?? []).map(mapBookingRow).sort(byNewest).slice(0, max));
      setLoading(false);
      setError(null);
    };

    load();

    const channel = supabase
      .channel(`bookings-operator-${operatorUid}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bookings', filter: `operator_id=eq.${operatorUid}` },
        load
      )
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [operatorUid, max]);

  return { data, loading, error };
}

/** The signed-in bangkero's own operator row — drives the availability toggle. */
export function useOperator(uid: string | null): Result<OperatorDoc | null> {
  const [data, setData] = useState<OperatorDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) { setData(null); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);

    const load = async () => {
      const { data: row, error: err } = await supabase
        .from('operators')
        .select('*')
        .eq('id', uid)
        .maybeSingle();
      if (cancelled) return;
      if (err) { setError(err.message); setLoading(false); return; }
      setData(row ? mapOperatorRow(row) : null);
      setLoading(false);
      setError(null);
    };

    load();

    const channel = supabase
      .channel(`operator-${uid}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'operators', filter: `id=eq.${uid}` },
        load
      )
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [uid]);

  return { data, loading, error };
}

/** One booking, live — this is what makes the passenger's status screen update. */
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