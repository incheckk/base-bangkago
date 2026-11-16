import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';

import { BangkeroScreenHeader } from '@/components/BangkeroScreenHeader';
import { FilterChips } from '@/components/FilterChips';
import { Icon } from '@/components/Icon';
import { ScreenContainer } from '@/components/ScreenContainer';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { StatusPill } from '@/components/StatusPill';
import { useAuth } from '@/hooks/useAuth';
import { useMyTrips } from '@/hooks/useSupabase';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import type { BookingDoc } from '@/types/models';
import { sailingDayLabel } from '@/utils/sailings';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'waiting', label: 'Waiting' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
];

function matchesFilter(booking: BookingDoc, filter: string): boolean {
  if (filter === 'all') return true;
  if (filter === 'active') return booking.status === 'accepted';
  if (filter === 'waiting') return booking.status === 'open' || booking.status === 'pending';
  return booking.status === filter;
}

function travelDate(booking: BookingDoc): string {
  if (booking.scheduledDate) {
    return booking.scheduledTime
      ? `${sailingDayLabel(booking.scheduledDate)} - ${booking.scheduledTime}`
      : sailingDayLabel(booking.scheduledDate);
  }
  const date = new Date(booking.createdAt);
  if (Number.isNaN(date.getTime())) return booking.createdAt;
  return date.toLocaleDateString('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function paxCount(booking: BookingDoc): string {
  if (booking.serviceType === 'cargo') {
    return `${booking.numOfPassenger} parcel${booking.numOfPassenger === 1 ? '' : 's'}`;
  }
  return `${booking.numOfPassenger} pax`;
}

export default function ManageBookingsScreen() {
  const { user } = useAuth();
  const trips = useMyTrips(user?.id ?? null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return trips.data
      .filter((booking) => matchesFilter(booking, filter))
      .filter((booking) =>
        !q ||
        `${booking.ref} ${booking.passengerName ?? ''} ${booking.fromPortName ?? ''} ${booking.toPortName ?? ''}`
          .toLowerCase()
          .includes(q)
      )
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [trips.data, filter, search]);

  return (
    <ScreenContainer padded={false}>
      <BangkeroScreenHeader
        eyebrow="MANAGE BOOKINGS"
        title="Bookings"
        subtitle={`${filtered.length} booking${filtered.length === 1 ? '' : 's'}`}
      />

      <View style={styles.searchWrap}>
        <Icon name="search" size={18} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search booking ref, booker, or route"
          placeholderTextColor={colors.textMuted}
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>

      <View style={styles.chips}>
        <FilterChips filters={FILTERS} active={filter} onChange={setFilter} />
      </View>

      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {trips.loading ? (
          <LoadingState label="Loading bookings..." />
        ) : trips.error ? (
          <ErrorState message={trips.error} />
        ) : filtered.length === 0 ? (
          <View style={styles.emptyBox}>
            <EmptyState
              icon="bookings"
              title={search || filter !== 'all' ? 'Nothing matches' : 'No bookings yet'}
              message={
                search || filter !== 'all'
                  ? 'Try another reference, booker, or status.'
                  : 'Bookings assigned to your boat will appear here.'
              }
            />
          </View>
        ) : (
          filtered.map((booking) => (
            <BookingCard key={booking.bookingId} booking={booking} />
          ))
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

function BookingCard({ booking }: { booking: BookingDoc }) {
  const open = () =>
    router.push({
      pathname: '/(bangkero)/manage-bookings/[id]',
      params: { id: booking.bookingId },
    });

  return (
    <View style={styles.card}>
      <Pressable
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={`Open manifest for ${booking.ref}`}
        style={({ pressed }) => [styles.cardBody, pressed && styles.pressed]}
      >
        <View style={styles.cardTop}>
          <View style={styles.refWrap}>
            <Text style={styles.refLabel}>BOOKING REFERENCE</Text>
            <Text style={styles.ref}>{booking.ref}</Text>
          </View>
          <StatusPill status={booking.status} />
        </View>

        <Text style={styles.route} numberOfLines={1}>
          {booking.fromPortName || 'Unknown port'} to {booking.toPortName || 'Unknown port'}
        </Text>
        <Text style={styles.booker} numberOfLines={1}>
          {booking.passengerName || 'Unknown booker'}
        </Text>

        <View style={styles.metaRow}>
          <Text style={styles.meta} numberOfLines={1}>{travelDate(booking)}</Text>
          <Text style={styles.metaDot}>-</Text>
          <Text style={styles.meta}>{paxCount(booking)}</Text>
        </View>
      </Pressable>

      <Pressable
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={`View manifest for ${booking.ref}`}
        style={({ pressed }) => [styles.manifestBtn, pressed && styles.pressed]}
      >
        <Icon name="bookings" size={18} color={colors.primary} />
        <Text style={styles.manifestBtnText}>View Manifest</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.xl,
    paddingHorizontal: spacing.md,
    height: 44,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 14, paddingVertical: spacing.sm },
  chips: { paddingHorizontal: spacing.xl },
  list: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  emptyBox: { minHeight: 240 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  cardBody: { padding: spacing.lg, gap: spacing.xs },
  pressed: { opacity: 0.72 },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.xs,
  },
  refWrap: { flex: 1, minWidth: 0 },
  refLabel: { ...typography.label, fontSize: 10 },
  ref: { color: colors.text, fontSize: 17, fontWeight: '800', letterSpacing: 0.4 },
  route: { color: colors.text, fontSize: 15, fontWeight: '700' },
  booker: { ...typography.caption, color: colors.textSecondary },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs },
  meta: { flexShrink: 1, ...typography.caption, color: colors.textMuted, fontSize: 12 },
  metaDot: { color: colors.textMuted },

  manifestBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 46,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    backgroundColor: colors.bgElevated,
  },
  manifestBtnText: { color: colors.primary, fontSize: 14, fontWeight: '700' },
});
