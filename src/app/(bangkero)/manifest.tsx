import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { BangkeroScreenHeader } from '@/components/BangkeroScreenHeader';
import { ScreenContainer } from '@/components/ScreenContainer';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { useAuth } from '@/hooks/useAuth';
import { useBangkeroParcels } from '@/hooks/useBangkeroParcels';
import { useRealtimeQuery } from '@/hooks/useRealtimeQuery';
import { useMyTrips } from '@/hooks/useSupabase';
import { getPaymentsForBookings } from '@/services/payment.service';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import type { PaymentDoc } from '@/types/models';
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

  const sailings = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? trips.data.filter((t) =>
          (t.passengerName ?? '').toLowerCase().includes(q) ||
          t.ref.toLowerCase().includes(q)
        )
      : trips.data;
    return buildSailings(filtered, parcels.data, payments);
  }, [trips.data, parcels.data, payments, search]);

  const inProgress = sailings.filter((s) => s.inProgress);
  const today = todayKey();
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
            placeholder="Search by passenger or booking ref…"
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={setSearch}
          />
        </View>

        {sailings.length === 0 ? (
          <EmptyState
            icon="⛵"
            title={search ? 'No sailings found' : 'No sailings yet'}
            message={
              search
                ? 'Try a different passenger name or booking reference.'
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

function SailingCard({ sailing }: { sailing: Sailing }) {
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
        <View style={[styles.chip, sailing.inProgress ? styles.chipLive : styles.chipDone]}>
          <Text style={[styles.chipText, sailing.inProgress ? styles.chipTextLive : styles.chipTextDone]}>
            {sailing.inProgress ? 'In progress' : 'Completed'}
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
  chipText: { fontSize: 11, fontWeight: '700' },
  chipTextLive: { color: colors.primary },
  chipTextDone: { color: colors.textSecondary },

  day: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.xs },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  meta: { ...typography.caption, color: colors.textSecondary, fontSize: 12 },
  metaUnpaid: { ...typography.caption, color: colors.warning, fontSize: 12, fontWeight: '700' },
});
