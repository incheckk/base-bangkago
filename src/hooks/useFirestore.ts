import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';

import { db } from '../services/firebase';
import type { BookingDoc, OperatorDoc, PierDoc } from '../types/models';

interface Result<T> {
  data: T;
  loading: boolean;
  error: string | null;
}

/**
 * Newest first, sorted in memory.
 *
 * Every booking query here filters on one field and orders by createdAt, which
 * is precisely the shape that demands a composite index. A missing index is a
 * hard query failure, it only surfaces at runtime, and it takes minutes to
 * build — three ways for a live demo to die. At prototype volume the sort costs
 * nothing, so the queries stay on Firestore's automatic single-field indexes
 * and there is nothing left to forget to deploy.
 *
 * A booking written moments ago has a null createdAt until serverTimestamp()
 * resolves, so nulls sort to the top — that pending doc is the newest thing
 * there is, and it is usually the one the demo just created.
 */
const byNewest = (a: BookingDoc, b: BookingDoc) => {
  const ta = a.createdAt?.toMillis?.() ?? Number.MAX_SAFE_INTEGER;
  const tb = b.createdAt?.toMillis?.() ?? Number.MAX_SAFE_INTEGER;
  return tb - ta;
};

/**
 * All piers, sorted client-side.
 *
 * Filtering isActive and ordering by sortOrder in the query would need its own
 * composite index for five documents. Reading all five and sorting in memory is
 * one less thing to forget to deploy.
 */
export function usePiers(): Result<PierDoc[]> {
  const [data, setData] = useState<PierDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () =>
      onSnapshot(
        collection(db, 'piers'),
        (snap) => {
          setData(
            snap.docs
              .map((d) => d.data() as PierDoc)
              .filter((p) => p.isActive)
              .sort((a, b) => a.sortOrder - b.sortOrder)
          );
          setLoading(false);
          setError(null);
        },
        (e) => { setError(e.message); setLoading(false); }
      ),
    []
  );

  return { data, loading, error };
}

/** Live count of bangkeros currently online. Drives the "boats available" badge. */
export function useAvailableOperatorCount(): Result<number> {
  const [data, setData] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () =>
      onSnapshot(
        query(collection(db, 'operators'), where('isAvailable', '==', true)),
        (snap) => { setData(snap.size); setLoading(false); setError(null); },
        (e) => { setError(e.message); setLoading(false); }
      ),
    []
  );

  return { data, loading, error };
}

/** A passenger's most recent bookings. No composite index needed — see byNewest. */
export function useRecentBookings(passengerId: string | null, max = 5): Result<BookingDoc[]> {
  const [data, setData] = useState<BookingDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!passengerId) { setData([]); setLoading(false); return; }
    setLoading(true);

    return onSnapshot(
      query(collection(db, 'bookings'), where('passengerId', '==', passengerId)),
      (snap) => {
        setData(snap.docs.map((d) => d.data() as BookingDoc).sort(byNewest).slice(0, max));
        setLoading(false);
        setError(null);
      },
      (e) => { setError(e.message); setLoading(false); }
    );
  }, [passengerId, max]);

  return { data, loading, error };
}

/**
 * Open requests a given bangkero should see.
 *
 * Declines are filtered client-side rather than in the query: Firestore has no
 * "array does not contain" operator, and adding one would mean a second field.
 * The open-request list is small by nature, so filtering after the fact costs
 * nothing and keeps the rule surface tiny.
 */
export function useOpenRequests(operatorUid: string | null): Result<BookingDoc[]> {
  const [data, setData] = useState<BookingDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!operatorUid) { setData([]); setLoading(false); return; }
    setLoading(true);

    return onSnapshot(
      query(collection(db, 'bookings'), where('status', '==', 'open')),
      (snap) => {
        setData(
          snap.docs
            .map((d) => d.data() as BookingDoc)
            .filter((b) => !(b.rejectedBy ?? []).includes(operatorUid))
            .sort(byNewest)
        );
        setLoading(false);
        setError(null);
      },
      (e) => { setError(e.message); setLoading(false); }
    );
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
    setLoading(true);

    return onSnapshot(
      query(collection(db, 'bookings'), where('operatorId', '==', operatorUid)),
      (snap) => {
        setData(snap.docs.map((d) => d.data() as BookingDoc).sort(byNewest).slice(0, max));
        setLoading(false);
        setError(null);
      },
      (e) => { setError(e.message); setLoading(false); }
    );
  }, [operatorUid, max]);

  return { data, loading, error };
}

/** The signed-in bangkero's own operator doc — drives the availability toggle. */
export function useOperator(uid: string | null): Result<OperatorDoc | null> {
  const [data, setData] = useState<OperatorDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) { setData(null); setLoading(false); return; }
    setLoading(true);

    return onSnapshot(
      doc(db, 'operators', uid),
      (snap) => {
        setData(snap.exists() ? (snap.data() as OperatorDoc) : null);
        setLoading(false);
        setError(null);
      },
      (e) => { setError(e.message); setLoading(false); }
    );
  }, [uid]);

  return { data, loading, error };
}

/** One booking, live. This is what makes the passenger's status screen update. */
export function useBooking(bookingId: string | null): Result<BookingDoc | null> {
  const [data, setData] = useState<BookingDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bookingId) { setData(null); setLoading(false); return; }
    setLoading(true);

    return onSnapshot(
      doc(db, 'bookings', bookingId),
      (snap) => {
        setData(snap.exists() ? (snap.data() as BookingDoc) : null);
        setLoading(false);
        setError(null);
      },
      (e) => { setError(e.message); setLoading(false); }
    );
  }, [bookingId]);

  return { data, loading, error };
}
