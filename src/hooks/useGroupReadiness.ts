import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useRealtimeQuery } from './useRealtimeQuery';
import { supabase } from '../services/supabase';
import { getPassengerDetailsByBooking } from '../services/passenger-detail.service';
import { mapRow as mapParcelRow } from '../services/parcel.service';
import type { BookingDoc, ParcelDoc, PassengerDetailDoc } from '../types/models';

export interface GroupReadiness {
  /** Resolved state per member booking id (false while its data loads). */
  resolvedByBookingId: Record<string, boolean>;
  /** Every member resolved. */
  allResolved: boolean;
  /** True while companions or parcels for the current wave are still loading. */
  loading: boolean;
}

/**
 * Home's mirror of booking-status's memberResolved gate (022/073): a
 * passenger member is resolved when the booker is aboard (or explicitly
 * not aboard) AND every companion is ticked or no-showed; a cargo member
 * when every attached parcel is loaded or returned. Reads passenger_details
 * and parcels live so a QR scan or parcel check flips home's card in
 * real time — bookings alone (onboarded_at) never told the whole story.
 */
export function useGroupReadiness(members: BookingDoc[]): GroupReadiness {
  const passengers = members.filter((m) => m.serviceType !== 'cargo');
  const cargoIds = members
    .filter((m) => m.serviceType === 'cargo')
    .map((m) => m.bookingId);
  const passengerIdsKey = passengers.map((m) => m.bookingId).join(',');
  const cargoIdsKey = cargoIds.join(',');

  /** bookingId → companion roster. null = read failed (gate stays closed). */
  const [companions, setCompanions] = useState<Record<string, PassengerDetailDoc[] | null>>({});
  const [companionsKey, setCompanionsKey] = useState('');
  /** BookingId → the parcel that names this booking (booking_id link). */
  const [baseByBookingId, setBaseByBookingId] = useState<Record<string, ParcelDoc | null>>({});
  /** BookingId → parcels linked by carrier_booking_id / piggyback_booking_id. */
  const [attachedByBookingId, setAttachedByBookingId] = useState<Record<string, ParcelDoc[]>>({});
  const [parcelsKey, setParcelsKey] = useState('');

  const companionsRef = useRef(0);
  const loadCompanions = useCallback(async () => {
    const ids = passengerIdsKey ? passengerIdsKey.split(',') : [];
    if (ids.length === 0) {
      setCompanionsKey(passengerIdsKey);
      return;
    }
    const id = ++companionsRef.current;
    const entries = await Promise.all(
      ids.map(async (bookingId) => {
        try {
          return [bookingId, await getPassengerDetailsByBooking(bookingId)] as const;
        } catch {
          // null keeps the gate closed when the roster cannot be read
          return [bookingId, null] as const;
        }
      })
    );
    if (id !== companionsRef.current) return;
    setCompanions((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    setCompanionsKey(passengerIdsKey);
  }, [passengerIdsKey]);

  const parcelsRef = useRef(0);
  const loadParcels = useCallback(async () => {
    const ids = cargoIdsKey ? cargoIdsKey.split(',') : [];
    if (ids.length === 0) {
      setParcelsKey(cargoIdsKey);
      return;
    }
    const id = ++parcelsRef.current;
    const base = await supabase
      .from('parcels')
      .select('*')
      .in('booking_id', ids);
    // 045: carrier_booking_id may not exist pre-045 — fall back to the
    // piggyback key only.
    const attached = await supabase
      .from('parcels')
      .select('*')
      .or(ids.flatMap((bookingId) => [
        `piggyback_booking_id.eq.${bookingId}`,
        `carrier_booking_id.eq.${bookingId}`,
      ]).join(','));
    if (id !== parcelsRef.current) return;
    if (base.error || attached.error) {
      if (__DEV__) {
        console.warn(
          '[readiness] parcel read skipped:',
          base.error?.message ?? attached.error?.message
        );
      }
      // Total failure leaves both maps empty: no cargo member reads as
      // resolved, so the card never claims "Mark completed" blind.
      setAttachedByBookingId({});
      setParcelsKey(cargoIdsKey);
      return;
    }
    const baseMap: Record<string, ParcelDoc | null> = {};
    for (const row of base.data ?? []) {
      const p = mapParcelRow(row);
      if (p.bookingId) baseMap[p.bookingId] = p;
    }
    const attachedMap: Record<string, ParcelDoc[]> = {};
    for (const bookingId of ids) {
      attachedMap[bookingId] = (attached.data ?? [])
        .map(mapParcelRow)
        .filter(
          (p) =>
            (p.deliveryType !== 'piggyback' || p.approvalStatus === 'accepted') &&
            (p.carrierBookingId === bookingId || p.piggybackBookingId === bookingId)
        );
    }
    setBaseByBookingId(baseMap);
    setAttachedByBookingId(attachedMap);
    setParcelsKey(cargoIdsKey);
  }, [cargoIdsKey]);

  useEffect(() => { void loadCompanions(); }, [loadCompanions]);
  useEffect(() => { void loadParcels(); }, [loadParcels]);

  // A scan (passenger_details) or parcel check (parcels) published elsewhere
  // flips the card without waiting for focus. Unfiltered — the preexisting
  // useBangkeroParcels subscription runs the same shape at the same volume.
  const refetchNow = useCallback(() => {
    void loadCompanions();
    void loadParcels();
  }, [loadCompanions, loadParcels]);
  useRealtimeQuery(refetchNow, [{ table: 'passenger_details' }, { table: 'parcels' }]);

  const resolvedByBookingId = useMemo(() => {
    const map: Record<string, boolean> = {};
    const companionsFresh = companionsKey === passengerIdsKey;
    const parcelsFresh = parcelsKey === cargoIdsKey;
    for (const m of members) {
      if (m.serviceType === 'cargo') {
        const byId = new Map<string, ParcelDoc>();
        const own = baseByBookingId[m.bookingId];
        if (own) byId.set(own.parcelId, own);
        for (const p of attachedByBookingId[m.bookingId] ?? []) {
          // Batched parcels share the master's carrier link, so the link
          // alone duplicates a member's parcel onto the master card —
          // same dedupe rule as booking-status's cargoParcelsFor.
          if (
            p.deliveryType === 'batched'
            && p.bookingId != null
            && p.bookingId !== m.bookingId
          ) continue;
          byId.set(p.parcelId, p);
        }
        const cargo = [...byId.values()];
        map[m.bookingId] = parcelsFresh
          && cargo.length > 0
          && cargo.every((p) => p.status === 'returned' || !!p.loadedAt);
        continue;
      }
      const roster = companionsFresh ? companions[m.bookingId] : undefined;
      map[m.bookingId] = !!roster
        && (!!m.onboardedAt || !!m.noShowAt || !!m.disputedAt)
        && roster.every((c) => c.boardedAt || c.noShowAt);
    }
    return map;
  }, [
    members, companionsKey, companions, baseByBookingId, attachedByBookingId,
    parcelsKey, passengerIdsKey, cargoIdsKey,
  ]);

  const loading =
    (passengerIdsKey.length > 0 && companionsKey !== passengerIdsKey) ||
    (cargoIdsKey.length > 0 && parcelsKey !== cargoIdsKey);

  const allResolved = members.length > 0 && members.every((m) => resolvedByBookingId[m.bookingId]);

  return { resolvedByBookingId, allResolved, loading };
}
