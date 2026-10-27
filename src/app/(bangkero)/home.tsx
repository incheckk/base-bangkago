import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { BangkeroScreenHeader } from '@/components/BangkeroScreenHeader';
import { BangkeroTripSheet } from '@/components/BangkeroTripSheet';
import { DemandBadge } from '@/components/DemandBadge';
import { EarningsCard } from '@/components/EarningsCard';
import { CoachOverlay, useCoachRects, useCoachTarget, type CoachStep } from '@/components/CoachMark';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { Icon } from '@/components/Icon';
import { sailsLabel, slotLabel, todayIso } from '@/components/SchedulePicker';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { WeatherCard } from '@/components/WeatherCard';
import { StatusPill } from '@/components/StatusPill';
import { useAuth } from '@/hooks/useAuth';
import { useOnboarding } from '@/hooks/useOnboarding';
import { useNotifications } from '@/hooks/useNotifications';
import { useBangkeroParcels } from '@/hooks/useBangkeroParcels';
import { usePiggybackRequests } from '@/hooks/usePiggybackRequests';
import { useRefetchOnFocus } from '@/hooks/useRealtimeQuery';
import {
  useAcceptedBookings, useBangkero, useDevFlags, useMyPortQueue, useMyTrips, useOpenRequests, usePorts,
} from '@/hooks/useSupabase';
import {
  acceptBooking, completeBooking, friendlyError, rejectBooking, setAvailability,
} from '@/services/booking.service';
import { getTodayPredictions } from '@/services/demand.service';
import { getIslandPackages } from '@/services/island-package.service';
import { createNotification, scheduleLocalNotification } from '@/services/notification.service';
import {
  DWELL_MS, endPortOf, formatDistance, getMyBangkaCapacity, getMyLastFix, haversineM, startPortOf,
} from '@/services/queue.service';
import { MIN_ACCEPT_RATING, getEffectiveRating } from '@/services/rating.service';
import { getPaymentsForBookings } from '@/services/payment.service';
import { supabase } from '@/services/supabase';
import { STRAIT_POINT } from '@/services/weather.service';
import { manilaDayStartMs, manilaTodayIso } from '@/utils/date';
import { colors, elevation, radii, spacing, touchTarget, typography } from '@/theme/tokens';
import type { BookingDoc, DemandPredictionDoc, ParcelDoc } from '@/types/models';
import { formatPhone } from '@/utils/phone';
import { alertPing } from '@/utils/feedback';
import { bookingTypeLabel } from '@/utils/booking-label';

/** 45000 → "0:45" — the hold and dwell countdowns. */
const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Future-dated trip → escrow + admin gate; today stays the fast same-day flow. */
const isAdvance = (b: BookingDoc) => !!b.scheduledDate && b.scheduledDate > todayIso();

