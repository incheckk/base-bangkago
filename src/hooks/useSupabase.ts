import { useCallback, useEffect, useRef, useState } from 'react';

import { getArrivalBypass, getDispatchBypass, getGatesBypass } from '../services/dev.service';
import { mapBangkeroRow, mapBookingRow, mapPortRow } from '../services/mappers';
import { mapRow as mapParcelRow } from '../services/parcel.service';
import {
    getAllActiveQueues, getMyQueue, getPortQueue, refreshHolds, type MyQueueState,
} from '../services/queue.service';
import { supabase } from '../services/supabase';
import type { BangkeroDoc, BookingDoc, ParcelDoc, PortDoc, PortQueueDoc } from '../types/models';
import { useRealtimeQuery } from './useRealtimeQuery';

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
      .eq('is_available', true)
      .eq('is_deleted', false);
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
    setData(
      (rows ?? [])
        .map(mapBookingRow)
        // Hide the shared batch booking (054) from the sender's own lists:
        // it is a system-created crossing, not a trip the passenger booked.
        .filter(
          (b) =>
            !(
              b.serviceType === 'cargo' &&
              b.cargoMode === 'batched' &&
              b.isDispatchable === true
            ),
        )
        .sort(byNewest)
        .slice(0, max),
    );
    setLoading(false);
    setError(null);
  }, [passengerId, max]);

  useEffect(() => { setLoading(true); void load(); }, [load]);
  useRealtimeQuery(
    load,
    passengerId
      ? [
          { table: 'bookings', filter: `user_id=eq.${passengerId}` },
          // Delivery flips `parcels.status`, not the stub booking — subscribe
          // so the home banner (and its parcel filter) clears without a remount.
          { table: 'parcels', filter: `user_id=eq.${passengerId}` },
        ]
      : [],
  );

  return { data, loading, error };
}

export interface ActiveCargoBooking {
  bookingId: string;
  ref: string;
  fromPortName: string;
  toPortName: string;
}

export interface ActiveCargoDelivery {
  parcel: ParcelDoc;
  booking: ActiveCargoBooking | null;
}

/**
 * The sender's live non-accompanied Padala. A batched sender has no usable
 * booking row once 054/058 cancel their stub and hide the shared batch from
 * their lists, so the parcel — not `bookings.trip_stat` — is the source of
 * truth. `status IN ('pending','in_transit')` drops a delivered/returned
 * parcel immediately (B1), and the parcels realtime sub re-runs the fetch.
 */
export function useActiveCargoDeliveries(
  passengerId: string | null,
): { data: ActiveCargoDelivery[]; error: string | null } {
  const [data, setData] = useState<ActiveCargoDelivery[]>([]);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!passengerId) return;
    const id = ++seq.current;
    const { data: rows, error: err } = await supabase
      .from('parcels')
      .select('*')
      .eq('user_id', passengerId)
      .in('delivery_type', ['batched', 'solo', 'piggyback'])
      .in('status', ['pending', 'in_transit'])
      .order('created_at', { ascending: false });
    if (id !== seq.current) return;
    if (err) { setError(err.message); return; }

    const parcels = (rows ?? []).map(mapParcelRow);
    // Batched/solo sail on the linked carrier booking; piggyback's own stub
    // is where approval + cancellation live.
    const targetId = (p: ParcelDoc) =>
      p.deliveryType === 'piggyback' ? p.bookingId : (p.carrierBookingId ?? p.bookingId);
    const ids = Array.from(new Set(parcels.map(targetId)));
    const bookingMap = new Map<string, ActiveCargoBooking>();
    // A cancelled stub must not leave its parcel pending: cancel_own_booking
    // only flips the booking, so the target row is the cancellation signal.
    // Auto-soloed parcels are the exception — an abandoned batch cancels the
    // stub it was linked to while the solo delivery is still live.
    const cancelledTargets = new Set<string>();

    if (ids.length > 0) {
      const { data: bookingRows, error: bookingErr } = await supabase
        .from('bookings')
        .select('id, ref, from_port_name, to_port_name, trip_stat')
        .in('id', ids);
      if (id !== seq.current) return;
      if (bookingErr) {
        if (__DEV__) {
          console.warn('[parcels] delivery booking lookup failed:', bookingErr.message);
        }
      } else {
        for (const row of bookingRows ?? []) {
          if (row.trip_stat === 'cancelled') cancelledTargets.add(row.id as string);
          bookingMap.set(row.id as string, {
            bookingId: row.id as string,
            ref: row.ref ?? '',
            fromPortName: row.from_port_name ?? '',
            toPortName: row.to_port_name ?? '',
          });
        }
      }
    }

    const autoSoloed = (p: ParcelDoc) =>
      p.deliveryType === 'batched' && p.batchingStatus === 'solo';

    setData(
      parcels
        .filter((parcel) => autoSoloed(parcel) || !cancelledTargets.has(targetId(parcel)))
        .map((parcel) => ({ parcel, booking: bookingMap.get(targetId(parcel)) ?? null })),
    );
    setError(null);
  }, [passengerId]);

  useEffect(() => { void load(); }, [load]);
  useRealtimeQuery(
    load,
    passengerId ? [{ table: 'parcels', filter: `user_id=eq.${passengerId}` }] : [],
  );

  return { data, error };
}

