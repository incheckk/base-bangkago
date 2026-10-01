import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';

import { BangkeroScreenHeader } from '@/components/BangkeroScreenHeader';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ProgressBar } from '@/components/ProgressBar';
import { ScreenContainer } from '@/components/ScreenContainer';
import { useAuth } from '@/hooks/useAuth';
import { useRefetchOnFocus, useRealtimeQuery } from '@/hooks/useRealtimeQuery';
import { useTripManifest } from '@/hooks/useTripManifest';
import { useWeatherData } from '@/hooks/useWeatherData';
import { useAcceptedBookings, useNoShowTrips } from '@/hooks/useSupabase';
import { friendlyError, noShowPassenger } from '@/services/booking.service';
import { cancelActiveManifests, createManifest, populateManifestDeparture } from '@/services/manifest.service';
import { createNotification } from '@/services/notification.service';
import {
  getPaymentsForBookings, markBookingPaid,
} from '@/services/payment.service';
import { supabase } from '@/services/supabase';
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
  const { manifest, passengers, parcels, loading, finalizeManifest } = useTripManifest(bangkeroId);
  const { data: weather, loading: weatherLoading } = useWeatherData(manifest?.departurePortId ?? 'p1');
  // Live working set: accepted only, no 10-row cap — older-created accepted
  // bookings used to fall outside the slice and split silently.
  const accepted = useAcceptedBookings(bangkeroId);

  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [finalizing, setFinalizing] = useState(false);
  const [departing, setDeparting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [routeContext, setRouteContext] = useState<{ from: string; to: string } | null>(null);
  const [hasBangka, setHasBangka] = useState<boolean | null>(null);

  // Boarding split: who is confirmed aboard, and who is still on the pier.
  const acceptedTrips = accepted.data;
  const boardedTrips = acceptedTrips.filter((t) => t.onboardedAt);
  const waitingTrips = acceptedTrips.filter((t) => !t.onboardedAt);
  // Vacuous-true with no accepted trips — the empty-departure guard below
  // is what actually decides whether the boat may leave.
  const allBoarded = waitingTrips.length === 0;
  const anyoneAboard = boardedTrips.length > 0;
  const [noShowId, setNoShowId] = useState<string | null>(null);
  const [actedNoShow, setActedNoShow] = useState<Set<string>>(new Set());

  // No-shows scoped to this trip: everything since the draft manifest was
  // generated (start of today before that) so yesterday's no-shows never
  // bleed into this departure.
  const noShowSince = manifest?.generatedAt
    ?? new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const noShows = useNoShowTrips(bangkeroId, noShowSince);
  const noShowedTrips = noShows.data;
  const freedSeats = noShowedTrips.reduce((sum, t) => sum + t.numOfPassenger, 0);

  // Pay-on-board checklist: one read for every accepted booking, kept
  // fresh through focus + payments realtime (012). The bangkero taps
  // "Mark as paid" per trip once everyone is aboard.
  const [payments, setPayments] = useState<Record<string, PaymentDoc>>({});
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payReference, setPayReference] = useState('');
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
      await markBookingPaid(t.bookingId, payReference.trim() || undefined);
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
  }, [bangkeroId]);

  useEffect(() => { void load(); }, [load]);
  useRefetchOnFocus(load);

  function toggleCheck(key: string) {
    setChecked((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function confirmNoShow(t: BookingDoc) {
    if (actedNoShow.has(t.bookingId)) return;
    Alert.alert(
      'Passenger didn’t board',
      `Mark ${t.ref} as a no-show? The boat leaves with everyone who boarded, and the passenger is banned from booking for a while.`,
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
      await noShowPassenger(t);
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

  async function handleFinalize() {
    setFinalizing(true);
    await finalizeManifest();
    setFinalizing(false);
  }

  async function handleDepart() {
    if (departing) return;
    setDeparting(true);
    // Best effort: the manifest must record who sailed for Trip Summary to
    // report real numbers — but never block the departure over it.
    if (manifest) {
      try {
        await populateManifestDeparture(manifest, boardedTrips);
      } catch (e) {
        setGenError(`Could not record everyone aboard: ${friendlyError(e)}`);
      }
    }
    if (bangkeroId) {
      supabase
        .from('bookings')
        .select('id, ref, user_id')
        .eq('operator_id', bangkeroId)
        .eq('trip_stat', 'accepted')
        .then(({ data }) => {
          (data ?? []).forEach((b) => {
            if (b.user_id) {
              createNotification(
                b.user_id,
                'Trip Departed',
                `Boat for trip ${b.ref} has departed.`
              ).catch(() => {});
            }
          });
        });
    }
    setTimeout(() => {
      router.push('/(bangkero)/arrived');
    }, 1000);
  }

  const steps = ['Manifest', 'Checklist', 'Weather', 'Ready'];
  const currentStep = manifestFinalized
    ? allChecked && allBoarded && anyoneAboard ? 3 : 2
    : 0;

  return (
    <ScreenContainer padded={false}>
      <BangkeroScreenHeader title="Departure" subtitle="MANIFEST & CHECKLIST" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        <ProgressBar steps={steps} current={currentStep} />

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
                  {waitingTrips.map((t) => (
                    <View key={t.bookingId} style={styles.boardRow}>
                      <Text style={styles.boardWait}>○</Text>
                      <View style={styles.boardBody}>
                        <Text style={styles.boardName} numberOfLines={1}>
                          {t.passengerName ?? 'Passengers'} · {paxLabel(t)}
                        </Text>
                        <Text style={styles.boardSub} numberOfLines={1}>
                          {t.ref} · still on the pier
                        </Text>
                      </View>
                      <View style={styles.boardAction}>
                        <PrimaryButton
                          label="Didn’t board"
                          variant="danger"
                          onPress={() => confirmNoShow(t)}
                          loading={noShowId === t.bookingId}
                          disabled={actedNoShow.has(t.bookingId)}
                          style={styles.noShowBtn}
                        />
                      </View>
                    </View>
                  ))}
                </>
              )}

              {/* Left behind — kept visible so the story survives the cancel,
                  plus the seat count the bangkero can now backfill. */}
              {noShowedTrips.length > 0 && (
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
            <Text style={styles.sectionLabel}>TRIP INFO</Text>
            <View style={styles.tripCard}>
              <View style={styles.tripRow}>
                <Text style={styles.tripLabel}>Reference</Text>
                <Text style={styles.tripValue}>{manifest.manifestId}</Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.tripRow}>
                <Text style={styles.tripLabel}>Passengers</Text>
                <Text style={styles.tripValue} numberOfLines={1}>{passengers.length} ({manifest.totalPassengersOnBoard} pax)</Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.tripRow}>
                <Text style={styles.tripLabel}>Parcels</Text>
                <Text style={styles.tripValue} numberOfLines={1}>{parcels.length} ({manifest.totalParcelsOnBoard} items)</Text>
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
              <PrimaryButton
                label="Finalize Manifest"
                onPress={handleFinalize}
                loading={finalizing}
                disabled={finalizing}
                style={styles.mt}
              />
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

            <Text style={styles.sectionLabel}>WEATHER CHECK</Text>
            <View style={styles.weatherCard}>
              {weatherLoading ? (
                <Text style={styles.weatherText}>Checking conditions…</Text>
              ) : weather ? (
                <View style={styles.weatherRow}>
                  <Text style={styles.weatherIcon}>{weather.isSafe ? '☀️' : '⛈️'}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.weatherLabel}>
                      {weather.weatherCondition ?? 'Unknown'}
                    </Text>
                    <Text style={[styles.weatherStatus, weather.isSafe ? styles.weatherSafe : styles.weatherUnsafe]}>
                      {weather.isSafe ? 'Conditions are safe for departure' : 'Unsafe conditions — consider delaying'}
                    </Text>
                  </View>
                </View>
              ) : (
                <Text style={styles.weatherText}>Weather data unavailable</Text>
              )}
            </View>

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
                          <PrimaryButton
                            label="Mark as paid"
                            onPress={() => void markPaid(t)}
                            loading={payingId === t.bookingId}
                            disabled={payingId !== null}
                            style={styles.payBtn}
                          />
                        )}
                      </View>
                    );
                  })}

                  {allBoarded && anyoneAboard &&
                    acceptedTrips.some((t) => payments[t.bookingId]?.paymentStatus !== 'completed') && (
                      <TextInput
                        style={styles.payRefInput}
                        placeholder="GCash / receipt reference (optional)"
                        placeholderTextColor={colors.textMuted}
                        value={payReference}
                        onChangeText={setPayReference}
                        autoCapitalize="characters"
                      />
                  )}

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

            <View style={styles.footer}>
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

  weatherCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
  },
  weatherRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  weatherIcon: { flexShrink: 1, fontSize: 28 },
  weatherLabel: { flexShrink: 1, color: colors.text, fontSize: 15, fontWeight: '700' },
  weatherStatus: { flexShrink: 1, fontSize: 12, marginTop: 2 },
  weatherSafe: { color: colors.primary },
  weatherUnsafe: { color: colors.danger },
  weatherText: { color: colors.textMuted, fontSize: 14 },

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
