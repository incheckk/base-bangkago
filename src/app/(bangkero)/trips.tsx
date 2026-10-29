import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';

import { BangkeroScreenHeader } from '@/components/BangkeroScreenHeader';
import { FilterChips } from '@/components/FilterChips';
import { ScreenContainer } from '@/components/ScreenContainer';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { useAuth } from '@/hooks/useAuth';
import { useBangkeroParcels } from '@/hooks/useBangkeroParcels';
import { useRealtimeQuery } from '@/hooks/useRealtimeQuery';
import { useMyTrips } from '@/hooks/useSupabase';
import { getPaymentsForBookings } from '@/services/payment.service';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import type { BookingDoc, PaymentDoc } from '@/types/models';
import { bookingTypeLabel } from '@/utils/booking-label';
import {
  type Sailing, buildSailings, sailingDayLabel, todayKey,
} from '@/utils/sailings';

/**
 * One history tab, one model: accepted bookings become a sailing (a trip),
 * and the sailing detail IS the manifest — passengers, companions, parcels
 * and payments in one screen. Requests that were cancelled never became a
 * trip, so they stay their own list (and their own chip) rather than being
 * folded into a sailing they never joined.
 */
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
];

export default function TripsScreen() {
  const { user } = useAuth();
  const uid = user?.id ?? null;

  const trips = useMyTrips(uid);
  const parcels = useBangkeroParcels(uid);
  const [payments, setPayments] = useState<Record<string, PaymentDoc>>({});
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  const tripIds = useMemo(() => trips.data.map((t) => t.bookingId), [trips.data]);
  const loadPayments = useCallback(async () => {
    if (tripIds.length === 0) {
      setPayments({});
      return;
    }
    try {
      const rows = await getPaymentsForBookings(tripIds);
      setPayments(Object.fromEntries(rows.map((r) => [r.bookingId, r])));
    } catch {
      // unpaid badges stay as they were; realtime retries
    }
  }, [tripIds]);
  useEffect(() => { void loadPayments(); }, [loadPayments]);
  useRealtimeQuery(loadPayments, [{ table: 'payments' }]);

  const q = search.trim().toLowerCase();
  const matchingTrips = useMemo(() => {
    if (!q) return trips.data;
    return trips.data.filter((t) =>
      `${t.ref} ${t.passengerName ?? ''} ${t.fromPortName ?? ''} ${t.toPortName ?? ''}`
        .toLowerCase()
        .includes(q)
    );
  }, [trips.data, q]);

  const sailings = useMemo(
    () => buildSailings(matchingTrips, parcels.data, payments),
    [matchingTrips, parcels.data, payments]
  );
  // Accepted bookings are live or upcoming; everything else in a sailing
  // is done. buildSailings already drops cancelled rows.
  const active = sailings
    .filter((s) => s.inProgress)
    .sort((a, b) => a.day.localeCompare(b.day));
  const completed = sailings.filter((s) => !s.inProgress);
  const cancelled = matchingTrips.filter((t) => t.status === 'cancelled')
    .sort((a, b) => (b.cancelledAt ?? b.createdAt).localeCompare(a.cancelledAt ?? a.createdAt));

  const showActive = filter === 'all' || filter === 'active';
  const showCompleted = filter === 'all' || filter === 'completed';
  const showCancelled = filter === 'all' || filter === 'cancelled';

  const total = (showActive ? active.length : 0)
    + (showCompleted ? completed.length : 0)
    + (showCancelled ? cancelled.length : 0);

  if (trips.loading) {
    return (
      <ScreenContainer padded={false}>
        <BangkeroScreenHeader eyebrow="TRIP HISTORY" title="Trips & Manifests" />
        <View style={styles.center}><LoadingState label="Loading trips…" /></View>
      </ScreenContainer>
    );
  }
  if (trips.error) {
    return (
      <ScreenContainer padded={false}>
        <BangkeroScreenHeader eyebrow="TRIP HISTORY" title="Trips & Manifests" />
        <View style={styles.center}><ErrorState message={trips.error} /></View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padded={false}>
      <BangkeroScreenHeader eyebrow="TRIP HISTORY" title="Trips & Manifests" />
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <FilterChips filters={FILTERS} active={filter} onChange={setFilter} />

        <View style={styles.searchBar}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search route, ref, or passenger"
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
            returnKeyType="search"
          />
        </View>

        {total === 0 ? (
          <View style={styles.emptyBox}>
            <EmptyState
              icon="history"
              title={q ? 'Nothing matches' : 'No trips yet'}
              message={
                q
                  ? 'Try a route, booking reference, or passenger name.'
                  : 'Accepted requests become one trip with one manifest, and appear here.'
              }
            />
          </View>
        ) : (
          <>
            {showActive && active.length > 0 && (
              <Section title="ACTIVE">
                {active.map((s) => (
                  <SailingCard key={s.key} sailing={s} soon={s.day > todayKey()} />
                ))}
              </Section>
            )}
            {showCompleted && completed.length > 0 && (
              <Section title="COMPLETED">
                {completed.map((s) => <SailingCard key={s.key} sailing={s} />)}
              </Section>
            )}
            {showCancelled && cancelled.length > 0 && (
              <Section title="CANCELLED REQUESTS">
                {cancelled.map((t) => <CancelledCard key={t.bookingId} trip={t} />)}
              </Section>
            )}
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{title}</Text>
      {children}
    </View>
  );
}

function SailingCard({ sailing, soon }: { sailing: Sailing; soon?: boolean }) {
  // Cargo bookings are parcels, not passengers — keep them out of the pax
  // count so the card reads honestly.
  const paxCount = sailing.bookings
    .filter((b) => b.status !== 'cancelled' && b.serviceType !== 'cargo')
    .reduce((sum, b) => sum + b.numOfPassenger, 0);
  return (
    <Pressable
      onPress={() =>
        router.push({
          pathname: '/(bangkero)/sailing',
          params: { day: sailing.day, from: sailing.from, to: sailing.to },
        })
      }
      accessibilityRole="button"
      accessibilityLabel={`${sailing.from} to ${sailing.to}, ${sailingDayLabel(sailing.day)}`}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.cardTop}>
        <Text style={styles.route} numberOfLines={1}>
          {sailing.from} → {sailing.to}
        </Text>
        <View style={[styles.chip, sailing.inProgress ? styles.chipLive : soon ? styles.chipSoon : styles.chipDone]}>
          <Text style={[styles.chipText, sailing.inProgress ? styles.chipTextLive : soon ? styles.chipTextSoon : styles.chipTextDone]}>
            {sailing.inProgress ? 'Active' : soon ? 'Upcoming' : 'Completed'}
          </Text>
        </View>
      </View>

      <Text style={styles.day}>{sailingDayLabel(sailing.day)}</Text>

      <View style={styles.metaRow}>
        <Text style={styles.meta}>
          {sailing.bookings.length} booking{sailing.bookings.length === 1 ? '' : 's'}
          {paxCount > 0 ? ` · ${paxCount} pax` : ''}
        </Text>
        {sailing.parcelCount > 0 && (
          <Text style={styles.meta}>· {sailing.parcelCount} parcel{sailing.parcelCount === 1 ? '' : 's'}</Text>
        )}
        {sailing.unpaidCount > 0 && (
          <Text style={styles.metaUnpaid}>· {sailing.unpaidCount} unpaid</Text>
        )}
      </View>

      <Text style={styles.openHint}>Tap for manifest, passengers &amp; parcels</Text>
    </Pressable>
  );
}

function CancelledCard({ trip }: { trip: BookingDoc }) {
  const [open, setOpen] = useState(false);
  const cancelledOn = new Date(trip.cancelledAt ?? trip.createdAt);
  return (
    <Pressable
      onPress={() => setOpen((v) => !v)}
      accessibilityRole="button"
      accessibilityLabel={`Cancelled booking ${trip.ref}`}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.cardTop}>
        <Text style={styles.cardRef} numberOfLines={1}>{trip.ref}</Text>
        <View style={[styles.chip, styles.chipCancelled]}>
          <Text style={[styles.chipText, styles.chipTextCancelled]}>Cancelled</Text>
        </View>
      </View>

      <Text style={styles.route} numberOfLines={1}>
        {trip.fromPortName} → {trip.toPortName}
      </Text>
      <Text style={styles.typeLine} numberOfLines={1}>{bookingTypeLabel(trip)}</Text>

      <View style={styles.metaRow}>
        <Text style={styles.meta}>
          {trip.scheduledDate ? sailingDayLabel(trip.scheduledDate) : cancelledOn.toLocaleDateString()}
        </Text>
        <Text style={styles.meta}>· ₱{trip.totalPrice}</Text>
      </View>

      {open && (
        <View style={styles.details}>
          <Text style={styles.detailLine}>Passengers: {trip.numOfPassenger}</Text>
          <Text style={styles.detailLine}>
            Cancelled: {cancelledOn.toLocaleString()}
          </Text>
          {!!trip.cancelReason && (
            <Text style={styles.detailLine}>Reason: {trip.cancelReason}</Text>
          )}
          <Text style={styles.detailHint}>
            This request never became a trip, so there is no manifest.
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  emptyBox: { minHeight: 220 },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 14, paddingVertical: spacing.md },

  section: { marginBottom: spacing.lg },
  sectionLabel: { ...typography.label, marginBottom: spacing.sm },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  cardPressed: { opacity: 0.8 },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.xs,
  },
  cardRef: { flexShrink: 1, ...typography.caption, color: colors.textMuted, fontSize: 11, letterSpacing: 0.5 },
  route: { flexShrink: 1, color: colors.text, fontSize: 15, fontWeight: '700' },
  typeLine: { ...typography.caption, color: colors.primary, fontWeight: '700', marginTop: 2 },

  chip: { paddingHorizontal: spacing.md, paddingVertical: 3, borderRadius: radii.pill },
  chipLive: { backgroundColor: colors.primaryTint },
  chipDone: { backgroundColor: colors.neutralTint },
  chipSoon: { backgroundColor: colors.warningTint },
  chipCancelled: { backgroundColor: colors.dangerTint },
  chipText: { flexShrink: 1, fontSize: 11, fontWeight: '700' },
  chipTextLive: { color: colors.primary },
  chipTextDone: { color: colors.textSecondary },
  chipTextSoon: { color: colors.warning },
  chipTextCancelled: { color: colors.danger },

  day: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  meta: { ...typography.caption, color: colors.textSecondary, fontSize: 12 },
  metaUnpaid: { ...typography.caption, color: colors.warning, fontSize: 12, fontWeight: '700' },
  openHint: { ...typography.caption, color: colors.textMuted, fontSize: 11, marginTop: spacing.sm },

  details: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    gap: spacing.xs,
  },
  detailLine: { ...typography.caption, color: colors.textSecondary },
  detailHint: { ...typography.caption, color: colors.textMuted, fontSize: 11, marginTop: spacing.xs },
});