/**
 * Open requests a given bangkero should see.
 * Declines are filtered client-side. Each load first sweeps stale
 * dispatch holds (008) so the offer chips read the current holder;
 * the sweep is best-effort — pre-migration it simply fails silently.
 */
export function useOpenRequests(bangkeroUid: string | null): Result<BookingDoc[]> {
  const [data, setData] = useState<BookingDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!bangkeroUid) { setData([]); setLoading(false); return; }
    await refreshHolds().catch(() => {});
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

/**
 * Bookings assigned to this bangkero, newest first. Full history — the
 * trips history and passenger-search screens filter/sort it themselves,
 * so a slice here silently hid older trips from both.
 */
export function useMyTrips(bangkeroUid: string | null): Result<BookingDoc[]> {
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
    setData((rows ?? []).map(mapBookingRow).sort(byNewest));
    setLoading(false);
    setError(null);
  }, [bangkeroUid]);

  useEffect(() => { setLoading(true); void load(); }, [load]);
  useRealtimeQuery(
    load,
    bangkeroUid ? [{ table: 'bookings', filter: `operator_id=eq.${bangkeroUid}` }] : [],
  );

  return { data, loading, error };
}

/**
 * Every booking this bangkero currently has accepted — the live working
 * set behind departure boarding and home's active trips. No client-side
 * slice: a 10-row cap here silently dropped older-created accepted
 * bookings from the boarding split.
 */
export function useAcceptedBookings(bangkeroUid: string | null): Result<BookingDoc[]> {
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
      .eq('operator_id', bangkeroUid)
      .eq('trip_stat', 'accepted');
    if (id !== seq.current) return;
    if (err) { setError(err.message); setLoading(false); return; }
    setData((rows ?? []).map(mapBookingRow).sort(byNewest));
    setLoading(false);
    setError(null);
  }, [bangkeroUid]);

  useEffect(() => { setLoading(true); void load(); }, [load]);
  useRealtimeQuery(
    load,
    bangkeroUid ? [{ table: 'bookings', filter: `operator_id=eq.${bangkeroUid}` }] : [],
  );

  return { data, loading, error };
}

/**
 * This bangkero's no-shows since `sinceIso` — the departure screen's
 * NO-SHOWED group and freed-seats cue. Normally since = the draft
 * manifest's generated_at (or start of today before a manifest exists)
 * so last trip's no-shows never bleed into this one.
 */
export function useNoShowTrips(bangkeroUid: string | null, sinceIso: string | null): Result<BookingDoc[]> {
  const [data, setData] = useState<BookingDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!bangkeroUid || !sinceIso) { setData([]); setLoading(false); return; }
    const id = ++seq.current;
    const { data: rows, error: err } = await supabase
      .from('bookings')
      .select('*')
      .eq('operator_id', bangkeroUid)
      .not('no_show_at', 'is', null)
      .gte('no_show_at', sinceIso);
    if (id !== seq.current) return;
    if (err) { setError(err.message); setLoading(false); return; }
    setData((rows ?? []).map(mapBookingRow).sort(byNewest));
    setLoading(false);
    setError(null);
  }, [bangkeroUid, sinceIso]);

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
    let mapped = row ? mapBookingRow(row) : null;

    // Fallback: bangkeros.display_name when the denormalized operator_name
    // is missing (e.g. operator_id was set directly without the accept RPC).
    if (mapped?.operatorId && !mapped.operatorName) {
      try {
        const { data: bk } = await supabase
          .from('bangkeros')
          .select('display_name')
          .eq('id', mapped.operatorId)
          .maybeSingle();
        if (id !== seq.current) return;
        if (bk?.display_name) {
          mapped = { ...mapped, operatorName: bk.display_name };
        }
      } catch {
        // keep original mapped value
      }
    }

    setData(mapped);
    setLoading(false);
    setError(null);
  }, [bookingId]);

  useEffect(() => { setLoading(true); void load(); }, [load]);
  useRealtimeQuery(
    load,
    bookingId
      ? [
          { table: 'bookings', filter: `id=eq.${bookingId}` },
          // Delivery lands on the parcel, not the cargo stub — refresh so
          // the header badge and the terminal actions flip on their own.
          { table: 'parcels' },
        ]
      : [],
  );

  return { data, loading, error };
}

