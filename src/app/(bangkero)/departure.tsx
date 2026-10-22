import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, ScrollView, StyleSheet, Text, TextInput, View,
  type NativeScrollEvent, type NativeSyntheticEvent,
} from 'react-native';

import { BangkeroScreenHeader } from '@/components/BangkeroScreenHeader';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ProgressBar } from '@/components/ProgressBar';
import { ScreenContainer } from '@/components/ScreenContainer';
import { WeatherCard } from '@/components/WeatherCard';
import { useAllPorts } from '@/hooks/useAllPorts';
import { useAuth } from '@/hooks/useAuth';
import { useBangkeroParcels } from '@/hooks/useBangkeroParcels';
import { useRefetchOnFocus, useRealtimeQuery } from '@/hooks/useRealtimeQuery';
import { useTripManifest } from '@/hooks/useTripManifest';
import { useAcceptedBookings, useNoShowTrips } from '@/hooks/useSupabase';
import { friendlyError, rejectBooking, resolveGroupNoShow, stampBookingDepart } from '@/services/booking.service';
import {
  cancelActiveManifests, createManifest, populateManifestDeparture, stampManifestDeparture,
} from '@/services/manifest.service';
import { createNotification } from '@/services/notification.service';
import {
  getPaymentsForBookings, markBookingPaid,
} from '@/services/payment.service';
import { supabase } from '@/services/supabase';
import { STRAIT_POINT } from '@/services/weather.service';
import { manilaDayStartMs, manilaTodayIso } from '@/utils/date';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import type { BookingDoc, PaymentDoc, PaymentMethod } from '@/types/models';

const CHECKLIST_ITEMS = [
  { key: 'lifeJackets', label: 'Life jackets accounted for', icon: '🦺' },
  { key: 'firstAid', label: 'First aid kit present', icon: '🩹' },
  { key: 'fuel', label: 'Fuel level sufficient', icon: '⛽' },
  { key: 'radio', label: 'Radio / communication device', icon: '📻' },
  { key: 'manifest', label: 'Passenger manifest verified', icon: '📋' },
];

const METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  gcash: 'GCash',
  maya: 'Maya',
  bank_transfer: 'Bank transfer',
};