// ponytail: fixed cutoffs (≥25 high, ≥12 med) — recalibrate once real rows accumulate.
const demandLevel = (pax: number): 'low' | 'medium' | 'high' =>
  pax >= 25 ? 'high' : pax >= 12 ? 'medium' : 'low';

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Oct 5" from a YYYY-MM-DD string, local day. */
function shortDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${MONTHS_SHORT[(m ?? 1) - 1]} ${d}`;
}

/** Category chip: padala/charter type, then package / advance slot / same-day. */
function categoryLabel(b: BookingDoc, pkgName?: string): string | null {
  return bookingTypeLabel(b, pkgName) || null;
}


/** Three taps on the controls a bangkero actually needs on day one. */
const BANGKERO_COACH: CoachStep[] = [
  {
    target: 'b.status',
    title: 'Go online to get work',
    body: 'Flip this switch to start receiving requests. While you are offline nothing reaches you, and it locks itself during an active trip so you cannot disappear mid-sail.',
  },
  {
    target: 'b.gates',
    title: 'What you need cleared',
    // These rows are a readout, not controls — the copy used to say "tap any
    // red one to fix it", which promised something GateRow cannot do. The
    // actual way out of a red Documents row is the button below this card.
    body: 'Documents, rating, boat and GPS. All four must pass before you can accept a trip. A red row blocks you, and the button to fix it appears below this card.',
  },
  {
    // Was the earnings row, which reads zero for a new bangkero — a final
    // step pointing at an empty figure teaches nothing. The profile button
    // is always there and is where the rest of the app lives, since this
    // role has no side menu.
    target: 'b.profile',
    title: 'Everything else is here',
    body: 'Your trips, earnings, boat documents, ratings and the SOS alert all live in your profile. That is the whole app — tap Got it and go online.',
  },
];

export default function BangkeroHome() {
  const { user, profile } = useAuth();
  const tour = useOnboarding(user?.id ?? null);
  const coachRects = useCoachRects();
  const tStatus = useCoachTarget('b.status');
  const tGates = useCoachTarget('b.gates');
  const tProfile = useCoachTarget('b.profile');
  const uid = user?.id ?? null;

  const notifications = useNotifications(uid);
  const piggybackRequests = usePiggybackRequests(uid);
  const bangkero = useBangkero(uid);
  const requests = useOpenRequests(uid);
  /** Ping for a request that just arrived — the first load is the baseline. */
  const seenRequests = useRef<Set<string>>(new Set());
  useEffect(() => {
    const ids = requests.data.map((r) => r.bookingId);
    const baseline = seenRequests.current.size === 0;
    const fresh = ids.filter((id) => !seenRequests.current.has(id));
    ids.forEach((id) => seenRequests.current.add(id));
    if (!baseline && fresh.length > 0) alertPing();
  }, [requests.data]);
  // Island-package catalogue (static) — just the names behind the chips.
  const [pkgNames, setPkgNames] = useState<Record<string, string>>({});
  useEffect(() => {
    getIslandPackages()
      .then((rows) => setPkgNames(Object.fromEntries(rows.map((r) => [r.packageId, r.packageName]))))
      .catch(() => {});
  }, []);
  // Today's model predictions behind the demand badges.
  const [todayDemand, setTodayDemand] = useState<DemandPredictionDoc[]>([]);
  useEffect(() => {
    let alive = true;
    getTodayPredictions()
      .then((rows) => { if (alive) setTodayDemand(rows); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  const topDemand = todayDemand
    .filter((r): r is DemandPredictionDoc & { routeId: string; predictedPassengers: number } =>
      r.routeId != null && r.predictedPassengers != null)
    .sort((a, b) => b.predictedPassengers - a.predictedPassengers)
    .slice(0, 3);
  const trips = useMyTrips(uid);
  // The working set (accepted only, no 10-row cap) drives active trips and
  // the offline gate; `trips` stays for earnings history.
  const accepted = useAcceptedBookings(uid);
  // Option B (045): the parcel rows tell us which cargo bookings are
  // non-accompanied stubs — the pre-045 fallback for the filter below.
  const parcels = useBangkeroParcels(uid);

  const [pending, setPending] = useState<string | null>(null);
  /**
   * Bookings already acted on in this session. Realtime removes the row a
   * moment after the write lands, and in that gap `pending` has already been
   * cleared — leaving Accept / Decline / Mark completed live on a booking that
   * is no longer actionable. This keeps them disabled until the row leaves.
   */
  const [acted, setActed] = useState<Set<string>>(new Set());
  const markActed = (id: string) => setActed((prev) => new Set(prev).add(id));
  const [actionError, setActionError] = useState<string | null>(null);
  /** Booking shown in the accept sheet (null = boat-load view, no focus). */
  const [sheetBooking, setSheetBooking] = useState<BookingDoc | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [notifying, setNotifying] = useState(false);

  /**
   * Availability flips locally the instant the switch moves; the server value
   * catches up through realtime. The override is dropped as soon as the two
   * agree (or the write fails, which reverts the switch immediately).
   */
  const [availOverride, setAvailOverride] = useState<boolean | null>(null);
  const serverAvailable = bangkero.data?.isAvailable ?? false;
  const available = availOverride ?? serverAvailable;

  useEffect(() => {
    if (availOverride !== null && availOverride === serverAvailable) setAvailOverride(null);
  }, [availOverride, serverAvailable]);

  /** Booking id → its parcel, so the Active Trips filter can read delivery_type. */
  const parcelsByBookingId = useMemo(() => {
    const map = new Map<string, ParcelDoc>();
    for (const p of parcels.data) {
      if (p.bookingId) map.set(p.bookingId, p);
    }
    return map;
  }, [parcels.data]);

  /** Passenger ride id → the piggyback parcels riding along. */
  const piggybackByRideId = useMemo(() => {
    const map = new Map<string, ParcelDoc[]>();
    for (const p of parcels.data) {
      if (p.piggybackBookingId) {
        const list = map.get(p.piggybackBookingId);
        if (list) list.push(p);
        else map.set(p.piggybackBookingId, [p]);
      }
    }
    return map;
  }, [parcels.data]);

  /**
   * Batched stubs (053): cargo_mode='batched' + is_dispatchable=false.
   * Read straight off `bookings` — RLS hides a pending_batch parcel from
   * the bangkero, so the parcel row can never be used for this decision.
   */
  const [batchedStubIds, setBatchedStubIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    const cargoIds = requests.data
      .filter((b) => b.serviceType === 'cargo')
      .map((b) => b.bookingId);
    if (cargoIds.length === 0) return;
    let alive = true;
    supabase
      .from('bookings')
      .select('id, is_dispatchable, cargo_mode')
      .in('id', cargoIds)
      .eq('cargo_mode', 'batched')
      .eq('is_dispatchable', false)
      .then(({ data, error }) => {
        if (!alive || error) return;
        setBatchedStubIds(new Set((data ?? []).map((r) => r.id as string)));
      });
    return () => {
      alive = false;
    };
  }, [requests.data]);

  /**
   * Active Trips: only an unassigned batched parcel still waiting for its
   * batching window is a stub. Accompanied / piggyback / solo cargo and
   * anything this bangkero already owns are real trips — never hide them.
   */
  const isCargoStub = useCallback(
    (b: BookingDoc) => {
      // 1. If the bangkero owns it, it's a real trip. Never hide it.
      if (b.operatorId === uid) return false;

      // 2. Check if the booking has a linked parcel.
      const linkedParcel = parcelsByBookingId.get(b.bookingId);

      if (linkedParcel) {
        // 3. ONLY hide if it's a batched parcel waiting for the batching
        //    window to close.
        if (
          linkedParcel.deliveryType === 'batched' &&
          linkedParcel.batchingStatus === 'pending_batch'
        ) {
          return true;
        }
      }

      // 4. Otherwise it's not a stub (piggyback, solo, accompanied, ...).
      return false;
    },
    [uid, parcelsByBookingId],
  );

  const activeTrips = useMemo(
    () => accepted.data.filter((b) => !isCargoStub(b)),
    [accepted.data, isCargoStub],
  );
  const hasActiveTrip = activeTrips.length > 0;
  /** The trip currently at sea — departed, not yet arrived. A completed
   *  trip keeps its depart stamp forever, so arrival must be checked too or
   *  the home screen claims "SAILING NOW" on every past trip. */
  const sailingTrip = activeTrips.find((b) => !!b.departTime && !b.arrivalTime) ?? null;

  // Port-queue presence + the clocks the chips tick against. `now`
  // advances every second; the boat's own fix is re-read every 15s so
  // the distance badge tracks the boat as it moves.
  const ports = usePorts();
  /** `mactan__pandanon` → "Mactan → Pandanon" for the demand list. */
  const demandRouteName = (routeId: string) => {
    const [from, to] = routeId.split('__');
    const nameOf = (id?: string) => ports.data.find((p) => p.portId === id)?.portName ?? id ?? '';
    return `${nameOf(from)} → ${nameOf(to)}`;
  };
  const myQueue = useMyPortQueue(uid);
  // Admin demo switches: 009 lifts the queue/dwell/route/capacity
  // rules; 010 lifts the verification + rating gates. Independent.
  const devFlags = useDevFlags();
  const bypass = devFlags.data.dispatchBypass;
  const gatesBypass = devFlags.data.gatesBypass;
  const [now, setNow] = useState(() => Date.now());
  const [myFix, setMyFix] = useState<{ latitude: number; longitude: number } | null>(null);
  const lastFixFetchRef = useRef(0);
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
      if (uid && Date.now() - lastFixFetchRef.current > 15_000) {
        lastFixFetchRef.current = Date.now();
        getMyLastFix(uid)
          .then((f) => setMyFix(f ? { latitude: f.latitude, longitude: f.longitude } : null))
          .catch(() => {});
      }
    }, 1000);
    return () => clearInterval(id);
  }, [uid]);

  // Client-side fit-check chip: this boat's capacity vs. everything
  // already accepted (mirrors fits_booking in 008). `boatChecked`
  // separates "no boat yet" from "not fetched yet" so the gate row and
  // the switch don't flash red while the lookup is in flight.
  const [myCapacity, setMyCapacity] = useState<number | null>(null);
  const [boatChecked, setBoatChecked] = useState(false);
  useEffect(() => {
    if (!uid) return;
    getMyBangkaCapacity(uid)
      .then(setMyCapacity)
      .catch(() => {})
      .finally(() => setBoatChecked(true));
  }, [uid]);
  const acceptedLoad = activeTrips.reduce((sum, t) => sum + t.numOfPassenger, 0);
  // Destinations of trips already accepted — the route lock (008).
  const activeDests = [...new Set(activeTrips.map((t) => endPortOf(t.routeId)))];

  // Effective rating = smoothed passenger average − penalties + recovery
  // stars (rule v2, 036); the accept gate enforces the same floor
  // server-side. Re-read on focus so a fresh penalty or a regained
  // star never lingers on screen after navigating back.
  const [effectiveRating, setEffectiveRating] = useState<number | null>(null);
  const loadRating = useCallback(() => {
    if (!uid) return;
    getEffectiveRating(uid)
      .then(setEffectiveRating)
      .catch(() => {});
  }, [uid]);
  useEffect(() => { loadRating(); }, [loadRating]);
  useRefetchOnFocus(loadRating);
  const ratingBlocked =
    !gatesBypass && effectiveRating !== null && effectiveRating <= MIN_ACCEPT_RATING;

  // The bangkero gates (010): verified documents + a registered boat to
  // go online; documents + rating to receive or accept offers. All
  // lifted while the admin gates-bypass switch is ON.
  const verified = bangkero.data?.verificationStat === 'verified';
  const docsBlocked =
    !gatesBypass && !bangkero.loading && !!bangkero.data && !verified;
  const boatBlocked = !gatesBypass && boatChecked && myCapacity === null;
  const gatesLocked = docsBlocked || boatBlocked;

  /**
   * One request card's dispatch state — a client mirror of the gates
   * accept_booking_hold enforces (008). The server is authoritative;
   * this only decides what the chip says and whether Accept is armed.
   */
  function chipFor(b: BookingDoc): {
    text: string; tone: 'live' | 'wait' | 'block'; canAccept: boolean; distance: string | null;
  } {
    const depPort = startPortOf(b.routeId);
    const destPort = endPortOf(b.routeId);
    const dep = ports.data.find((p) => p.portId === depPort);
    const distance =
      myFix && dep?.latitude != null && dep.longitude != null
        ? formatDistance(haversineM(myFix.latitude, myFix.longitude, dep.latitude, dep.longitude))
        : null;

    // ponytail: advance trips are accepted free — no queue, dwell, route
    // lock or offer hold (accept_booking_hold skips them too via v_advance).
    // The gates below (online, docs, rating, capacity) still apply.
    const advance = isAdvance(b);

    // A boat at sea cannot take another same-day booking (the trip must
    // close first). Advance bookings are a different day — still allowed.
    if (!advance && sailingTrip) {
      return {
        text: 'You are sailing — finish this trip first',
        tone: 'block', canAccept: false, distance,
      };
    }

    // Route lock: one destination at a time (and a mixed legacy set
    // locks the boat out entirely until those trips clear).
    if (
      !advance &&
      !bypass &&
      (activeDests.length > 1 || (activeDests.length === 1 && activeDests[0] !== destPort))
    ) {
      return {
        text: 'Locked to your current destination — finish those trips first',
        tone: 'block', canAccept: false, distance,
      };
    }

    const entry = myQueue.data.entry;
    if (!advance && !bypass && entry?.portId !== depPort) {
      return {
        text: `Not queued at ${b.fromPortName ?? 'this port'}`,
        tone: 'block', canAccept: false, distance,
      };
    }
    if (!advance && !bypass && entry) {
      const dwellLeft = DWELL_MS - (now - new Date(entry.enteredAt).getTime());
      if (dwellLeft > 0) {
        return { text: `Entering queue… ${clock(dwellLeft)}`, tone: 'wait', canAccept: false, distance };
      }
    }
    if (!available) {
      return { text: 'Offline — turn on to accept', tone: 'block', canAccept: false, distance };
    }
    if (docsBlocked) {
      return {
        text: 'Documents not approved — finish verification to accept',
        tone: 'block', canAccept: false, distance,
      };
    }
    if (ratingBlocked) {
      return {
        text: 'Rating too low — must be above 1.0★',
        tone: 'block', canAccept: false, distance,
      };
    }
    if (
      !bypass &&
      b.serviceType !== 'rental' &&
      myCapacity !== null &&
      b.numOfPassenger + acceptedLoad > myCapacity
    ) {
      return {
        text: `Boat full — ${acceptedLoad + b.numOfPassenger}/${myCapacity} pax`,
        tone: 'block', canAccept: false, distance,
      };
    }

    if (advance) {
      return {
        text: `Advance · ${shortDate(b.scheduledDate as string)}${b.scheduledTime ? ` · ${slotLabel(b.scheduledTime)}` : ''}`,
        tone: 'live', canAccept: true, distance,
      };
    }

    const holdLeft = b.holdExpiresAt ? new Date(b.holdExpiresAt).getTime() - now : null;
    if (b.heldBy === uid) {
      if (holdLeft !== null && holdLeft > 0) {
        return { text: `Offered to you · ${clock(holdLeft)} left`, tone: 'live', canAccept: true, distance };
      }
      return { text: 'Offer expired — waiting for the next boat', tone: 'wait', canAccept: false, distance };
    }
    if (b.heldBy) {
      return { text: 'Offered to another boat', tone: 'wait', canAccept: false, distance };
    }
    // No holder: first tap on Accept runs the server cascade, which may
    // hand this very boat the offer — the button is genuinely live, so
    // the copy must not read as "wait for an offer".
    return { text: 'Open request — Accept to take it', tone: 'live', canAccept: true, distance };
  }

  /** The queue line under the availability switch. */
  const qEntry = myQueue.data.entry;
  const qPortName = qEntry
    ? ports.data.find((p) => p.portId === qEntry.portId)?.portName ?? 'the port'
    : null;
  const queueLabel = bypass
    ? 'DEMO: dispatch bypass active — port queue rules are lifted.'
    : !qEntry
      ? 'Not in any port queue — park inside a port perimeter to line up for requests.'
      : (() => {
          const dwellLeft = DWELL_MS - (now - new Date(qEntry.enteredAt).getTime());
          const rank = myQueue.data.rank ? `#${myQueue.data.rank}` : '';
          if (dwellLeft > 0) return `${rank} at ${qPortName} — joining the list in ${clock(dwellLeft)}`;
          return `${rank} of ${myQueue.data.total} at ${qPortName}${available ? '' : ' · listed but offline'}`;
        })();

  async function toggle(next: boolean) {
    if (!uid) return;
    // Blocked while a trip is accepted — the server-side guard repeats this.
    if (!next && hasActiveTrip) {
      setActionError('You have an active trip. You cannot go offline until it completes.');
      return;
    }
    setActionError(null);
    setAvailOverride(next);
    try {
      await setAvailability(uid, next);
    } catch (e) {
      setAvailOverride(null);
      setActionError(friendlyError(e));
    }
  }

  async function accept(b: BookingDoc) {
    if (!uid || !bangkero.data) return;
    setPending(b.bookingId);
    setActionError(null);
    try {
      await acceptBooking(b.bookingId, {
        uid,
        displayName: bangkero.data.displayName,
      });
      // Accepted work requires the operator reachable — force online in the
      // same flow so a stale switch can never leave passengers hanging.
      // A failed force-online must surface, not vanish: with an active trip
      // the switch is locked, so stay here showing the error.
      if (!available) {
        try {
          await setAvailability(uid, true);
        } catch (e) {
          setActionError(
            `Trip accepted, but going online failed: ${friendlyError(e)} Stay online from this screen — the passenger was notified.`
          );
          setPending(null);
          return;
        }
      }
      markActed(b.bookingId);
      // The phone may be face-down in a pocket — a local ping is the fastest
      // way to say "people are standing at the pier right now".
      const sails = sailsLabel(b.scheduledDate, b.scheduledTime);
      scheduleLocalNotification(
        isAdvance(b) ? 'Advance trip confirmed' : 'Passengers are waiting',
        isAdvance(b) && sails
          ? `Your boat sails ${sails} — ${b.fromPortName} → ${b.toPortName}.`
          : `Your passengers are waiting at ${b.fromPortName}. Stay online to reach them.`
      ).catch(() => {});
      createNotification(
        b.userId,
        'Booking Accepted',
        `Your trip ${b.ref} (${b.fromPortName} → ${b.toPortName}) was accepted by ${bangkero.data.displayName}.${sails ? ` Sails ${sails}.` : ''}`
      ).catch(() => {});
      // Stay on the list: the sheet shows this booking while the bangkero
      // keeps accepting more same-route bookings until the boat is full.
      setSheetBooking(b);
      setSheetOpen(true);
    } catch (e) {
      setActionError(
        friendlyError(e) === 'You do not have permission to do that.'
          ? 'Another bangkero already took that trip.'
          : friendlyError(e)
      );
    }
    setPending(null);
  }

  async function decline(b: BookingDoc) {
    setPending(b.bookingId);
    setActionError(null);
    try {
      // One RPC: append me + hand the offer to the next boat in line.
      await rejectBooking(b.bookingId);
      markActed(b.bookingId);
    } catch (e) {
      setActionError(friendlyError(e));
    }
    setPending(null);
  }

  async function complete(b: BookingDoc) {
    setPending(b.bookingId);
    setActionError(null);
    try {
      await completeBooking(b.bookingId);
      markActed(b.bookingId);
      createNotification(
        b.userId,
        'Trip Completed',
        `Your trip ${b.ref} has been completed. Safe travels!`
      ).catch(() => {});
    } catch (e) {
      setActionError(friendlyError(e));
    }
    setPending(null);
  }

  /** Accepted trips plus the just-accepted row (realtime can lag a second). */
  const sheetTrips = useMemo(() => {
    if (!sheetBooking) return activeTrips;
    return activeTrips.some((t) => t.bookingId === sheetBooking.bookingId)
      ? activeTrips
      : [...activeTrips, sheetBooking];
  }, [activeTrips, sheetBooking]);

  /** Bangkero → everyone boarding today: the boat is ready. */
  async function notifyPassengers() {
    setNotifying(true);
    setActionError(null);
    try {
      await Promise.all(
        activeTrips
          .filter((t) => !isAdvance(t))
          .map((t) =>
            createNotification(
              t.userId,
              'Boat is ready',
              `Your bangkero is at ${t.fromPortName} and ready to board trip ${t.ref}. Head to the pier now.`
            )
          )
      );
      alertPing();
    } catch (e) {
      setActionError(friendlyError(e));
    }
    setNotifying(false);
  }

  /** Sail gate: confirm whether the bangkero realises the boat is not full. */
  function askSail() {
    const dayTrips = activeTrips.filter((t) => !isAdvance(t));
    // Sail is gated on boarding — same rule the sheet's disabled button and
    // Departure's "Ready to Depart" enforce.
    if (dayTrips.some((t) => !t.onboardedAt)) {
      closeSheet();
      router.push('/(bangkero)/departure');
      return;
    }
    const load = dayTrips.reduce((sum, t) => sum + t.numOfPassenger, 0);
    const full = myCapacity !== null && load >= myCapacity;
    Alert.alert(
      full ? 'Ready to sail?' : 'Boat not full',
      full
        ? `Your boat is full (${load}/${myCapacity} pax). Start the trip now?`
        : `${load}/${myCapacity ?? '—'} seats taken. Do you still want to sail?`,
      [
        { text: 'Not yet', style: 'cancel' },
        {
          text: 'Sail',
          onPress: () => {
            setSheetBooking(null);
            setSheetOpen(false);
            router.push('/(bangkero)/departure');
          },
        },
      ]
    );
  }

  function openScan(b: BookingDoc) {
    setSheetBooking(null);
    setSheetOpen(false);
    router.push({
      pathname: '/(bangkero)/booking-status',
      params: { bookingId: b.bookingId },
    });
  }

  function closeSheet() {
    setSheetBooking(null);
    setSheetOpen(false);
  }

  /** Boarding lives on the departure checklist — the sheet only links to it. */
  function openDepartureChecklist() {
    closeSheet();
    router.push('/(bangkero)/departure');
  }

  // Earnings count only trips that actually completed AND got paid,
  // bucketed by Manila day of completion — TODAY and THIS WEEK are real
  // windows, not a guess. (Device-local midnights skewed both on foreign
  // phones; completed-but-unpaid trips used to inflate both cards.)
  // Unknown payment state (offline/RLS failure) falls back to unfiltered
  // rather than zeroing the cards.
  const completedTrips = useMemo(
    () => trips.data.filter((t) => t.status === 'completed' && t.completedAt),
    [trips.data]
  );
  const completedIds = useMemo(
    () => completedTrips.map((t) => t.bookingId),
    [completedTrips]
  );
  const [paidIds, setPaidIds] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (completedIds.length === 0) {
      setPaidIds(new Set());
      return;
    }
    let alive = true;
    getPaymentsForBookings(completedIds)
      .then((rows) => {
        if (!alive) return;
        setPaidIds(
          new Set(
            rows.filter((r) => r.paymentStatus === 'completed').map((r) => r.bookingId)
          )
        );
      })
      .catch(() => {
        if (alive) setPaidIds(null);
      });
    return () => {
      alive = false;
    };
  }, [completedIds]);
  const paidTrips = paidIds
    ? completedTrips.filter((t) => paidIds.has(t.bookingId))
    : completedTrips;
  const homeTodayIso = manilaTodayIso();
  const homeTodayStartMs = manilaDayStartMs(homeTodayIso);
  const homeWeekStartMs = homeTodayStartMs - 6 * 86400000;
  const completedMs = (t: BookingDoc) => new Date(t.completedAt as string).getTime();
  const todayEarnings = paidTrips
    .filter((t) => completedMs(t) >= homeTodayStartMs)
    .reduce((sum, t) => sum + t.totalPrice, 0);
  const weekEarnings = paidTrips
    .filter((t) => completedMs(t) >= homeWeekStartMs)
    .reduce((sum, t) => sum + t.totalPrice, 0);

  // Two groups so an operator can tell tomorrow's commitments from
  // people standing at the pier right now. Batched stubs stay visible
  // with a disabled Accept ("Waiting for batch"); piggyback stubs are
  // approved via the cube icon, so keep them off this list.
  const visibleRequests = requests.data.filter(
    (b) =>
      !(
        b.serviceType === 'cargo' &&
        b.cargoMode === 'piggyback' &&
        b.isDispatchable === false
      ),
  );
  const advanceReqs = visibleRequests.filter(isAdvance);
  const todayReqs = visibleRequests.filter((b) => !isAdvance(b));

  const renderRequest = (b: BookingDoc) => {
    const chip = chipFor(b);
    const category = categoryLabel(b, b.packageId ? pkgNames[b.packageId] : undefined);
    // 053: batched stub still waiting on its batch window — visible, but
    // not acceptable until the dispatcher marks it dispatchable.
    const isPendingBatch = batchedStubIds.has(b.bookingId);
    return (
      <View key={b.bookingId} style={styles.request}>
        <RequestBody booking={b} category={category} />
        {/* Dispatch state (008): whose offer it is, why Accept
            may be locked, and how far the boat still is. */}
        <View style={styles.chipRow}>
          <View
            style={[
              styles.holdChip,
              chip.tone === 'live' && styles.holdChipLive,
              chip.tone === 'block' && styles.holdChipBlock,
            ]}
          >
            <Text
              style={[
                styles.holdChipText,
                chip.tone === 'live' && styles.holdChipTextLive,
                chip.tone === 'block' && styles.holdChipTextBlock,
              ]}
              numberOfLines={2}
            >
              {chip.text}
            </Text>
          </View>
          {chip.distance && <Text style={styles.chipDistance}>{chip.distance}</Text>}
        </View>
        {/* Accept is the intended action and carries twice the width;
            giving a decline equal weight makes operators hesitate. */}
        <View style={styles.actions}>
          <PrimaryButton
            label="Decline"
            variant="secondary"
            onPress={() => decline(b)}
            disabled={pending === b.bookingId || acted.has(b.bookingId) || ratingBlocked || docsBlocked || !chip.canAccept}
            style={styles.declineBtn}
          />
          <PrimaryButton
            label={isPendingBatch ? 'Waiting for batch' : 'Accept'}
            onPress={() => accept(b)}
            loading={pending === b.bookingId}
            disabled={isPendingBatch || acted.has(b.bookingId) || ratingBlocked || docsBlocked || !chip.canAccept}
            style={styles.acceptBtn}
          />
        </View>
      </View>
    );
  };

  return (
    <ScreenContainer padded={false}>
      <BangkeroScreenHeader
        eyebrow="BANGKERO"
        title={profile ? `Kumusta, ${profile.firstName}` : 'Kumusta'}
        showBack={false}
        right={
          <View style={styles.headerRight}>
            <Pressable
              onPress={() => router.push('/(bangkero)/notifications')}
              accessibilityRole="button"
              accessibilityLabel={
                notifications.unreadCount > 0
                  ? `Notifications, ${notifications.unreadCount} unread`
                  : 'Notifications'
              }
              style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
            >
              <Icon name="bell" size={20} color={colors.text} />
              {notifications.unreadCount > 0 && (
                <View style={styles.notifBadge}>
                  <Text style={styles.notifBadgeText}>
                    {notifications.unreadCount > 9 ? '9+' : notifications.unreadCount}
                  </Text>
                </View>
              )}
            </Pressable>
            <Pressable
              onPress={() => router.push('/(bangkero)/piggyback-requests')}
              accessibilityRole="button"
              accessibilityLabel={
                piggybackRequests.data.length > 0
                  ? `Piggyback requests, ${piggybackRequests.data.length} pending`
                  : 'Piggyback requests'
              }
              style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
            >
              <Icon name="parcel" size={20} color={colors.text} />
              {piggybackRequests.data.length > 0 && (
                <View style={styles.notifBadge}>
                  <Text style={styles.notifBadgeText}>
                    {piggybackRequests.data.length > 9 ? '9+' : piggybackRequests.data.length}
                  </Text>
                </View>
              )}
            </Pressable>
            <View {...tProfile}>
              <Pressable
                onPress={() => router.replace('/(bangkero)/profile')}
                accessibilityRole="button"
                accessibilityLabel="Profile"
                style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
              >
                <Icon name="profile" size={20} color={colors.text} />
              </Pressable>
            </View>
          </View>
        }
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Availability is the control the whole screen depends on, so it reads
            as the primary object and changes colour with its state — you can
            tell across a room whether this operator is receiving work. */}
        <View style={[styles.statusCard, available && styles.statusCardOn]}>
          <View style={styles.statusTop}>
            <View style={[styles.statusDot, available ? styles.statusDotOn : styles.statusDotOff]} />
            <Text style={[styles.statusWord, available && styles.statusWordOn]}>
              {available ? 'ONLINE' : 'OFFLINE'}
            </Text>
            <View style={styles.statusSpacer} />
            {/* The coach mark rings the switch, not the card around it: the
                step says "flip this switch", so anything wider would point
                at the wrong thing. Switch has its own ref type, hence the
                wrapper. */}
            <View {...tStatus}>
              <Switch
                value={available}
                onValueChange={toggle}
                disabled={bangkero.loading || !bangkero.data || hasActiveTrip || gatesLocked}
                trackColor={{ false: colors.border, true: colors.primaryDark }}
                thumbColor={available ? colors.primary : colors.textMuted}
              />
            </View>
          </View>

          <Text style={styles.statusHint}>
            {hasActiveTrip
              ? 'You have an active trip — stay online until it is completed.'
              : docsBlocked
                ? 'Your documents must be verified by the admin before you can go online.'
                : boatBlocked
                  ? 'Register your boat (Profile → Edit Profile) before going online.'
                  : available
                    ? 'You are receiving booking requests.'
                    : 'Turn on to start receiving booking requests.'}
          </Text>

          {/* FCFS place in line (008) — the whole dispatch model in one row. */}
          <View style={styles.queueWrap}>
            <Text style={[styles.queueText, (qEntry || bypass) && styles.queueTextOn]} numberOfLines={2}>
              {myQueue.loading && !bypass ? 'Checking the port queue…' : queueLabel}
            </Text>
            {!myFix && !myQueue.loading && !bypass && (
              <Text style={styles.queueGps}>
                No GPS fix yet — keep location on so your boat can join a port queue.
              </Text>
            )}
          </View>

          <View style={styles.boatRow}>
            <Icon name="boat" size={18} color={colors.textSecondary} />
            <Text style={styles.boatName} numberOfLines={1}>
              {bangkero.data?.displayName ?? 'No boat name set'}
            </Text>
            {bangkero.data?.verificationStat === 'verified' ? (
              <View style={styles.verifiedPill}>
                <Icon name="check" size={12} color={colors.success} />
                <Text style={styles.verifiedText}>Verified</Text>
              </View>
            ) : (
              <View style={styles.pendingPill}>
                <Text style={styles.pendingText}>Pending</Text>
              </View>
            )}
          </View>

          {/* The four gates the server enforces (010): documents + boat
              decide whether the switch can move, documents + rating
              decide whether offers and Accept unlock. Rows always show
              the real state — bypass changes behaviour, not the truth. */}
          <View {...tGates} style={styles.gateWrap}>
            <Text style={styles.gateTitle}>READINESS</Text>
            <GateRow
              ok={gatesBypass || verified}
              label="Documents"
              detail={verified ? 'verified' : gatesBypass ? 'bypass' : 'not approved'}
            />
            <GateRow
              ok={gatesBypass || !ratingBlocked}
              label="Rating"
              detail={effectiveRating === null ? '…' : `${effectiveRating.toFixed(1)}★`}
            />
            <GateRow
              ok={gatesBypass || !boatBlocked}
              label="Boat"
              detail={!boatChecked ? '…' : myCapacity !== null ? `${myCapacity} pax` : 'missing'}
            />
            <GateRow ok={!!myFix} label="GPS" detail={myFix ? 'live fix' : 'no fix yet'} />
            {gatesBypass && (
              <Text style={styles.gateNote}>
                Demo mode: verification and rating gates are lifted.
              </Text>
            )}
          </View>
        </View>

        {/* The boat is at sea — the app stays browsable, but this is the way
            back to the live trip (same-day accepts are blocked meanwhile). */}
        {sailingTrip && (
          <Pressable
            onPress={() => router.push('/(bangkero)/en-route')}
            accessibilityRole="button"
            accessibilityLabel="Open the live sailing trip"
            style={({ pressed }) => [styles.tripBanner, pressed && styles.requestPressed]}
          >
            <View style={styles.tripBannerDot} />
            <View style={styles.tripBannerText}>
              <Text style={styles.tripBannerTitle}>ON TRIP · SAILING NOW</Text>
              <Text style={styles.tripBannerRoute} numberOfLines={1}>
                {sailingTrip.fromPortName} → {sailingTrip.toPortName}
              </Text>
            </View>
            <Text style={styles.tripBannerAction}>Open ›</Text>
          </Pressable>
        )}

        <View style={styles.weatherWrap}>
          <WeatherCard latitude={STRAIT_POINT.lat} longitude={STRAIT_POINT.lon} variant="bar" />
        </View>

        {!!actionError && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>{actionError}</Text>
          </View>
        )}

        {ratingBlocked && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>
              Your effective rating is {effectiveRating?.toFixed(1)}★ — 1.0 or below, so you
              cannot accept new bookings right now. It lifts automatically after 2 days,
              or sooner once passengers rate your trips back up.
            </Text>
          </View>
        )}

        {/* Document state banners — the practical face of the gates. */}
        {!gatesBypass && bangkero.data?.verificationStat === 'incomplete' && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>
              Upload your four documents to start sailing — you stay offline until the
              admin approves them.
            </Text>
            <PrimaryButton
              label="Upload documents"
              variant="secondary"
              onPress={() => router.push('/(bangkero)/verify-boat')}
              style={styles.bannerBtn}
            />
          </View>
        )}
        {!gatesBypass && bangkero.data?.verificationStat === 'pending' && (
          <View style={styles.bannerInfo}>
            <Text style={styles.bannerInfoText}>
              Your documents are under review. You can go online once the admin approves them.
            </Text>
          </View>
        )}
        {!gatesBypass && bangkero.data?.verificationStat === 'rejected' && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>
              The admin rejected your documents — upload them again to continue.
            </Text>
            <PrimaryButton
              label="Re-upload documents"
              variant="secondary"
              onPress={() => router.push('/(bangkero)/verify-boat')}
              style={styles.bannerBtn}
            />
          </View>
        )}

        {/* Work first: requests hold for only 3 minutes, so they sit
            directly under the status card — demand/earnings can wait. */}
        <View style={styles.sectionHead}>
          <Text style={styles.sectionLabelInline}>INCOMING REQUESTS</Text>
          {available && visibleRequests.length > 0 && (
            <View style={[styles.countPill, styles.countPillLive]}>
              <Text style={styles.countPillTextLive}>{visibleRequests.length}</Text>
            </View>
          )}
        </View>

        {!available ? (
          <View style={styles.offlineBox}>
            <View style={styles.offlineIconRing}>
              <Icon name="boat" size={24} color={colors.textMuted} />
            </View>
            <Text style={styles.offlineTitle}>You are offline</Text>
            <Text style={styles.offlineText}>
              Turn on availability above to start receiving booking requests.
            </Text>
          </View>
        ) : requests.loading ? (
          <View style={styles.stateBox}><LoadingState label="Listening for requests…" /></View>
        ) : requests.error ? (
          <View style={styles.stateBox}><ErrorState message={requests.error} /></View>
        ) : visibleRequests.length === 0 ? (
          <View style={styles.stateBox}>
            <EmptyState
              icon="bell"
              title="No requests right now"
              message="New bookings appear here the moment a passenger sends one."
            />
          </View>
        ) : (
          <>
            {advanceReqs.length > 0 && (
              <>
                <View style={styles.groupHead}>
                  <Text style={styles.groupLabel}>ADVANCE BOOKINGS</Text>
                  <View style={styles.countPill}>
                    <Text style={styles.countPillText}>{advanceReqs.length}</Text>
                  </View>
                </View>
                {advanceReqs.map(renderRequest)}
              </>
            )}
            {todayReqs.length > 0 && (
              <>
                <View style={styles.groupHead}>
                  <Text style={styles.groupLabel}>TODAY&apos;S BOOKINGS</Text>
                  <View style={styles.countPill}>
                    <Text style={styles.countPillText}>{todayReqs.length}</Text>
                  </View>
                </View>
                {todayReqs.map(renderRequest)}
              </>
            )}
          </>
        )}

        {activeTrips.length > 0 && (
          <>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionLabelInline}>ACTIVE TRIPS</Text>
              <View style={styles.sectionHeadRight}>
                <Pressable
                  onPress={() => {
                    setSheetBooking(null);
                    setSheetOpen(true);
                  }}
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel="Boat load, all accepted trips"
                >
                  <Text style={styles.sectionAction}>Boat load ›</Text>
                </Pressable>
                <View style={styles.countPill}>
                  <Text style={styles.countPillText}>{activeTrips.length}</Text>
                </View>
              </View>
            </View>
            {activeTrips.map((b) => (
              <Pressable
                key={b.bookingId}
                onPress={() => router.push({
                  pathname: '/(bangkero)/booking-status',
                  params: { bookingId: b.bookingId },
                })}
                style={({ pressed }) => [styles.request, styles.activeTrip, pressed && styles.requestPressed]}
              >
                <RequestBody
                  booking={b}
                  category={categoryLabel(b, b.packageId ? pkgNames[b.packageId] : undefined)}
                  ridingAlong={piggybackByRideId.get(b.bookingId) ?? []}
                />
                {/* Completing requires everyone aboard (complete_trip raises
                    otherwise) — until then the button routes to the boarding
                    card instead of pretending the trip can close. */}
                <PrimaryButton
                  label={
                    acted.has(b.bookingId)
                      ? 'Completed'
                      : b.onboardedAt
                        ? 'Mark completed'
                        : 'Open trip to confirm boarding'
                  }
                  onPress={() => {
                    if (acted.has(b.bookingId)) return;
                    if (b.onboardedAt) {
                      void complete(b);
                    } else {
                      router.push({
                        pathname: '/(bangkero)/booking-status',
                        params: { bookingId: b.bookingId },
                      });
                    }
                  }}
                  loading={pending === b.bookingId}
                  disabled={acted.has(b.bookingId)}
                  style={{ marginTop: spacing.md }}
                />
              </Pressable>
            ))}
          </>
        )}

        {topDemand.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>TODAY&apos;S PREDICTION</Text>
            {topDemand.map((row) => (
              <View key={row.routeId} style={styles.demandRow}>
                <Text style={styles.demandRoute} numberOfLines={1}>
                  {demandRouteName(row.routeId)}
                </Text>
                <DemandBadge
                  level={demandLevel(row.predictedPassengers)}
                  predictedPassengers={row.predictedPassengers}
                />
              </View>
            ))}
          </>
        )}

        <Text style={styles.sectionLabel}>EARNINGS</Text>
        <View style={styles.earningsRow}>
          <View style={styles.earningsItem}>
            <Icon name="cash" size={16} color={colors.primary} />
            <Text style={styles.earningsValue}>₱{todayEarnings}</Text>
            <Text style={styles.earningsLabel}>TODAY</Text>
          </View>
          <View style={styles.earningsItem}>
            <Icon name="receipt" size={16} color={colors.textSecondary} />
            <Text style={[styles.earningsValue, styles.earningsValueMuted]}>
              ₱{weekEarnings}
            </Text>
            <Text style={styles.earningsLabel}>THIS WEEK</Text>
          </View>
        </View>
      </ScrollView>

      <BangkeroTripSheet
        visible={sheetOpen}
        trips={sheetTrips}
        focusId={sheetBooking?.bookingId ?? null}
        capacity={myCapacity}
        notifying={notifying}
        onClose={closeSheet}
        onNotify={notifyPassengers}
        onScan={openScan}
        onOpenDeparture={openDepartureChecklist}
        onSail={askSail}
      />

      {/* First run only — see the passenger home for the keying rationale. */}
      <CoachOverlay
        visible={tour.show}
        steps={BANGKERO_COACH}
        rects={coachRects}
        onDone={tour.dismiss}
      />
    </ScreenContainer>
  );
}