/**
 * The FCFS list at one port — oldest arrival first, live. Feeds the
 * passenger's waiting count and the bangkero's rank chip.
 */
export function usePortQueue(portId: string | null): Result<PortQueueDoc[]> {
  const [data, setData] = useState<PortQueueDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!portId) { setData([]); setLoading(false); setError(null); return; }
    const id = ++seq.current;
    try {
      const rows = await getPortQueue(portId);
      if (id !== seq.current) return;
      setData(rows);
      setLoading(false);
      setError(null);
    } catch (e: any) {
      if (id !== seq.current) return;
      setError(e.message ?? 'Failed to load the port queue');
      setLoading(false);
    }
  }, [portId]);

  useEffect(() => { setLoading(true); void load(); }, [load]);
  useRealtimeQuery(load, portId ? [{ table: 'port_queue' }] : []);

  return { data, loading, error };
}

/**
 * This boat's own place in line — "#2 at Mactan Pier 1", live. The
 * row is cross-port exclusive (008), so there is at most one.
 */
export function useMyPortQueue(bangkeroUid: string | null): Result<MyQueueState> {
  const [data, setData] = useState<MyQueueState>({ entry: null, rank: null, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!bangkeroUid) {
      setData({ entry: null, rank: null, total: 0 });
      setLoading(false);
      setError(null);
      return;
    }
    const id = ++seq.current;
    try {
      const state = await getMyQueue(bangkeroUid);
      if (id !== seq.current) return;
      setData(state);
      setLoading(false);
      setError(null);
    } catch (e: any) {
      if (id !== seq.current) return;
      setError(e.message ?? 'Failed to load your queue position');
      setLoading(false);
    }
  }, [bangkeroUid]);

  useEffect(() => { setLoading(true); void load(); }, [load]);
  useRealtimeQuery(load, [{ table: 'port_queue' }]);

  return { data, loading, error };
}

export interface DevFlags {
  /** Admin demo switch: true lifts the FCFS dispatch rules (009). */
  dispatchBypass: boolean;
  /** Admin demo switch: true lifts the verification + rating gates (010). */
  gatesBypass: boolean;
  /** Admin demo switch: true lets the arrived screen close out unboarded trips (026). */
  arrivalBypass: boolean;
}

/**
 * The admin's demo switch, live. Pre-009 (no dev_flags table) it reads
 * as OFF instead of erroring, so the app behaves exactly as before.
 * `refresh` exists because the toggle writes through an RPC — the
 * screen re-reads immediately instead of waiting for the realtime echo.
 */
export function useDevFlags(): Result<DevFlags> & { refresh: () => void } {
  const [data, setData] = useState<DevFlags>({ dispatchBypass: false, gatesBypass: false, arrivalBypass: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const id = ++seq.current;
    // Each flag tolerates its own migration being unrun: pre-009 reads
    // OFF, and a 009-only database still shows the dispatch switch for
    // real while gates/arrival read OFF.
    const [dispatch, gates, arrival] = await Promise.all([
      getDispatchBypass().catch(() => false),
      getGatesBypass().catch(() => false),
      getArrivalBypass().catch(() => false),
    ]);
    if (id !== seq.current) return;
    setData({ dispatchBypass: dispatch, gatesBypass: gates, arrivalBypass: arrival });
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => { setLoading(true); void load(); }, [load]);
  useRealtimeQuery(load, [{ table: 'dev_flags' }]);

  return { data, loading, error, refresh: load };
}

/** Every port's active queue at once — the admin's per-port lists. */
export function useAllPortQueues(): Result<(PortQueueDoc & { portName: string | null })[]> {
  const [data, setData] = useState<(PortQueueDoc & { portName: string | null })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const id = ++seq.current;
    try {
      const rows = await getAllActiveQueues();
      if (id !== seq.current) return;
      setData(rows);
      setLoading(false);
      setError(null);
    } catch (e: any) {
      if (id !== seq.current) return;
      setError(e.message ?? 'Failed to load port queues');
      setLoading(false);
    }
  }, []);

  useEffect(() => { setLoading(true); void load(); }, [load]);
  useRealtimeQuery(load, [{ table: 'port_queue' }]);

  return { data, loading, error };
}