export default function DepartureScreen() {
  const { user } = useAuth();
  const bangkeroId = user?.id ?? null;
  const { manifest, passengers, parcels, loading, error: manifestError, finalizeManifest } = useTripManifest(bangkeroId);
  // Sea weather runs on the live Open-Meteo reading for the route (below),
  // not the never-populated weather_data table.
  const { data: ports } = useAllPorts();
  // Live working set: accepted only, no 10-row cap — older-created accepted
  // bookings used to fall outside the slice and split silently.
  // Future-dated (advance) bookings are excluded — today's departure list
  // only sails today (mirror of arrived.tsx; 027 makes advance accepts
  // common). Payment reads below still cover every accepted row.
  const accepted = useAcceptedBookings(bangkeroId);
  const { data: allParcels } = useBangkeroParcels(bangkeroId);

  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [finalizing, setFinalizing] = useState(false);
  const [departing, setDeparting] = useState(false);
  // Synchronous tap guards: useState updates land after the handler, so a
  // fast double-tap used to run two populates and duplicate manifest rows.
  const finalizeInFlight = useRef(false);
  const departInFlight = useRef(false);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [routeContext, setRouteContext] = useState<{ from: string; to: string } | null>(null);
  const [hasBangka, setHasBangka] = useState<boolean | null>(null);
  // A manifest from a previous day that never sailed is ignored by
  // getActiveManifest, so the screen can show "No manifest" while accepted
  // trips exist. Draft one automatically, once per mount; the button below
  // stays as the retry path when the network dropped.
  const autoDraftTried = useRef(false);

  // Boarding split: who is confirmed aboard, and who is still on the pier.
  // A partial no-show / dispute (022) keeps the booking accepted with
  // onboarded_at NULL — resolved, not waiting, so it never blocks depart.
  const todayIso = manilaTodayIso();
  const acceptedTrips = useMemo(
    () => accepted.data.filter((t) => !t.scheduledDate || t.scheduledDate <= todayIso),
    [accepted.data, todayIso],
  );
  const boardedTrips = acceptedTrips.filter((t) => t.onboardedAt);
  const waitingTrips = acceptedTrips.filter((t) => !t.onboardedAt);
  // Cargo bookings have no passenger QR — the bangkero ticks "Cargo Ready"
  // on the status screen. Their parcels still belong on the manifest, so
  // every accepted cargo trip is recorded regardless of onboarded_at.
  const manifestTrips = useMemo(
    () => acceptedTrips.filter((t) => t.onboardedAt || t.serviceType === 'cargo'),
    [acceptedTrips],
  );
  const pendingTrips = waitingTrips.filter((t) => !t.noShowAt && !t.disputedAt);
  // Vacuous-true with no accepted trips — the empty-departure guard below
  // is what actually decides whether the boat may leave.
  const allBoarded = pendingTrips.length === 0;
  const anyoneAboard = boardedTrips.length > 0;
  const [noShowId, setNoShowId] = useState<string | null>(null);
  const [actedNoShow, setActedNoShow] = useState<Set<string>>(new Set());

  // No-shows scoped to this trip: everything since the draft manifest was
  // generated (start of the Manila day before that) so yesterday's
  // no-shows never bleed into this departure.
  const noShowSince = manifest?.generatedAt
    ?? new Date(manilaDayStartMs(manilaTodayIso())).toISOString();
  const noShows = useNoShowTrips(bangkeroId, noShowSince);
  const sailingRouteIds = new Set(
    acceptedTrips.map((t) => t.routeId).filter((id): id is string => !!id),
  );
  const noShowedTrips = noShows.data.filter(
    (t) =>
      (!t.scheduledDate || t.scheduledDate <= todayIso) &&
      (sailingRouteIds.size === 0 || !t.routeId || sailingRouteIds.has(t.routeId)),
  );
  const freedSeats = noShowedTrips.reduce((sum, t) => sum + t.numOfPassenger, 0);

  // Pay-on-board checklist: one read for every accepted booking, kept
  // fresh through focus + payments realtime (012). The bangkero taps
  // "Mark as paid" per trip once everyone is aboard.
  const [payments, setPayments] = useState<Record<string, PaymentDoc>>({});
  const [payingId, setPayingId] = useState<string | null>(null);
  // Reference drafts keyed by booking — one shared input mixed refs
  // across rows when several trips were unpaid at once.
  const [payReferences, setPayReferences] = useState<Record<string, string>>({});
  const [payError, setPayError] = useState<string | null>(null);
  const loadPayments = useCallback(async () => {
    const ids = accepted.data.map((t) => t.bookingId);
    if (ids.length === 0) {
      setPayments({});
      return;
    }
    try {
      const rows = await getPaymentsForBookings(ids);
      setPayments(Object.fromEntries(rows.map((r) => [r.bookingId, r])));
    } catch {
      // status chips stay as they were; focus/realtime will retry
    }
  }, [accepted.data]);
  useEffect(() => { void loadPayments(); }, [loadPayments]);
  useRealtimeQuery(loadPayments, [{ table: 'payments' }]);

  async function markPaid(t: BookingDoc) {
    setPayingId(t.bookingId);
    setPayError(null);
    try {
      await markBookingPaid(t.bookingId, payReferences[t.bookingId]?.trim() || undefined);
      await loadPayments();
    } catch (e) {
      setPayError(friendlyError(e));
    }
    setPayingId(null);
  }

  const paxLabel = (t: BookingDoc) =>
    t.serviceType === 'cargo' ? 'cargo' : `${t.numOfPassenger} pax`;
  const allCargo = acceptedTrips.length > 0 && acceptedTrips.every((t) => t.serviceType === 'cargo');

  const allChecked = CHECKLIST_ITEMS.every((item) => checked[item.key]);
  const manifestFinalized = manifest?.status === 'finalized';

  // Midpoint of the sailing route's ports — the strait the boat actually
  // crosses. Ports still missing coordinates (pre-063) fall back to the same
  // point the other weather surfaces use.
  const weatherPoint = useMemo(() => {
    const points: { lat: number; lon: number }[] = [];
    for (const id of [manifest?.departurePortId, manifest?.arrivalPortId]) {
      const port = id ? ports.find((p) => p.portId === id) : undefined;
      if (port && typeof port.latitude === 'number' && typeof port.longitude === 'number') {
        points.push({ lat: port.latitude, lon: port.longitude });
      }
    }
    if (points.length === 0) return { lat: STRAIT_POINT.lat, lon: STRAIT_POINT.lon };
    return {
      lat: points.reduce((sum, p) => sum + p.lat, 0) / points.length,
      lon: points.reduce((sum, p) => sum + p.lon, 0) / points.length,
    };
  }, [manifest?.arrivalPortId, manifest?.departurePortId, ports]);

  const liveParcels = useMemo(() => {
    const sailingIds = new Set(acceptedTrips.map((t) => t.bookingId));
    return allParcels.filter(
      (p) =>
        p.status !== 'returned' &&
        ((p.deliveryType === 'accompanied' && sailingIds.has(p.bookingId)) ||
          (p.carrierBookingId != null && sailingIds.has(p.carrierBookingId)) ||
          (p.piggybackBookingId != null && sailingIds.has(p.piggybackBookingId))),
    );
  }, [acceptedTrips, allParcels]);

  const livePassengers = useMemo(() => {
    const passengerBookingIds = new Set(
      manifestTrips
        .filter((t) => t.serviceType !== 'cargo' || t.cargoMode === 'accompanied')
        .map((t) => t.bookingId),
    );
    return passengers.filter((p) => passengerBookingIds.has(p.bookingId));
  }, [manifestTrips, passengers]);

  const manifestParcelIds = useMemo(
    () => new Set(parcels.map((p) => p.parcelId)),
    [parcels],
  );

  const [topUpNonce, setTopUpNonce] = useState(0);
  const topUpInFlight = useRef(false);
  const topUpQueued = useRef(false);
  const topUpKey = useRef<string | null>(null);

  useEffect(() => {
    if (!manifestFinalized || !manifest) return;
    const missingIds = liveParcels
      .filter((p) => !manifestParcelIds.has(p.parcelId))
      .map((p) => p.parcelId)
      .sort();
    if (missingIds.length === 0) {
      topUpKey.current = null;
      return;
    }
    const key = [
      manifest.manifestId,
      manifestTrips.map((t) => t.bookingId).sort().join(','),
      missingIds.join(','),
    ].join(':');
    if (topUpKey.current === key) return;
    if (topUpInFlight.current) {
      topUpQueued.current = true;
      return;
    }
    topUpKey.current = key;
    topUpInFlight.current = true;
    void (async () => {
      try {
        await populateManifestDeparture(manifest, manifestTrips, { stampDeparture: false });
      } catch (e) {
        topUpKey.current = null;
        if (__DEV__) console.warn('[departure] manifest top-up failed:', e);
      } finally {
        topUpInFlight.current = false;
        if (topUpQueued.current) {
          topUpQueued.current = false;
          setTopUpNonce((n) => n + 1);
        }
      }
    })();
  }, [liveParcels, manifest, manifestFinalized, manifestParcelIds, manifestTrips, topUpNonce]);

  const load = useCallback(async () => {
    if (!bangkeroId) return;
    try {
      const [bangkaRes, bookingRes] = await Promise.all([
        supabase.from('bangkas').select('id').eq('bangkero_id', bangkeroId).maybeSingle(),
        supabase
          .from('bookings')
          .select('route_id')
          .eq('operator_id', bangkeroId)
          .eq('trip_stat', 'accepted')
          // Same today-only scope as the working set above: an advance
          // route must not seed today's manifest/departure context.
          .or(`scheduled_date.is.null,scheduled_date.lte.${todayIso}`)
          .order('accepted_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      setHasBangka(!!bangkaRes.data);
      if (bookingRes.data?.route_id) {
        const [from, to] = bookingRes.data.route_id.split('__');
        if (from && to) setRouteContext({ from, to });
      }
    } catch {
      setHasBangka(false);
    }
  }, [bangkeroId, todayIso]);

  useEffect(() => { void load(); }, [load]);
  useRefetchOnFocus(load);

  function toggleCheck(key: string) {
    setChecked((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function confirmNoShow(t: BookingDoc) {
    if (actedNoShow.has(t.bookingId)) return;
    Alert.alert(
      'Passenger didn’t board',
      `The boat leaves with everyone who boarded on ${t.ref}. If nobody from this booking boarded, it is cancelled as a no-show and the booker is banned for a while — otherwise only the missing passengers are marked and the trip continues.`,
      [
        { text: 'Go back', style: 'cancel' },
        { text: 'Mark no-show', style: 'destructive', onPress: () => void doNoShow(t) },
      ]
    );
  }

  async function doNoShow(t: BookingDoc) {
    if (actedNoShow.has(t.bookingId)) return;
    setNoShowId(t.bookingId);
    try {
      await resolveGroupNoShow(t);
      setActedNoShow((prev) => new Set(prev).add(t.bookingId));
    } catch (e) {
      setGenError(friendlyError(e));
    }
    setNoShowId(null);
  }

  async function handleGenerate() {
    if (!bangkeroId || generating) return;
    setGenerating(true);
    setGenError(null);
    try {
      const { data: bangka } = await supabase
        .from('bangkas')
        .select('id')
        .eq('bangkero_id', bangkeroId)
        .maybeSingle();
      if (!bangka) throw new Error('Set up your boat in Profile first.');
      // No accepted trip on the pier anymore (fresh sailing window) —
      // regenerate on the previous manifest's route.
      const route = routeContext
        ?? (manifest ? { from: manifest.departurePortId, to: manifest.arrivalPortId } : null);
      if (!route) {
        throw new Error('No active accepted trip found for this route.');
      }
      await cancelActiveManifests(bangkeroId);
      await createManifest({
        bangkaId: bangka.id,
        bangkeroId,
        departurePortId: route.from,
        arrivalPortId: route.to,
      });
    } catch (e) {
      setGenError(friendlyError(e));
    }
    setGenerating(false);
  }

  // Fresh draft for today's accepted trips when no live manifest resolves.
  // handleGenerate cancels stale actives first and never touches a manifest
  // that already sailed.
  useEffect(() => {
    if (autoDraftTried.current || loading || generating || manifest) return;
    if (!routeContext || hasBangka !== true || acceptedTrips.length === 0) return;
    autoDraftTried.current = true;
    void handleGenerate();
    // handleGenerate changes identity every render; the ref guard makes the
    // extra runs no-ops.
  }, [acceptedTrips.length, generating, handleGenerate, hasBangka, loading, manifest, routeContext]);

  async function handleFinalize() {
    if (finalizeInFlight.current || !manifest) return;
    finalizeInFlight.current = true;
    setFinalizing(true);
    setGenError(null);
    try {
      // Snapshot the manifest children now so the card/manifest screen is
      // not blank between finalize and departure. Skip the departure stamp:
      // handleDepart records the real actual_departure_time (trip duration).
      await populateManifestDeparture(manifest, manifestTrips, { stampDeparture: false });
      await finalizeManifest();
    } catch (e) {
      setGenError(friendlyError(e));
    }
    finalizeInFlight.current = false;
    setFinalizing(false);
  }

  /** Best effort: a request still held by this boat must not sit out its
   *  3-minute hold while we are at sea — hand it to the next boat. The DB
   *  excludes at-sea boats from new offers (067); this closes the race. */
  async function releaseMyHolds() {
    if (!bangkeroId) return;
    try {
      const { data } = await supabase
        .from('bookings')
        .select('id')
        .eq('held_by', bangkeroId)
        .eq('trip_stat', 'open');
      await Promise.all((data ?? []).map((b) => rejectBooking(b.id as string).catch(() => {})));
    } catch {
      // best effort — a stale hold simply expires on its own
    }
  }

  async function handleDepart() {
    if (departInFlight.current || !manifest) return;
    departInFlight.current = true;
    setDeparting(true);
    setGenError(null);

    // 1. Who is aboard — best effort. A snapshot failure must not strand the
    //    boat at the pier; the boarding state is already on the bookings.
    try {
      await populateManifestDeparture(manifest, manifestTrips, { stampDeparture: false });
    } catch (e) {
      if (__DEV__) console.warn('[departure] manifest snapshot failed:', e);
    }

    // 2. The sailing clock — required. En Route reads `departure &&
    //    !arrival`, so leaving without a stamp lands on "No trip in
    //    progress". Stay here and let the bangkero retry instead.
    try {
      await stampManifestDeparture(manifest);
    } catch (e) {
      setGenError(`Departure was not recorded — ${friendlyError(e)} Try again.`);
      departInFlight.current = false;
      setDeparting(false);
      return;
    }

    // 3. Per-booking stamps + notifications — best effort.
    if (bangkeroId) {
      // Only today's sailing — future advance bookings sail another day
      // and must not be stamped or notified now.
      const todayIds = acceptedTrips.map((t) => t.bookingId);
      if (todayIds.length > 0) {
        try {
          const { data } = await supabase
            .from('bookings')
            .select('id, ref, user_id')
            .eq('operator_id', bangkeroId)
            .eq('trip_stat', 'accepted')
            .in('id', todayIds);
          await Promise.all(
            (data ?? []).map(async (b) => {
              // C8: actual depart time — best effort, never blocks departure.
              try {
                await stampBookingDepart(b.id);
              } catch {
                // ignore — manifest already records the sailing
              }
              if (b.user_id) {
                try {
                  await createNotification(
                    b.user_id,
                    'Trip Departed',
                    `Boat for trip ${b.ref} has departed.`
                  );
                } catch {
                  // ignore — departure still proceeds
                }
              }
            })
          );
        } catch {
          // ignore — departure still proceeds, manifest is the record
        }
      }
      void releaseMyHolds();
    }
    departInFlight.current = false;
    setDeparting(false);
    router.push('/(bangkero)/en-route');
  }

  const steps = ['Manifest', 'Checklist', 'Weather', 'Ready'];
  // The highlight follows the section on screen, not the phase state: the
  // labels name sections, so tapping a checklist box used to leave "Weather"
  // lit while the checklist was in view. Offsets are measured on layout.
  const stepOffsets = useRef<Record<number, number>>({});
  const [currentStep, setCurrentStep] = useState(0);
  function handleScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    let next = 0;
    for (let i = 1; i < steps.length; i++) {
      const y = stepOffsets.current[i];
      if (y !== undefined && y <= contentOffset.y + 140) next = i;
    }
    // The footer can never cross the top of the viewport — the bottom of the
    // scroll is the Ready step.
    if (contentOffset.y + layoutMeasurement.height >= contentSize.height - 24) {
      next = steps.length - 1;
    }
    setCurrentStep((prev) => (prev === next ? prev : next));
  }

  return (
    <ScreenContainer padded={false}>
      <BangkeroScreenHeader eyebrow="MANIFEST & CHECKLIST" title="Departure" />
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
      >

        <ProgressBar steps={steps} current={currentStep} />

        <View onLayout={(e) => { stepOffsets.current[0] = e.nativeEvent.layout.y; }}>

        {/* ---------- boarding split ---------- */}
        {acceptedTrips.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>{allCargo ? 'CARGO' : 'PASSENGERS'}</Text>
            <View style={styles.boardCard}>
              {boardedTrips.map((t) => (
                <View key={t.bookingId} style={styles.boardRow}>
                  <Text style={styles.boardCheck}>✓</Text>
                  <View style={styles.boardBody}>
                    <Text style={styles.boardName} numberOfLines={1}>
                      {t.passengerName ?? 'Passengers'} · {paxLabel(t)}
                    </Text>
                    <Text style={styles.boardSub} numberOfLines={1}>
                      {t.ref} · aboard
                    </Text>
                  </View>
                </View>
              ))}

              {waitingTrips.length > 0 && (
                <>
                  <View style={styles.boardDivider} />
                  <Text style={styles.boardGroupLabel}>NOT BOARDED</Text>
                  {waitingTrips.map((t) => {
                    // Partial no-show / dispute (022): resolved, nothing to tap.
                    const resolved = !!t.noShowAt || !!t.disputedAt;
                    return (
                      <View key={t.bookingId} style={styles.boardRow}>
                        <Text style={resolved ? styles.boardMiss : styles.boardWait}>
                          {resolved ? '✕' : '○'}
                        </Text>
                        <View style={styles.boardBody}>
                          <Text style={styles.boardName} numberOfLines={1}>
                            {t.passengerName ?? 'Passengers'} · {paxLabel(t)}
                          </Text>
                          <Text style={styles.boardSub} numberOfLines={1}>
                            {t.ref} · {resolved ? 'marked absent' : 'still on the pier'}
                          </Text>
                        </View>
                        {!resolved && (
                          <View style={styles.boardAction}>
                            <PrimaryButton
                              label="Didn't board"
                              variant="danger"
                              onPress={() => confirmNoShow(t)}
                              loading={noShowId === t.bookingId}
                              disabled={actedNoShow.has(t.bookingId)}
                              style={styles.noShowBtn}
                            />
                          </View>
                        )}
                      </View>
                    );
                  })}
                </>
              )}

              {/* Left behind — kept visible so the story survives the cancel,
                  plus the seat count the bangkero can now backfill. */}
              {!allCargo && noShowedTrips.length > 0 && (
                <>
                  <View style={styles.boardDivider} />
                  <Text style={styles.boardGroupLabel}>
                    NO-SHOWED · {noShowedTrips.length}
                  </Text>
                  {noShowedTrips.map((t) => (
                    <View key={t.bookingId} style={styles.boardRow}>
                      <Text style={styles.boardMiss}>✕</Text>
                      <View style={styles.boardBody}>
                        <Text style={[styles.boardName, styles.boardNameMiss]} numberOfLines={1}>
                          {t.passengerName ?? 'Passengers'} · {paxLabel(t)}
                        </Text>
                        <Text style={styles.boardSub} numberOfLines={1}>
                          {t.ref} · left behind
                        </Text>
                      </View>
                    </View>
                  ))}
                  <Text style={styles.cue}>
                    {freedSeats} seat{freedSeats === 1 ? '' : 's'} freed by no-shows —
                    accept new bookings from Home to fill them.
                  </Text>
                </>
              )}
            </View>
            {!!genError && !!manifest && (
              <View style={styles.banner}>
                <Text style={styles.bannerText}>{genError}</Text>
              </View>
            )}
          </>
        )}

        {loading ? (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderText}>Loading manifest…</Text>
          </View>
        ) : manifest ? (
          <>
            <Text style={styles.sectionLabel}>TRIP DETAILS</Text>
            <View style={styles.tripCard}>
              <View style={styles.tripRow}>
                <Text style={styles.tripLabel}>Reference</Text>
                <Text style={styles.tripValue}>{manifest.manifestId}</Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.tripRow}>
                <Text style={styles.tripLabel}>Passengers</Text>
                <Text style={styles.tripValue} numberOfLines={1}>{livePassengers.length} ({livePassengers.length} pax)</Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.tripRow}>
                <Text style={styles.tripLabel}>Parcels</Text>
                <Text style={styles.tripValue} numberOfLines={1}>{liveParcels.length} ({liveParcels.length} items)</Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.tripRow}>
                <Text style={styles.tripLabel}>Manifest Status</Text>
                <Text style={[styles.tripValue, manifestFinalized && styles.tripValueOk]}>
                  {manifestFinalized ? 'Finalized' : 'Draft'}
                </Text>
              </View>
            </View>

            {!manifestFinalized && (
              <>
                {!!manifestError && (
                  <View style={styles.banner}>
                    <Text style={styles.bannerText}>{manifestError}</Text>
                  </View>
                )}
                <PrimaryButton
                  label="Finalize Manifest"
                  onPress={handleFinalize}
                  loading={finalizing}
                  disabled={finalizing}
                  style={styles.mt}
                />
              </>
            )}

            {manifestFinalized && (
              <PrimaryButton
                label="View Manifest"
                variant="secondary"
                onPress={() => router.push('/(bangkero)/manifest')}
                style={styles.mt}
              />
            )}

            {/* Finished manifest, nobody booked yet — open the next sailing. */}
            {manifestFinalized && acceptedTrips.length === 0 && (
              <PrimaryButton
                label="Generate New Manifest"
                variant="secondary"
                onPress={() => void handleGenerate()}
                loading={generating}
                disabled={generating}
                style={styles.mt}
              />
            )}

            <View onLayout={(e) => { stepOffsets.current[1] = e.nativeEvent.layout.y; }}>
              <Text style={styles.sectionLabel}>SAFETY CHECKLIST</Text>
              <View style={styles.checklist}>
                {CHECKLIST_ITEMS.map((item) => {
                  const isChecked = !!checked[item.key];
                  return (
                    <Text
                      key={item.key}
                      onPress={() => toggleCheck(item.key)}
                      style={[styles.checkItem, isChecked && styles.checkItemDone]}
                    >
                      <Text style={styles.checkIcon}>{isChecked ? '✅' : item.icon}</Text>
                      {' '}{item.label}
                    </Text>
                  );
                })}
              </View>
            </View>

            <View onLayout={(e) => { stepOffsets.current[2] = e.nativeEvent.layout.y; }}>
              <Text style={styles.sectionLabel}>WEATHER CHECK</Text>
              <WeatherCard latitude={weatherPoint.lat} longitude={weatherPoint.lon} />
            </View>

            {/* ---------- payment (pay-on-board, 012) ---------- */}
            {acceptedTrips.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>
                  {allBoarded && anyoneAboard ? 'MARK AS PAID' : 'PAYMENT'}
                </Text>
                <View style={styles.payCard}>
                  {acceptedTrips.map((t) => {
                    const p = payments[t.bookingId];
                    const paid = p?.paymentStatus === 'completed';
                    const canMark = allBoarded && anyoneAboard && !paid;
                    return (
                      <View key={t.bookingId} style={styles.payItem}>
                        <View style={styles.payRow}>
                          <View style={styles.payBody}>
                            <Text style={styles.payName} numberOfLines={1}>
                              {t.ref} · {t.passengerName ?? 'Passengers'}
                            </Text>
                            <Text style={styles.payMeta} numberOfLines={1}>
                              ₱{t.totalPrice}
                              {p ? ` · ${METHOD_LABELS[p.paymentMethod] ?? p.paymentMethod}` : ''}
                            </Text>
                          </View>
                          <Text style={paid ? styles.payStatusDone : styles.payStatusPending}>
                            {paid ? '✓ Paid' : 'Pending'}
                          </Text>
                        </View>
                        {canMark && (
                          <>
                            <TextInput
                              style={styles.payRefInput}
                              placeholder="GCash / receipt reference (optional)"
                              placeholderTextColor={colors.textMuted}
                              value={payReferences[t.bookingId] ?? ''}
                              onChangeText={(v) =>
                                setPayReferences((prev) => ({ ...prev, [t.bookingId]: v }))
                              }
                              autoCapitalize="characters"
                            />
                            <PrimaryButton
                              label="Mark as paid"
                              onPress={() => void markPaid(t)}
                              loading={payingId === t.bookingId}
                              disabled={payingId !== null}
                              style={styles.payBtn}
                            />
                          </>
                        )}
                      </View>
                    );
                  })}

                  {!allBoarded && (
                    <Text style={styles.payHint}>
                      Confirm everyone aboard — payment status becomes actionable once the
                      boarding checklist is complete.
                    </Text>
                  )}
                  {!!payError && (
                    <View style={styles.payError}>
                      <Text style={styles.payErrorText}>{payError}</Text>
                    </View>
                  )}
                </View>
              </>
            )}

            <View
              style={styles.footer}
              onLayout={(e) => { stepOffsets.current[3] = e.nativeEvent.layout.y; }}
            >
              <PrimaryButton
                label="Ready to Depart"
                onPress={handleDepart}
                loading={departing}
                disabled={
                  !manifestFinalized || !allChecked || departing || !allBoarded || !anyoneAboard
                }
              />
              {!anyoneAboard && allBoarded && (
                <Text style={styles.readyHint}>
                  No passengers aboard — confirm someone as boarded, or accept a new
                  booking from Home to fill seats.
                </Text>
              )}
              {anyoneAboard && !allBoarded && (
                <Text style={styles.readyHint}>
                  Confirm everyone aboard — or mark them as didn’t board — before departing.
                </Text>
              )}
            </View>
          </>
        ) : (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTitle}>No manifest yet</Text>
            <Text style={styles.emptyText}>
              Generate a manifest for your accepted trip before departure.
            </Text>
            {!!genError && (
              <View style={styles.banner}>
                <Text style={styles.bannerText}>{genError}</Text>
              </View>
            )}
            <PrimaryButton
              label="Generate Manifest"
              onPress={handleGenerate}
              loading={generating}
              disabled={generating || hasBangka === false || !routeContext}
            />
            {hasBangka === false && (
              <Text style={styles.emptyHint}>Set up your boat in Profile first.</Text>
            )}
            {!routeContext && hasBangka !== false && (
              <Text style={styles.emptyHint}>Accept a booking trip to load its route.</Text>
            )}
          </View>
        )}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  eyebrow: { ...typography.label, marginBottom: 2 },
  title: { ...typography.h1, marginBottom: spacing.xl },
  mt: { marginTop: spacing.lg },

  placeholder: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.xl,
    alignItems: 'center',
  },
  placeholderText: { color: colors.textMuted, fontSize: 14 },

  emptyBox: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: spacing.xs },
  emptyText: { color: colors.textMuted, fontSize: 13, textAlign: 'center', marginBottom: spacing.lg },
  emptyHint: { color: colors.textMuted, fontSize: 12, marginTop: spacing.md, textAlign: 'center' },

  banner: {
    backgroundColor: colors.dangerTint,
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    width: '100%',
  },
  bannerText: { flexShrink: 1, color: colors.danger, fontSize: 13, lineHeight: 18 },

  sectionLabel: { ...typography.label, marginTop: spacing.xxl, marginBottom: spacing.md },

  tripCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
  },
  tripRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  tripLabel: { color: colors.textSecondary, fontSize: 14 },
  tripValue: { flexShrink: 1, color: colors.text, fontSize: 14, fontWeight: '600' },
  tripValueOk: { color: colors.primary },
  divider: { height: 1, backgroundColor: colors.borderSubtle },

  checklist: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
  },
  checkItem: {
    color: colors.textSecondary,
    fontSize: 14,
    paddingVertical: spacing.sm,
    lineHeight: 22,
  },
  checkItemDone: {
    color: colors.primary,
  },
  checkIcon: { flexShrink: 1, fontSize: 14 },

  // ---------- payment (pay-on-board) ----------
  payCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.md,
  },
  payItem: { paddingVertical: spacing.sm },
  payRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  payBody: { flex: 1, minWidth: 0 },
  payName: { flexShrink: 1, color: colors.text, fontSize: 14, fontWeight: '600' },
  payMeta: { flexShrink: 1, ...typography.caption, color: colors.textMuted, marginTop: 1 },
  payStatusDone: { ...typography.label, color: colors.success, letterSpacing: 0 },
  payStatusPending: { ...typography.label, color: colors.warning, letterSpacing: 0 },
  payBtn: { marginTop: spacing.sm, minHeight: 40 },
  payRefInput: {
    marginTop: spacing.md,
    backgroundColor: colors.bgElevated,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    color: colors.text,
    fontSize: 14,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  payHint: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm, lineHeight: 18 },
  payError: {
    marginTop: spacing.sm,
    backgroundColor: colors.dangerTint,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.danger,
    padding: spacing.sm,
  },
  payErrorText: { flexShrink: 1, color: colors.danger, fontSize: 12, lineHeight: 16 },

  footer: { marginTop: spacing.xxl },
  readyHint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
    lineHeight: 18,
  },

  // ---------- boarding split ----------
  boardCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.md,
  },
  boardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  boardCheck: { color: colors.primary, fontSize: 14, fontWeight: '800', width: 16 },
  boardWait: { color: colors.textMuted, fontSize: 14, fontWeight: '800', width: 16 },
  boardMiss: { color: colors.danger, fontSize: 14, fontWeight: '800', width: 16 },
  boardNameMiss: { color: colors.textMuted, textDecorationLine: 'line-through' },
  cue: {
    ...typography.caption,
    color: colors.primary,
    marginTop: spacing.sm,
    lineHeight: 18,
  },
  boardBody: { flex: 1, minWidth: 0 },
  boardName: { flexShrink: 1, color: colors.text, fontSize: 14, fontWeight: '600' },
  boardSub: { flexShrink: 1, ...typography.caption, color: colors.textMuted, marginTop: 1 },
  boardDivider: { height: 1, backgroundColor: colors.borderSubtle, marginVertical: spacing.sm },
  boardGroupLabel: { ...typography.label, color: colors.textMuted, marginBottom: spacing.xs },
  boardAction: { width: 120 },
  noShowBtn: { minHeight: 36 },
});