/** One readiness row: icon + label + the concrete value behind it. */
function GateRow({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <View style={styles.gateRow}>
      <Icon name={ok ? 'check' : 'close'} size={14} color={ok ? colors.success : colors.danger} />
      <Text style={styles.gateLabel}>{label}</Text>
      <Text style={[styles.gateDetail, { color: ok ? colors.success : colors.danger }]}>
        {detail}
      </Text>
    </View>
  );
}

function RequestBody({
  booking,
  category,
  ridingAlong = [],
}: {
  booking: BookingDoc;
  category?: string | null;
  ridingAlong?: ParcelDoc[];
}) {
  // Passenger fare plus the cargo fares riding along on this trip. A cargo
  // booking never carries piggyback parcels, so this is a no-op for them.
  const cargoTotal = ridingAlong.reduce((sum, p) => sum + (p.totalPrice || 0), 0);
  const totalEarnings = booking.totalPrice + cargoTotal;
  const showCargoBreakdown = booking.serviceType !== 'cargo' && cargoTotal > 0;
  return (
    <>
      <View style={styles.requestTop}>
        <Text style={styles.requestRef}>{booking.ref}</Text>
        <StatusPill status={booking.status} />
      </View>

      {/* Which of the three desks this row came from — island package,
          advance slot, or a walk-up same-day ride. */}
      {!!category && (
        <View style={styles.catChip}>
          <Text style={styles.catChipText}>{category}</Text>
        </View>
      )}

      {/* Same origin/destination rail the passenger sees, so both sides of the
          demo describe a trip the same way. */}
      <View style={styles.routeRow}>
        <View style={styles.rail}>
          <View style={styles.railDot} />
          <View style={styles.railLine} />
          <View style={[styles.railDot, styles.railDotEnd]} />
        </View>
        <View style={styles.routeText}>
          <Text style={styles.routePort} numberOfLines={1}>{booking.fromPortName}</Text>
          <Text style={[styles.routePort, styles.routePortTo]} numberOfLines={1}>
            {booking.toPortName}
          </Text>
        </View>
        <View style={styles.fareWrap}>
          <Text style={styles.fare}>₱{totalEarnings}</Text>
          <Text style={styles.fareUnit}>{booking.numOfPassenger} pax</Text>
          {showCargoBreakdown && (
            <Text style={styles.fareUnit} numberOfLines={1}>
              ₱{booking.totalPrice} fare + ₱{cargoTotal} cargo
            </Text>
          )}
        </View>
      </View>

      <View style={styles.passengerRow}>
        <Icon name="profile" size={14} color={colors.textMuted} />
        <Text style={styles.passenger} numberOfLines={1}>
          {booking.passengerName}
          {booking.passengerPhone ? ` · ${formatPhone(booking.passengerPhone)}` : ''}
        </Text>
      </View>

      {/* Option B (045): piggyback parcels attached to this passenger ride. */}
      {ridingAlong.length > 0 && (
        <View style={styles.parcelBadge}>
          <Icon name="parcel" size={12} color={colors.primary} />
          <Text style={styles.parcelBadgeText}>
            {ridingAlong.length} parcel{ridingAlong.length > 1 ? 's' : ''} riding along
          </Text>
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({

  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.huge },

  // ---------- header ----------
  iconBtn: {
    width: touchTarget, height: touchTarget,
    alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill,
  },
  iconBtnPressed: { backgroundColor: colors.surface },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  notifBadge: {
    position: 'absolute', top: 1, right: 1,
    backgroundColor: colors.danger, borderRadius: radii.pill,
    minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: spacing.xs,
    borderWidth: 2, borderColor: colors.bg,
  },
  notifBadgeText: { flexShrink: 1, ...typography.micro, fontSize: 10 },

  // ---------- availability hero ----------
  statusCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg,
    ...elevation.e2,
  },
  statusCardOn: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
  tripBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    marginTop: spacing.md, padding: spacing.lg,
    borderRadius: radii.lg, borderWidth: 1, borderColor: colors.warning,
    backgroundColor: colors.surface,
  },
  tripBannerDot: { width: 10, height: 10, borderRadius: radii.pill, backgroundColor: colors.warning },
  tripBannerText: { flex: 1, minWidth: 0 },
  tripBannerTitle: { ...typography.label, color: colors.warning, fontSize: 11 },
  tripBannerRoute: { ...typography.bodyStrong, marginTop: 2 },
  tripBannerAction: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  weatherWrap: { marginTop: spacing.md },  statusTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statusDot: { width: 10, height: 10, borderRadius: radii.pill },
  statusDotOn: { backgroundColor: colors.primary },
  statusDotOff: { backgroundColor: colors.textMuted },
  statusWord: { flexShrink: 1, ...typography.label, color: colors.textMuted, fontSize: 13 },
  statusWordOn: { color: colors.primary },
  statusSpacer: { flex: 1 },
  statusHint: { flexShrink: 1, ...typography.caption, color: colors.textSecondary, marginTop: spacing.sm },

  // ---------- port-queue chip (008) ----------
  queueWrap: {
    marginTop: spacing.md, paddingTop: spacing.md,
    borderTopWidth: 1, borderTopColor: colors.borderSubtle,
    gap: spacing.xxs,
  },
  queueText: { flexShrink: 1, ...typography.caption, color: colors.textMuted, lineHeight: 18 },
  queueTextOn: { color: colors.primary, fontWeight: '600' },
  queueGps: { flexShrink: 1, ...typography.micro, color: colors.warning, lineHeight: 16 },

  boatRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginTop: spacing.lg, paddingTop: spacing.lg,
    borderTopWidth: 1, borderTopColor: colors.borderSubtle,
  },
  boatName: { ...typography.bodyStrong, flex: 1 },
  verifiedPill: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xxs,
    backgroundColor: colors.successTint, borderRadius: radii.pill,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs,
  },
  verifiedText: { ...typography.label, color: colors.success, letterSpacing: 0 },
  pendingPill: {
    backgroundColor: colors.warningTint, borderRadius: radii.pill,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs,
  },
  pendingText: { ...typography.label, color: colors.warning, letterSpacing: 0 },

  // ---------- readiness gates (010) ----------
  gateWrap: {
    marginTop: spacing.lg, paddingTop: spacing.lg,
    borderTopWidth: 1, borderTopColor: colors.borderSubtle,
    gap: spacing.sm,
  },
  gateTitle: { ...typography.label },
  gateRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  gateLabel: { ...typography.caption, color: colors.textSecondary, flex: 1 },
  gateDetail: { ...typography.label, letterSpacing: 0 },
  gateNote: { ...typography.micro, color: colors.warning, lineHeight: 16 },

  // ---------- error banner ----------
  banner: {
    marginTop: spacing.lg,
    backgroundColor: colors.dangerTint,
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  bannerText: { flexShrink: 1, ...typography.caption, color: colors.danger, lineHeight: 18 },
  bannerInfo: {
    marginTop: spacing.lg,
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  bannerInfoText: {
    flexShrink: 1, ...typography.caption, color: colors.textSecondary, lineHeight: 18,
  },
  bannerBtn: { marginTop: spacing.md, alignSelf: 'flex-start' },

  // ---------- sections ----------
  sectionLabel: { ...typography.label, marginTop: spacing.huge, marginBottom: spacing.md },
  sectionHead: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginTop: spacing.huge, marginBottom: spacing.md,
  },
  sectionLabelInline: { ...typography.label },
  sectionHeadRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sectionAction: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  groupHead: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginTop: spacing.lg, marginBottom: spacing.sm,
  },
  groupLabel: { ...typography.label, color: colors.textMuted },
  countPill: {
    minWidth: 20, height: 20, borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xs,
  },
  countPillText: { flexShrink: 1, ...typography.label, color: colors.textSecondary, letterSpacing: 0 },
  countPillLive: { backgroundColor: colors.primary },
  countPillTextLive: { flexShrink: 1, ...typography.label, color: colors.primaryText, letterSpacing: 0 },

  demandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginBottom: spacing.sm },
  demandRoute: { ...typography.body, flex: 1, color: colors.textSecondary },

  // ---------- earnings ----------
  earningsRow: { flexDirection: 'row', gap: spacing.md },
  earningsItem: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1, borderColor: colors.borderSubtle,
    paddingVertical: spacing.lg, paddingHorizontal: spacing.md,
    alignItems: 'center', gap: spacing.xs,
    ...elevation.e1,
  },
  earningsValue: { flexShrink: 1, ...typography.display, fontSize: 24, color: colors.primary },
  earningsValueMuted: { color: colors.textSecondary },
  earningsLabel: { ...typography.label },

  // ---------- offline ----------
  offlineBox: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1, borderColor: colors.borderSubtle,
    borderStyle: 'dashed',
    padding: spacing.xl,
    alignItems: 'center',
  },
  offlineIconRing: {
    width: 56, height: 56, borderRadius: radii.pill,
    borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.md,
  },
  offlineTitle: { ...typography.bodyStrong, color: colors.textSecondary, marginBottom: spacing.xs },
  offlineText: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },

  stateBox: { minHeight: 200 },

  // ---------- request cards ----------
  request: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1, borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...elevation.e1,
  },
  activeTrip: { borderColor: colors.primary, backgroundColor: colors.surfaceAlt },
  requestPressed: { borderColor: colors.primary, backgroundColor: colors.surfaceAlt },
  requestTop: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: spacing.md, gap: spacing.sm,
  },
  requestRef: { flexShrink: 1, ...typography.label, color: colors.textMuted, letterSpacing: 0.5 },
  catChip: {
    alignSelf: 'flex-start',
    backgroundColor: colors.primaryTint,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs,
    marginBottom: spacing.md,
  },
  catChipText: { flexShrink: 1, ...typography.label, color: colors.primary, letterSpacing: 0.5 },

  routeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rail: { alignItems: 'center' },
  railDot: { width: 8, height: 8, borderRadius: radii.pill, backgroundColor: colors.primary },
  railDotEnd: { borderRadius: radii.xs, backgroundColor: colors.textSecondary },
  railLine: { width: 2, height: 18, backgroundColor: colors.border, marginVertical: spacing.xxs },
  routeText: { flex: 1 },
  routePort: { flexShrink: 1, ...typography.bodyStrong },
  routePortTo: { marginTop: spacing.md },
  fareWrap: { alignItems: 'flex-end' },
  fare: { flexShrink: 1, ...typography.h2, color: colors.primary },
  fareUnit: { flexShrink: 1, ...typography.label, letterSpacing: 0, fontSize: 10 },

  passengerRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    marginTop: spacing.lg, paddingTop: spacing.md,
    borderTopWidth: 1, borderTopColor: colors.borderSubtle,
  },
  passenger: { ...typography.caption, color: colors.textMuted, flex: 1 },

  parcelBadge: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    alignSelf: 'flex-start',
    backgroundColor: colors.primaryTint,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs,
    marginTop: spacing.sm,
  },
  parcelBadgeText: { flexShrink: 1, ...typography.label, color: colors.primary },

  // ---------- dispatch chips (008) ----------
  chipRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: spacing.sm, marginTop: spacing.md, flexWrap: 'wrap',
  },
  holdChip: {
    flexShrink: 1,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.pill,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xxs,
  },
  holdChipLive: { backgroundColor: colors.successTint, borderColor: colors.success },
  holdChipBlock: { backgroundColor: colors.dangerTint, borderColor: colors.danger },
  holdChipText: { flexShrink: 1, ...typography.label, color: colors.textSecondary, letterSpacing: 0 },
  holdChipTextLive: { color: colors.success },
  holdChipTextBlock: { color: colors.danger },
  chipDistance: { flexShrink: 1, ...typography.label, color: colors.textMuted, letterSpacing: 0 },

  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  declineBtn: { flex: 1 },
  acceptBtn: { flex: 2 },
});
