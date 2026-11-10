import { router, useLocalSearchParams } from 'expo-router';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BangkeroScreenHeader } from '@/components/BangkeroScreenHeader';
import { Icon } from '@/components/Icon';
import { sailsLabel, todayIso } from '@/components/SchedulePicker';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { LoadingState, ErrorState, EmptyState } from '@/components/States';
import { StatusPill } from '@/components/StatusPill';
import { useAuth } from '@/hooks/useAuth';
import { useAcceptedBookings, useBangkero, useBooking, usePorts } from '@/hooks/useSupabase';
import {
  acceptBooking, rejectBooking, friendlyError, resolveGroupNoShow, setOnboarded,
  setPassengerBoarded, verifyBoardingQr,
} from '@/services/booking.service';
import { getIslandPackage } from '@/services/island-package.service';
import { createNotification, scheduleLocalNotification } from '@/services/notification.service';
import {
  getParcelByBooking, mapRow as mapParcelRow, markParcelNoShow, setParcelLoaded,
} from '@/services/parcel.service';
import { getPassengerDetailsByBooking } from '@/services/passenger-detail.service';
import { supabase } from '@/services/supabase';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import type { BookingDoc, IslandPackageDoc, ParcelDoc, PassengerDetailDoc } from '@/types/models';
import { formatPhone } from '@/utils/phone';
import { safeBack } from '@/utils/navigation';
import { groupAcceptedBookings } from '@/utils/trip-groups';

