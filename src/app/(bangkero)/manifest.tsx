import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { BangkeroScreenHeader } from '@/components/BangkeroScreenHeader';
import { ScreenContainer } from '@/components/ScreenContainer';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { useAuth } from '@/hooks/useAuth';
import { useBangkeroParcels } from '@/hooks/useBangkeroParcels';
import { useRealtimeQuery } from '@/hooks/useRealtimeQuery';
import { useMyTrips } from '@/hooks/useSupabase';
import { getPassengerDetailsByBooking } from '@/services/passenger-detail.service';
import { getPaymentsForBookings } from '@/services/payment.service';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import type { PassengerDetailDoc, PaymentDoc } from '@/types/models';
import {
  Sailing, buildSailings, sailingDayLabel, todayKey,
} from '@/utils/sailings';

/**
 * The manifest, restructured: the bangkero's work as SAILINGS —
 * bookings grouped by day + route, built live from bookings +
 * passenger details + parcels + payments (no schema change).
 * The sailing happening right now is pinned to the top; tapping one
 * opens the sailing detail (passengers, parcels, mark-as-paid).
 * Replaces the old flat passenger-list / all-passengers screens.
 */
export default function ManifestScreen() {
  const { user } = useAuth();
  const uid = user?.id ?? null;

  const trips = useMyTrips(uid);
  const parcels = useBangkeroParcels(uid);
  const [payments, setPayments] = useState<Record<string, PaymentDoc>>({});
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
      // unpaid badges stay as they were; focus/realtime retries
    }
  }, [tripIds]);
  useEffect(() => { void loadPayments(); }, [loadPayments]);
  useRealtimeQuery(loadPayments, [{ table: 'payments' }]);

  // Companion names for search, fetched from the search handler (not an
  // effect) so no new set-state-in-effect instance is introduced. Cleared
  // when the query clears; a trip arriving mid-search joins the cache on
  // the next keystroke.
  const [detailCache, setDetailCache] = useState<Record<string, PassengerDetailDoc[]>>({});
  const fetchSeq = useRef(0);
  async function fetchDetails(ids: string[]) {
    const seq = ++fetchSeq.current;
    const rows = await Promise.all(
      ids.map(async (id) => {
        try {
          return [id, await getPassengerDetailsByBooking(id)] as const;
        } catch {
          return [id, []] as const;
        }
      })
    );
    if (fetchSeq.current !== seq) return;
    setDetailCache(Object.fromEntries(rows));
  }
  function handleSearch(v: string) {
    setSearch(v);
    if (!v.trim() || tripIds.length === 0) {
      fetchSeq.current += 1;
      setDetailCache({});
      return;
    }
    void fetchDetails(tripIds);
  }

  const sailings = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? trips.data.filter((t) => {
          if ((t.passengerName ?? '').toLowerCase().includes(q)) return true;
          if (t.ref.toLowerCase().includes(q)) return true;
          if (
            parcels.data.some(
              (p) =>
                p.bookingId === t.bookingId &&
                p.receiverName.toLowerCase().includes(q)
            )
          ) {
            return true;
          }
          return (detailCache[t.bookingId] ?? []).some((c) =>
            `${c.firstName} ${c.lastName}`.toLowerCase().includes(q)
          );
        })
      : trips.data;
    return buildSailings(filtered, parcels.data, payments);
  }, [trips.data, parcels.data, payments, search, detailCache]);

  const inProgress = sailings.filter((s) => s.inProgress);
  const today = todayKey();
  const upcoming = sailings.filter((s) => !s.inProgress && s.day > today);
  const doneToday = sailings.filter((s) => !s.inProgress && s.day === today);
  const earlier = sailings.filter((s) => !s.inProgress && s.day < today);

  if (trips.loading) {
    return (
      <ScreenContainer padded={false}>
        <BangkeroScreenHeader eyebrow="MANIFEST" title="Manifest" />
        <View style={styles.center}><LoadingState label="Loading manifest…" /></View>
      </ScreenContainer>
    );
  }
  if (trips.error) {
    return (
      <ScreenContainer padded={false}>
        <BangkeroScreenHeader eyebrow="MANIFEST" title="Manifest" />
        <View style={styles.center}><ErrorState message={trips.error} /></View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padded={false}>
      <BangkeroScreenHeader eyebrow="MANIFEST" title="Manifest" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        <View style={styles.searchBar}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search passenger, companion, parcel, or ref…"
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={handleSearch}
          />
        </View>

        {sailings.length === 0 ? (
          <EmptyState
            icon="⛵"
            title={search ? 'No sailings found' : 'No sailings yet'}
            message={
              search
                ? 'Try a different name, parcel receiver, or booking reference.'
                : 'Accepted trips appear here grouped by route and day.'
            }
          />
        ) : (
          <>
            {inProgress.length > 0 && (
              <Section title="IN PROGRESS">
                {inProgress.map((s) => <SailingCard key={s.key} sailing={s} />)}
              </Section>
            )}
            {upcoming.length > 0 && (
              <Section title="UPCOMING">
                {upcoming.map((s) => <SailingCard key={s.key} sailing={s} upcoming />)}
              </Section>
            )}
            {doneToday.length > 0 && (
              <Section title="TODAY">
                {doneToday.map((s) => <SailingCard key={s.key} sailing={s} />)}
              </Section>
            )}
            {earlier.length > 0 && (
              <Section title="EARLIER">
                {earlier.map((s) => <SailingCard key={s.key} sailing={s} />)}
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

function SailingCard({ sailing, upcoming }: { sailing: Sailing; upcoming?: boolean }) {
  return (
    <Pressable
      onPress={() =>
        router.push({
          pathname: '/(bangkero)/sailing',
          params: { day: sailing.day, from: sailing.from, to: sailing.to },
        })
      }
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.cardTop}>
        <Text style={styles.route} numberOfLines={1}>
          {sailing.from} → {sailing.to}
        </Text>
        <View style={[styles.chip, sailing.inProgress ? styles.chipLive : upcoming ? styles.chipSoon : styles.chipDone]}>
          <Text style={[styles.chipText, sailing.inProgress ? styles.chipTextLive : upcoming ? styles.chipTextSoon : styles.chipTextDone]}>
            {sailing.inProgress ? 'In progress' : upcoming ? 'Upcoming' : 'Completed'}
          </Text>
        </View>
      </View>

      <Text style={styles.day}>{sailingDayLabel(sailing.day)}</Text>

      <View style={styles.metaRow}>
        <Text style={styles.meta}>
          {sailing.bookings.length} booking{sailing.bookings.length === 1 ? '' : 's'} · {sailing.pax} pax
        </Text>
        {sailing.parcelCount > 0 && (
          <Text style={styles.meta}>· {sailing.parcelCount} parcel{sailing.parcelCount === 1 ? '' : 's'}</Text>
        )}
        {sailing.unpaidCount > 0 && (
          <Text style={styles.metaUnpaid}>· {sailing.unpaidCount} unpaid</Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.lg,
  },
  searchIcon: { fontSize: 14, marginRight: spacing.sm },
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
  route: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '700' },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 3, borderRadius: radii.pill },
  chipLive: { backgroundColor: colors.primaryTint },
  chipDone: { backgroundColor: colors.neutralTint },
  chipSoon: { backgroundColor: colors.warningTint },
  chipText: { fontSize: 11, fontWeight: '700' },
  chipTextLive: { color: colors.primary },
  chipTextDone: { color: colors.textSecondary },
  chipTextSoon: { color: colors.warning },

  day: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.xs },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  meta: { ...typography.caption, color: colors.textSecondary, fontSize: 12 },
  metaUnpaid: { ...typography.caption, color: colors.warning, fontSize: 12, fontWeight: '700' },
});