export default function BookingStatus() {
  const params = useLocalSearchParams<{ bookingId?: string | string[] }>();
  // Expo Router can hand back an array for a repeated param; take the first
  // string so `.eq()` / `.or()` interpolation is always a clean id.
  const rawId = params.bookingId;
  const bookingId = (Array.isArray(rawId) ? rawId[0] : rawId) ?? '';
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const { data: booking, loading, error } = useBooking(bookingId ?? null);
  const accepted = useAcceptedBookings(uid);
  const bangkero = useBangkero(uid);
  const ports = usePorts();
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // 071: accepted bookings share a group id. Home opens the group with its
  // oldest member, so the status screen must expand back to every accepted
  // booking on the same boat/route/sailing slot.
  const members = useMemo(() => {
    if (!booking) return [];
    if (!booking.groupBookingId) return [booking];
    const group = groupAcceptedBookings(accepted.data)
      .find((g) => g.groupBookingId === booking.groupBookingId);
    if (!group) return [booking];
    return group.bookings.some((b) => b.bookingId === booking.bookingId)
      ? group.bookings
      : [booking, ...group.bookings];
  }, [accepted.data, booking]);
  const passengerMembers = useMemo(
    () => members.filter((m) => m.serviceType !== 'cargo'),
    [members]
  );
  const cargoMembers = useMemo(
    () => members.filter((m) => m.serviceType === 'cargo'),
    [members]
  );
  const passengerIdsKey = passengerMembers.map((m) => m.bookingId).join(',');
  const cargoIdsKey = cargoMembers.map((m) => m.bookingId).join(',');
  const memberIdsKey = members.map((m) => m.bookingId).join(',');
  const groupLoaded =
    !booking?.groupBookingId ||
    accepted.data.some((m) => m.groupBookingId === booking.groupBookingId);

  // Island-hop bookings: show every stop so the crew knows the full run. The
  // package may sit on a different group member than the one opened.
  const packageId = members.find((m) => m.packageId)?.packageId
    ?? booking?.packageId
    ?? null;
  const [pkg, setPkg] = useState<IslandPackageDoc | null>(null);
  useEffect(() => {
    if (!packageId) return;
    let alive = true;
    getIslandPackage(packageId)
      .then((p) => { if (alive) setPkg(p); })
      .catch(() => {});
    return () => { alive = false; };
  }, [packageId]);

  /** B7: counter-report sent for the current dispute — latch the button. */
  const [counterSent, setCounterSent] = useState(false);
  /** Latched per passenger member so a second tap cannot re-run the RPC. */
  const [noShowDoneByBookingId, setNoShowDoneByBookingId] =
    useState<Record<string, boolean>>({});

  // Companions ride under their own booker. null means the read failed, so
  // the gate stays closed until the roster is actually known.
  const [companionsByBookingId, setCompanionsByBookingId] =
    useState<Record<string, PassengerDetailDoc[] | null>>({});
  useEffect(() => {
    const ids = passengerIdsKey ? passengerIdsKey.split(',') : [];
    if (ids.length === 0) return;
    let alive = true;
    Promise.all(
      ids.map(async (id) => {
        try {
          return [id, await getPassengerDetailsByBooking(id)] as const;
        } catch {
          return [id, null] as const;
        }
      })
    ).then((entries) => {
      if (alive) setCompanionsByBookingId(Object.fromEntries(entries));
    });
    return () => { alive = false; };
  }, [passengerIdsKey]);

  // Cargo (Option B): the sender's booking carries no receiver data — read
  // it off each cargo member's parcel.
  const [parcelByBookingId, setParcelByBookingId] =
    useState<Record<string, ParcelDoc | null>>({});
  useEffect(() => {
    const ids = cargoIdsKey ? cargoIdsKey.split(',') : [];
    if (ids.length === 0) return;
    let alive = true;
    Promise.all(
      ids.map(async (id) => {
        try {
          return [id, await getParcelByBooking(id)] as const;
        } catch {
          return [id, null] as const;
        }
      })
    ).then((entries) => {
      if (alive) setParcelByBookingId(Object.fromEntries(entries));
    });
    return () => { alive = false; };
  }, [cargoIdsKey]);

  // Riding-along parcels for every member: matched by carrier_booking_id
  // (045) or piggyback_booking_id (pre-045). A pre-045 schema has no carrier
  // column, so the combined query fails — fall back to the piggyback key.
  const [attachedParcelsByBookingId, setAttachedParcelsByBookingId] =
    useState<Record<string, ParcelDoc[]>>({});
  const [attachedParcelsReadyKey, setAttachedParcelsReadyKey] =
    useState<string | null>(null);
  const attachedParcelsReady =
    !!memberIdsKey && attachedParcelsReadyKey === memberIdsKey;
  useEffect(() => {
    const ids = memberIdsKey ? memberIdsKey.split(',') : [];
    if (ids.length === 0) return;
    let alive = true;
    (async () => {
      const combined = await supabase
        .from('parcels')
        .select('*')
        .or(ids.flatMap((id) => [
          `piggyback_booking_id.eq.${id}`,
          `carrier_booking_id.eq.${id}`,
        ]).join(','));
      let rows: ParcelDoc[] = [];
      let loaded = false;
      if (!combined.error) {
        rows = (combined.data ?? []).map(mapParcelRow);
        loaded = true;
      } else {
        if (__DEV__) {
          console.warn('[parcel] attached-parcel carrier query skipped:', combined.error.message);
        }
        const fallback = await supabase
          .from('parcels')
          .select('*')
          .or(ids.map((id) => `piggyback_booking_id.eq.${id}`).join(','));
        if (!fallback.error) {
          rows = (fallback.data ?? []).map(mapParcelRow);
          loaded = true;
        }
      }
      if (!alive) return;
      if (!loaded) throw new Error('attached parcels unavailable');
      const byBooking: Record<string, ParcelDoc[]> = {};
      for (const id of ids) {
        byBooking[id] = rows.filter(
          (p) =>
            (p.deliveryType !== 'piggyback' || p.approvalStatus === 'accepted') &&
            (p.carrierBookingId === id || p.piggybackBookingId === id)
        );
      }
      setAttachedParcelsByBookingId(byBooking);
      setAttachedParcelsReadyKey(memberIdsKey);
    })().catch(() => {
      if (alive) {
        setAttachedParcelsByBookingId({});
        setAttachedParcelsReadyKey(null);
      }
    });
    return () => { alive = false; };
  }, [memberIdsKey]);

  // Optimistic boarding state per member; the server value catches up through
  // realtime. The override only bridges the gap after a successful RPC.
  const [boardOverrides, setBoardOverrides] = useState<Record<string, boolean>>({});
  const boardedFor = (m: BookingDoc) =>
    boardOverrides[m.bookingId] ?? !!m.onboardedAt;
  const [boardPending, setBoardPending] = useState(false);

  // Per-parcel cargo checks + returned parcels. These bridge the gap until
  // the parcel realtime subscription refreshes the attached rows.
  const [loadedOverrides, setLoadedOverrides] = useState<Record<string, boolean>>({});
  const [parcelStatusOverrides, setParcelStatusOverrides] =
    useState<Record<string, ParcelDoc['status']>>({});
  const [parcelBusy, setParcelBusy] = useState<string | null>(null);

  // Advance/slot bookings (020): the accepted row sits until its sailing
  // time — Prepare Departure and no-show both stay locked until the slot
  // arrives. The slot is a Manila wall time (schedules are Asia/Manila);
  // parsing it in the device zone skews the lock by the UTC offset on
  // foreign phones. Manila has no DST, so +08:00 is exact. Unparseable →
  // stay locked.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);
  const scheduledAt =
    booking?.scheduledDate && booking?.scheduledTime
      ? (() => {
          const ms = new Date(
            `${booking.scheduledDate}T${booking.scheduledTime}:00+08:00`
          ).getTime();
          return Number.isFinite(ms) ? ms : NaN;
        })()
      : null;
  // Same-day trips carry scheduledDate = today with NO time (the picker
  // clears slots for today) — they must never lock. Only a FUTURE
  // sailing slot gates Prepare Departure (020); the old date!=null fallback
  // locked every same-day booking forever.
  const advanceTrip =
    !!booking?.scheduledDate && booking.scheduledDate > todayIso();
  const advanceLocked =
    advanceTrip && (scheduledAt === null || now < scheduledAt);

  const companionsFor = (m: BookingDoc) => companionsByBookingId[m.bookingId];
  const attachedParcelsFor = (m: BookingDoc) =>
    attachedParcelsByBookingId[m.bookingId] ?? [];
  const parcelFor = (m: BookingDoc) => parcelByBookingId[m.bookingId] ?? null;
  const carrierFor = (m: BookingDoc) => {
    const p = parcelFor(m);
    if (!p?.piggybackBookingId) return null;
    return members.find((x) => x.bookingId === p.piggybackBookingId) ?? null;
  };
  const parcelLoadedFor = (p: ParcelDoc) =>
    loadedOverrides[p.parcelId] ?? !!p.loadedAt;
  const parcelStatusFor = (p: ParcelDoc) =>
    parcelStatusOverrides[p.parcelId] ?? p.status;
  const cargoParcelsFor = (m: BookingDoc) => {
    const byId = new Map<string, ParcelDoc>();
    const base = parcelFor(m);
    if (base) byId.set(base.parcelId, base);
    for (const p of attachedParcelsFor(m)) {
      // Batched parcels share carrier_booking_id with the whole batch's
      // master, so the carrier link alone duplicates a member's parcel onto
      // every master card. A batched parcel renders only under the member
      // whose booking_id matches it directly; piggyback and accompanied
      // links keep their old behavior, and a null booking_id (legacy row)
      // still falls back to the carrier link.
      if (
        p.deliveryType === 'batched'
        && p.bookingId != null
        && p.bookingId !== m.bookingId
      ) continue;
      byId.set(p.parcelId, p);
    }
    return [...byId.values()];
  };
  const parcelCountFor = (m: BookingDoc) => cargoParcelsFor(m).length;

  // Booker resolved = confirmed aboard, OR reported NOT aboard (022 dispute),
  // OR marked absent while companions sailed (022 partial no-show). Cargo is
  // resolved parcel by parcel: each one is either loaded or explicitly
  // returned, so nothing silently sails or strands.
  const memberResolved = (m: BookingDoc) => {
    if (m.serviceType === 'cargo') {
      const cargo = cargoParcelsFor(m);
      return attachedParcelsReady
        && cargo.length > 0
        && cargo.every(
          (p) => parcelStatusFor(p) === 'returned' || parcelLoadedFor(p)
        );
    }
    const companions = companionsFor(m);
    return !!companions
      && (boardedFor(m) || !!m.disputedAt || !!m.noShowAt)
      && companions.every((c) => c.boardedAt || c.noShowAt);
  };
  const canStart =
    groupLoaded && members.length > 0 && members.every(memberResolved)
    && !advanceLocked && !parcelBusy;
  const contactPassenger =
    passengerMembers.find((m) => !memberResolved(m) && !!m.passengerPhone)
    ?? passengerMembers.find((m) => !!m.passengerPhone)
    ?? null;
  const disputedMember =
    passengerMembers.find((m) => !!m.disputedAt)
    ?? (booking?.disputedAt ? booking : null);
  const groupUnavailable =
    booking?.status === 'accepted'
    && !!booking.groupBookingId
    && !accepted.loading
    && !groupLoaded;

  // QR scanner: one scan at a time — `scanLatch` releases ONLY when the
  // scanner reopens, never after a success: the fade-out Modal keeps the
  // camera mounted, so a second QR in frame would otherwise double-fire
  // the RPC in the gap.
  const [scanOpen, setScanOpen] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanMessage, setScanMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const scanLatch = useRef(false);
  // Frame rect in the camera view's coordinate space, from onLayout on the
  // green square — only QRs whose centre falls inside it count.
  // ponytail: portrait demo only — a rotation would need a re-measure
  const frameRect = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  // ponytail: scanned payloads are remembered per booking-screen visit —
  // one QR = one check-in, ever; revisiting the booking resets the page.
  const scannedRef = useRef<Set<string>>(new Set());
  const scanRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Free the camera after a cooldown so an error/duplicate doesn't wedge it. */
  function armScanRetry() {
    if (scanRetryRef.current) clearTimeout(scanRetryRef.current);
    scanRetryRef.current = setTimeout(() => {
      scanLatch.current = false;
      setScanBusy(false);
      scanRetryRef.current = null;
    }, 800);
  }

  useEffect(
    () => () => {
      if (scanRetryRef.current) clearTimeout(scanRetryRef.current);
    },
    []
  );

  /** Manual tick for one companion row (undo with a second tap).
   *  No-showed rows are terminal (022 partial no-show) — tapping them must
   *  not resurrect boardedAt over noShowAt. */
  async function toggleCompanion(member: BookingDoc, c: PassengerDetailDoc) {
    if (c.noShowAt) return;
    const next = !c.boardedAt;
    const prevIso = c.boardedAt;
    const updateRows = (rows: PassengerDetailDoc[] | null | undefined) =>
      (rows ?? []).map((x) =>
        x.passengerId === c.passengerId
          ? { ...x, boardedAt: next ? new Date().toISOString() : null }
          : x
      );
    setCompanionsByBookingId((prev) => ({
      ...prev,
      [member.bookingId]: updateRows(prev[member.bookingId]),
    }));
    try {
      await setPassengerBoarded(c.passengerId, next ? 'boarded' : 'pending');
    } catch (e) {
      setCompanionsByBookingId((prev) => ({
        ...prev,
        [member.bookingId]: (prev[member.bookingId] ?? []).map((x) =>
          x.passengerId === c.passengerId ? { ...x, boardedAt: prevIso } : x
        ),
      }));
      setActionError(friendlyError(e));
    }
  }

  async function handleScan(result: BarcodeScanningResult) {
    // Only the square counts. Bounds arrive in the camera view's coordinate
    // space — the same one onLayout reports for the frame. Some platforms
    // report an empty box; fail open so scanning keeps working there.
    const b = result.bounds;
    if (frameRect.current && b && b.size.width > 0 && b.size.height > 0) {
      const cx = b.origin.x + b.size.width / 2;
      const cy = b.origin.y + b.size.height / 2;
      const f = frameRect.current;
      const m = 12;
      if (cx < f.x - m || cx > f.x + f.w + m || cy < f.y - m || cy > f.y + f.h + m) return;
    }
    if (scanLatch.current) return;
    scanLatch.current = true;
    setScanBusy(true);

    // Same QR again — say it ON the camera screen, fire nothing.
    if (scannedRef.current.has(result.data)) {
      setScanMessage({
        ok: false,
        text: 'QR code already scanned — that passenger is already checked in.',
      });
      armScanRetry();
      return;
    }

    // Companion payloads are 'PAX'+token; anything else must be one of the
    // passenger members' booking refs. Branch on the SHAPE — never assume the
    // opened booking is the one whose ticket was scanned. The RPC stamps the
    // correct row server-side; the local map just follows it.
    const isCompanionPayload = result.data.startsWith('PAX');
    const refMember = passengerMembers.find(
      (m) => m.ref.toUpperCase() === result.data.toUpperCase()
    );

    if (!isCompanionPayload && !refMember) {
      setScanMessage({ ok: false, text: 'That QR code does not belong to this trip.' });
      armScanRetry();
      return;
    }

    try {
      const name = await verifyBoardingQr(result.data);
      scannedRef.current.add(result.data);

      if (isCompanionPayload) {
        let hitMember: BookingDoc | null = null;
        let hitCompanion: PassengerDetailDoc | null = null;
        for (const m of passengerMembers) {
          const hit = (companionsByBookingId[m.bookingId] ?? [])
            .find((c) => `PAX${c.qrToken}` === result.data);
          if (hit) { hitMember = m; hitCompanion = hit; break; }
        }
        if (!hitCompanion) {
          // A list was stale — refetch each passenger's roster, then match.
          for (const m of passengerMembers) {
            try {
              const fresh = await getPassengerDetailsByBooking(m.bookingId);
              setCompanionsByBookingId((prev) => ({
                ...prev,
                [m.bookingId]: fresh,
              }));
              const hit = fresh.find((c) => `PAX${c.qrToken}` === result.data);
              if (hit) { hitMember = m; hitCompanion = hit; break; }
            } catch {
              // try the next passenger member
            }
          }
        }
        if (!hitMember || !hitCompanion) {
          setScanMessage({ ok: false, text: 'That QR code is not on this trip.' });
          armScanRetry();
          return;
        }
        const memberBookingId = hitMember.bookingId;
        const passengerId = hitCompanion.passengerId;
        setCompanionsByBookingId((prev) => ({
          ...prev,
          [memberBookingId]: (prev[memberBookingId] ?? []).map((x) =>
            x.passengerId === passengerId
              ? { ...x, boardedAt: new Date().toISOString() }
              : x
          ),
        }));
      } else if (refMember) {
        // The booker's ticket — the RPC stamped that member's onboarded_at.
        setBoardOverrides((prev) => ({ ...prev, [refMember.bookingId]: true }));
      }
      setScanMessage({ ok: true, text: `${name} checked in` });
      setScanOpen(false);
      // Latch STAYS engaged — openScanner() is the only release point.
    } catch (e) {
      setScanMessage({ ok: false, text: friendlyError(e) });
      armScanRetry();
    }
  }

  async function openScanner() {
    if (scanRetryRef.current) {
      clearTimeout(scanRetryRef.current);
      scanRetryRef.current = null;
    }
    setScanMessage(null);
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) {
        setScanMessage({ ok: false, text: 'Camera access is needed to scan boarding passes.' });
        return;
      }
    }
    scanLatch.current = false;
    setScanBusy(false);
    setScanOpen(true);
  }

  async function handleAccept() {
    if (!uid || !booking) return;
    setPending(true);
    setActionError(null);
    try {
      await acceptBooking(booking.bookingId, {
        uid,
        displayName: bangkero.data?.displayName ?? '',
      });
      // Confirmation both ways: the passenger learns the trip is set (with
      // its sail slot), and the bangkero's pocket ping says what they took.
      const sails = sailsLabel(booking.scheduledDate, booking.scheduledTime);
      const advance = !!booking.scheduledDate && booking.scheduledDate > todayIso();
      if (booking.userId) {
        createNotification(
          booking.userId,
          'Booking Accepted',
          `Your trip ${booking.ref} was accepted.${sails ? ` Sails ${sails}.` : ''}`
        ).catch(() => {});
      }
      scheduleLocalNotification(
        advance ? 'Advance trip confirmed' : 'Passengers are waiting',
        advance
          ? `Your boat sails ${sails} — ${booking.fromPortName} → ${booking.toPortName}.`
          : `Your passengers are waiting at ${booking.fromPortName}. Stay online to reach them.`
      ).catch(() => {});
    } catch (e) {
      setActionError(friendlyError(e));
    }
    setPending(false);
  }

  async function toggleParcelLoaded(member: BookingDoc, parcel: ParcelDoc) {
    if (parcelBusy || member.status !== 'accepted') return;
    const wasLoaded = parcelLoadedFor(parcel);
    const next = !wasLoaded;
    setParcelBusy(parcel.parcelId);
    setActionError(null);
    setLoadedOverrides((prev) => ({ ...prev, [parcel.parcelId]: next }));
    try {
      await setParcelLoaded(parcel.parcelId, next);
    } catch (e) {
      setLoadedOverrides((prev) => ({ ...prev, [parcel.parcelId]: wasLoaded }));
      setActionError(friendlyError(e));
    }
    setParcelBusy(null);
  }

  function confirmParcelNoShow(member: BookingDoc, parcel: ParcelDoc) {
    if (parcelBusy || member.status !== 'accepted') return;
    const isLast = cargoParcelsFor(member).every(
      (p) => p.parcelId === parcel.parcelId
        || parcelStatusFor(p) === 'returned'
    );
    Alert.alert(
      'Cargo not at port?',
      `${parcel.receiverName}'s parcel will be marked returned. This only changes the parcel - the passenger is not banned.${isLast ? ' This is the last live parcel, so the cargo trip will also be cancelled.' : ''}`,
      [
        { text: 'Go back', style: 'cancel' },
        {
          text: 'Mark returned',
          style: 'destructive',
          onPress: () => void doParcelNoShow(member, parcel),
        },
      ]
    );
  }

  async function doParcelNoShow(member: BookingDoc, parcel: ParcelDoc) {
    if (parcelBusy) return;
    const previous = parcelStatusFor(parcel);
    setParcelBusy(parcel.parcelId);
    setActionError(null);
    setParcelStatusOverrides((prev) => ({
      ...prev,
      [parcel.parcelId]: 'returned',
    }));
    try {
      const cancelled = await markParcelNoShow(parcel.parcelId);
      if (cancelled) {
        Alert.alert(
          'Cargo trip cancelled',
          `Every parcel on ${member.ref} was marked not at port. The batch is closed and its route key is released.`
        );
      }
    } catch (e) {
      setParcelStatusOverrides((prev) => ({
        ...prev,
        [parcel.parcelId]: previous,
      }));
      setActionError(friendlyError(e));
    }
    setParcelBusy(null);
  }

  async function toggleBoarded(member: BookingDoc, next: boolean) {
    setBoardPending(true);
    setActionError(null);
    try {
      await setOnboarded(member.bookingId, next);
      setBoardOverrides((prev) => ({ ...prev, [member.bookingId]: next }));
      if (next) {
        // Confirmation both ways: if the passenger is actually still on the
        // pier, this is their cue to shout before the boat leaves.
        const cargo = member.serviceType === 'cargo';
        createNotification(
          member.userId,
          cargo ? 'Cargo confirmed loaded' : 'You are confirmed on board',
          cargo
            ? `The crew confirmed the cargo on ${member.ref} is loaded.`
            : `The crew confirmed everyone on ${member.ref} is aboard. If you are NOT on board, open this booking and tap "I'm NOT on board" right away.`
        ).catch(() => {});
        scheduleLocalNotification(
          cargo ? 'Cargo confirmed loaded' : 'Passengers confirmed aboard',
          `The crew confirmed ${member.ref} is ready to sail.`
        ).catch(() => {});
      }
    } catch (e) {
      setActionError(friendlyError(e));
    }
    setBoardPending(false);
  }

  function confirmNoShow(member: BookingDoc) {
    if (noShowDoneByBookingId[member.bookingId]) return;
    Alert.alert(
      'Passenger(s) didn’t board',
      `The boat leaves with everyone who boarded on ${member.ref}. If nobody from this booking boarded, it is cancelled as a no-show and the booker is banned for a while — otherwise only the missing passengers are marked and the trip continues.`,
      [
        { text: 'Go back', style: 'cancel' },
        {
          text: 'Mark no-show',
          style: 'destructive',
          onPress: () => void handleNoShow(member),
        },
      ]
    );
  }

  async function handleNoShow(member: BookingDoc) {
    if (noShowDoneByBookingId[member.bookingId]) return;
    setBoardPending(true);
    setActionError(null);
    try {
      await resolveGroupNoShow(member);
      setNoShowDoneByBookingId((prev) => ({ ...prev, [member.bookingId]: true }));
      const fresh = await getPassengerDetailsByBooking(member.bookingId).catch(() => null);
      if (fresh) {
        setCompanionsByBookingId((prev) => ({
          ...prev,
          [member.bookingId]: fresh,
        }));
      }
    } catch (e) {
      setActionError(friendlyError(e));
    }
    setBoardPending(false);
  }

  /**
   * B7 counter-report: the passenger filed a not-aboard dispute — the
   * bangkero gets one fixed-response line to their record.
   */
  function confirmCounterReport() {
    if (!disputedMember?.userId) return;
    Alert.alert(
      'Counter-report',
      `Tell ${disputedMember.passengerName ?? 'the passenger'} you dispute their report? They are notified that the boat waited and their party was called to board.`,
      [
        { text: 'Go back', style: 'cancel' },
        {
          text: 'Send counter-report',
          onPress: () => {
            createNotification(
              disputedMember.userId,
              'Bangkero counters your report',
              `The captain disputes your not-aboard report on ${disputedMember.ref}: the boat waited at ${disputedMember.fromPortName} and your party was called to board. Coastguard will review both statements.`
            )
              .then(() => setCounterSent(true))
              .catch(() => setActionError('Could not send the counter-report — try again.'));
          },
        },
      ]
    );
  }

  async function handleDecline() {
    if (!uid || !booking) return;
    setPending(true);
    setActionError(null);
    try {
      await rejectBooking(booking.bookingId);
      safeBack('/(bangkero)/home');
    } catch (e) {
      setActionError(friendlyError(e));
    }
    setPending(false);
  }

  async function handleStartTrip() {
    if (!canStart) return;
    router.push('/(bangkero)/departure');
  }

  function handleContactPassenger() {
    const phone = contactPassenger?.passengerPhone;
    if (!phone) return;
    const dialable = phone.replace(/[^+\d]/g, '');
    if (!dialable) return;
    Linking.openURL(`tel:${dialable}`).catch(() =>
      setActionError(`Could not open the dialer — call ${phone} manually.`)
    );
  }

  function renderCargoReady(member: BookingDoc) {
    const parcels = cargoParcelsFor(member);
    if (parcels.length === 0) {
      return <Text style={styles.cardSub}>Loading cargo…</Text>;
    }
    return parcels.map((p) => {
      const status = parcelStatusFor(p);
      const loaded = parcelLoadedFor(p);
      const closed = status === 'returned' || status === 'delivered';
      const canCheck = member.status === 'accepted'
        && status === 'pending'
        && !parcelBusy;
      const statusLabel = status === 'returned'
        ? 'Returned — not at port'
        : status === 'delivered'
          ? 'Delivered'
          : loaded
            ? 'Loaded'
            : 'Not loaded yet';
      return (
        <View key={p.parcelId} style={styles.parcelRow}>
          <Pressable
            onPress={() => void toggleParcelLoaded(member, p)}
            disabled={!canCheck}
            style={({ pressed }) => [
              styles.boardRow,
              styles.parcelToggle,
              pressed && canCheck && styles.boardRowPressed,
            ]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: loaded && !closed, disabled: !canCheck }}
            accessibilityLabel={`${p.receiverName} loaded`}
          >
            <View style={[
              styles.checkbox,
              loaded && !closed && styles.checkboxOn,
              !canCheck && styles.checkboxDisabled,
            ]}>
              {loaded && !closed && (
                <Icon name="check" size={14} color={colors.primaryText} />
              )}
            </View>
            <View style={styles.boardText}>
              <Text style={styles.boardName} numberOfLines={1}>{p.receiverName}</Text>
              <Text style={styles.boardSub} numberOfLines={1}>
                {p.totalWeightKg != null ? `${p.totalWeightKg} kg · ` : ''}
                {p.deliveryType ?? 'accompanied'} · {statusLabel}
              </Text>
            </View>
          </Pressable>
          {member.status === 'accepted'
            && p.deliveryType !== 'accompanied'
            && status === 'pending'
            && !loaded && (
              <Pressable
                onPress={() => confirmParcelNoShow(member, p)}
                disabled={!!parcelBusy}
                style={({ pressed }) => [
                  styles.parcelNoShowBtn,
                  pressed && styles.boardRowPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Mark ${p.receiverName}'s parcel not at port`}
              >
                <Text style={styles.parcelNoShow}>Not at port</Text>
              </Pressable>
            )}
        </View>
      );
    });
  }

  function renderPassengerCard(member: BookingDoc) {
    const companions = companionsFor(member);
    const boarded = boardedFor(member);
    const resolved = memberResolved(member);
    const noShowDone = !!noShowDoneByBookingId[member.bookingId];
    return (
      <View key={member.bookingId} style={styles.card}>
        <Text style={styles.cardLabel}>PASSENGER INFO · {member.ref}</Text>
        <Text style={styles.cardValue} numberOfLines={1}>
          {member.passengerName ?? 'N/A'}
        </Text>
        <Text style={styles.cardSub}>
          {member.passengerPhone ? formatPhone(member.passengerPhone) : ''}
        </Text>
        <Text style={styles.cardSub} numberOfLines={1}>
          {member.numOfPassenger} pax · ₱{member.totalPrice}
        </Text>

        {member.status === 'accepted' && (
          <View style={styles.boardSection}>
            <Text style={styles.cardLabel}>PASSENGERS ON BOARD</Text>
            <Pressable
              onPress={() => void toggleBoarded(member, !boarded)}
              disabled={boardPending}
              style={({ pressed }) => [styles.boardRow, pressed && styles.boardRowPressed]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: boarded }}
              accessibilityLabel="Passengers on board"
            >
              <View style={[styles.checkbox, boarded && styles.checkboxOn]}>
                {boarded && <Icon name="check" size={14} color={colors.primaryText} />}
              </View>
              <View style={styles.boardText}>
                <Text style={styles.boardName} numberOfLines={1}>
                  {member.passengerName ?? 'Passengers'}
                </Text>
                <Text style={styles.boardSub}>
                  {member.noShowAt
                    ? 'Marked no-show — companions sailed'
                    : member.disputedAt
                      ? 'Reported NOT aboard — trip continues'
                      : `Booker · ${boarded ? 'confirmed aboard' : 'not confirmed yet'}`}
                </Text>
              </View>
            </Pressable>
            {(companions ?? []).map((c) => (
              <Pressable
                key={c.passengerId}
                onPress={() => void toggleCompanion(member, c)}
                disabled={!!c.noShowAt}
                style={({ pressed }) => [
                  styles.boardRow,
                  pressed && !c.noShowAt && styles.boardRowPressed,
                ]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: !!c.boardedAt, disabled: !!c.noShowAt }}
                accessibilityLabel={`${c.firstName} ${c.lastName} on board`}
              >
                <View style={[styles.checkbox, c.boardedAt && styles.checkboxOn]}>
                  {c.boardedAt && <Icon name="check" size={14} color={colors.primaryText} />}
                </View>
                <View style={styles.boardText}>
                  <Text style={styles.boardName} numberOfLines={1}>
                    {c.firstName} {c.lastName}
                    {c.passengerType !== 'regular' ? ` (${c.passengerType})` : ''}
                  </Text>
                  <Text style={styles.boardSub}>
                    {c.noShowAt
                      ? 'Marked no-show'
                      : c.boardedAt
                        ? 'Boarded'
                        : 'Not boarded yet'}
                  </Text>
                </View>
              </Pressable>
            ))}
            {companions === null && (
              <Text style={styles.cardSub}>
                Could not load this party&apos;s companions — reopen the screen to retry.
              </Text>
            )}
            {!advanceTrip && (
              <PrimaryButton
                label="Scan boarding QR"
                variant="secondary"
                onPress={() => void openScanner()}
                style={styles.scanBtn}
              />
            )}
            {!advanceLocked && companions != null && !resolved && (
              <PrimaryButton
                label={noShowDone ? 'No-show marked' : 'Passenger(s) didn’t board'}
                variant="danger"
                onPress={() => confirmNoShow(member)}
                loading={boardPending}
                disabled={noShowDone}
                style={styles.noShowBtn}
              />
            )}
          </View>
        )}
      </View>
    );
  }

  function renderCargoCard(member: BookingDoc) {
    const parcel = parcelFor(member);
    const parcelCount = parcelCountFor(member);
    return (
      <View key={member.bookingId} style={styles.card}>
        <Text style={styles.cardLabel}>RECEIVER / CARGO INFO · {member.ref}</Text>
        <Text style={styles.cardValue} numberOfLines={1}>
          {parcel?.receiverName ?? member.passengerName ?? 'N/A'}
        </Text>
        <Text style={styles.cardSub}>
          {parcel?.receiverContact ? formatPhone(parcel.receiverContact) : ''}
        </Text>
        <Text style={styles.cardSub} numberOfLines={1}>
          {parcelCount} parcel{parcelCount === 1 ? '' : 's'} · ₱{member.totalPrice}
        </Text>

        {parcel?.deliveryType === 'piggyback' && (
          <View style={styles.memberSection}>
            <Text style={styles.cardLabel}>RIDING ALONG</Text>
            <Text style={styles.cardSub} numberOfLines={1}>
              Riding along with {carrierFor(member)?.passengerName ?? 'the passenger trip'}
            </Text>
          </View>
        )}

        {member.status === 'accepted' && (
          <View style={styles.boardSection}>
            <Text style={styles.cardLabel}>CARGO READY · CHECK EACH PARCEL</Text>
            {renderCargoReady(member)}
            <Text style={styles.cardSub}>
              Every parcel must be loaded or marked “Not at port” before Prepare Departure unlocks.
            </Text>
          </View>
        )}
      </View>
    );
  }

  return (
    <ScreenContainer padded={false}>
      <BangkeroScreenHeader title="Booking Status" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {loading ? (
          <LoadingState label="Loading booking…" />
        ) : error ? (
          <ErrorState message={error} />
        ) : !booking ? (
          <EmptyState icon="📋" title="Not found" message="This booking could not be loaded." />
        ) : (
          <>
            <View style={styles.refCard}>
              <View style={styles.refTop}>
                <Text style={styles.refText}>{booking.ref}</Text>
                <StatusPill status={booking.status} />
              </View>
              <View style={styles.refRoute}>
                <Text style={styles.refPort} numberOfLines={1}>{booking.fromPortName}</Text>
                <Text style={styles.refArrow}>→</Text>
                <Text style={styles.refPort} numberOfLines={1}>{booking.toPortName}</Text>
              </View>
            </View>

            {!!pkg && pkg.stops.length > 1 && (
              <View style={styles.card}>
                <Text style={styles.cardLabel}>ITINERARY · {pkg.packageName.toUpperCase()}</Text>
                {pkg.stops.map((stopId, i) => (
                  <Text key={`${stopId}-${i}`} style={styles.itineraryStop} numberOfLines={1}>
                    {i + 1}. {ports.data.find((p) => p.portId === stopId)?.portName ?? stopId}
                  </Text>
                ))}
              </View>
            )}

            {booking.status === 'accepted' && !!disputedMember && (
              <View style={styles.banner}>
                <Text style={styles.bannerText}>
                  {disputedMember.passengerName ?? 'The passenger'} reports they were NOT on board. The trip continues — tick who actually sailed, then Prepare Departure.
                </Text>
              </View>
            )}

            {groupUnavailable && (
              <View style={styles.banner}>
                <Text style={styles.bannerText}>
                  Could not load every booking in this group. Prepare Departure stays locked until the whole group loads.
                </Text>
              </View>
            )}

            {passengerMembers.map(renderPassengerCard)}
            {cargoMembers.map(renderCargoCard)}

            {!!actionError && (
              <View style={styles.banner}>
                <Text style={styles.bannerText}>{actionError}</Text>
              </View>
            )}

            {!!scanMessage && (
              <View style={[styles.banner, scanMessage.ok && styles.bannerOk]}>
                <Text style={[styles.bannerText, scanMessage.ok && styles.bannerOkText]}>
                  {scanMessage.text}
                </Text>
              </View>
            )}

            <View style={styles.actions}>
              {booking.status === 'open' && (
                <>
                  <PrimaryButton
                    label="Decline"
                    variant="secondary"
                    onPress={handleDecline}
                    loading={pending}
                    style={styles.actionBtn}
                  />
                  <PrimaryButton
                    label="Accept"
                    onPress={handleAccept}
                    loading={pending}
                    style={styles.actionBtn}
                  />
                </>
              )}

              {booking.status === 'accepted' && (
                <>
                  {!!contactPassenger?.passengerPhone && (
                    <PrimaryButton
                      label="Contact Passenger"
                      variant="secondary"
                      onPress={handleContactPassenger}
                      style={styles.actionBtn}
                    />
                  )}
                  <PrimaryButton
                    label="Prepare Departure"
                    onPress={handleStartTrip}
                    loading={pending}
                    disabled={!canStart}
                    style={styles.actionBtn}
                  />
                </>
              )}

              {booking.status === 'completed' && (
                <PrimaryButton
                  label="View Summary"
                  onPress={() => router.push('/(bangkero)/trip-summary')}
                />
              )}
            </View>

            {/* B7 — the passenger filed a not-aboard dispute; one reply. */}
            {booking.status === 'accepted' && !!disputedMember && (
              <PrimaryButton
                label={counterSent ? 'Counter-report sent' : 'Counter-report passenger'}
                variant="danger"
                onPress={confirmCounterReport}
                disabled={counterSent}
                style={{ marginTop: spacing.md }}
              />
            )}

            {booking.status === 'accepted' && !canStart && (
              <Text style={styles.gateHint}>
                {advanceLocked
                  ? `Scheduled sail: ${booking.scheduledDate} ${booking.scheduledTime} — Prepare Departure opens when the slot arrives.`
                  : !groupLoaded
                    ? groupUnavailable
                      ? 'Could not load the rest of this group — Prepare Departure stays locked.'
                      : 'Loading the other bookings in this group…'
                    : cargoMembers.some((m) => !memberResolved(m))
                      ? 'Load every parcel or mark it not at port to prepare departure.'
                      : 'Tick every passenger who is aboard to prepare departure.'}
              </Text>
            )}
          </>
        )}
      </ScrollView>

      {/* One scanner for the whole party — the bangkero reopens it per
          passenger so a frame burst can never double-fire the RPC. */}
      <Modal visible={scanOpen} animationType="fade" onRequestClose={() => setScanOpen(false)}>
        <View style={styles.scanWrap}>
          {permission?.granted ? (
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={scanBusy ? undefined : handleScan}
            />
          ) : (
            <LoadingState label="Requesting camera…" />
          )}
          <View style={styles.scanOverlay}>
            <View
              style={styles.scanFrame}
              onLayout={(e) => {
                const { x, y, width, height } = e.nativeEvent.layout;
                frameRect.current = { x, y, w: width, h: height };
              }}
            />
            <Text style={styles.scanHint}>
              Point at the passenger&apos;s boarding QR code
            </Text>
            {/* Feedback where the bangkero is actually looking — the outer
                banner sits behind this modal while the camera is open. */}
            {!!scanMessage && (
              <View
                style={[
                  styles.scanMsg,
                  scanMessage.ok ? styles.scanMsgOk : styles.scanMsgErr,
                ]}
              >
                <Text
                  style={
                    scanMessage.ok ? styles.scanMsgOkText : styles.scanMsgErrText
                  }
                >
                  {scanMessage.text}
                </Text>
              </View>
            )}
            <PrimaryButton
              label="Close"
              variant="secondary"
              onPress={() => setScanOpen(false)}
              style={styles.scanClose}
            />
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },

  eyebrow: { ...typography.label, marginBottom: 2 },
  title: { ...typography.h1, marginBottom: spacing.xl },

  refCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  refTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  refText: { flexShrink: 1, color: colors.textMuted, fontSize: 11, letterSpacing: 0.5 },
  refRoute: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  refPort: { flexShrink: 1, color: colors.text, fontSize: 15, fontWeight: '700' },
  refArrow: { color: colors.primary, fontSize: 15, fontWeight: '700' },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  cardLabel: { ...typography.label, marginBottom: spacing.sm },
  cardValue: { flexShrink: 1, color: colors.text, fontSize: 15, fontWeight: '700' },
  cardSub: { flexShrink: 1, ...typography.caption, color: colors.textMuted, marginTop: spacing.xs },
  itineraryStop: { flexShrink: 1, color: colors.text, fontSize: 14, fontWeight: '600', lineHeight: 22 },
  memberSection: {
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  boardSection: {
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },

  banner: {
    backgroundColor: colors.dangerTint,
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  bannerText: { flexShrink: 1, color: colors.danger, fontSize: 13, lineHeight: 18 },
  bannerOk: { backgroundColor: colors.successTint, borderColor: colors.success },
  bannerOkText: { color: colors.success },

  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
  actionBtn: { flex: 1 },

  // ---------- boarding checkbox ----------
  boardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  boardRowPressed: { opacity: 0.7 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: radii.xs,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkboxDisabled: { opacity: 0.45 },
  boardText: { flex: 1, minWidth: 0 },
  boardName: { flexShrink: 1, color: colors.text, fontSize: 15, fontWeight: '700' },
  boardSub: { flexShrink: 1, ...typography.caption, color: colors.textMuted, marginTop: 2 },
  parcelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  parcelToggle: { flex: 1, minWidth: 0 },
  parcelNoShowBtn: { paddingVertical: spacing.sm, paddingLeft: spacing.sm },
  parcelNoShow: { color: colors.danger, fontSize: 12, fontWeight: '700' },
  scanBtn: { marginTop: spacing.md },

  // ---------- QR scanner ----------
  scanWrap: { flex: 1, backgroundColor: '#000' },
  scanOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.lg,
  },
  scanFrame: {
    width: 220,
    height: 220,
    borderRadius: radii.md,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: 'transparent',
  },
  scanHint: { ...typography.caption, color: '#fff', textAlign: 'center' },
  scanMsg: {
    alignSelf: 'stretch',
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.75)',
  },
  scanMsgOk: { borderColor: colors.primary },
  scanMsgErr: { borderColor: colors.danger },
  scanMsgOkText: { color: '#fff', fontSize: 13, textAlign: 'center', fontWeight: '600' },
  scanMsgErrText: { color: '#ffd9d9', fontSize: 13, textAlign: 'center', fontWeight: '600' },
  scanClose: { marginTop: spacing.lg, alignSelf: 'stretch' },

  gateHint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  noShowBtn: { marginTop: spacing.sm },
});
