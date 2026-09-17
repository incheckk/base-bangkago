import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { FilterChips } from '@/components/FilterChips';
import { PassengerScreenHeader } from '@/components/PassengerScreenHeader';
import { ScreenContainer } from '@/components/ScreenContainer';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { TicketCard } from '@/components/TicketCard';
import { useAuth } from '@/hooks/useAuth';
import { useRecentBookings } from '@/hooks/useSupabase';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import type { BookingDoc } from '@/types/models';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
];

export default function TripsScreen() {
  const { user } = useAuth();
  const { data, loading, error } = useRecentBookings(user?.id ?? null, 50);
  const [activeFilter, setActiveFilter] = useState('all');

  const filtered = data.filter((b) => {
    if (activeFilter === 'all') return b.status === 'completed' || b.status === 'cancelled';
    return b.status === activeFilter;
  });

  if (loading) {
    return (
      <ScreenContainer>
        <LoadingState label="Loading your trips…" />
      </ScreenContainer>
    );
  }

  if (error) {
    return (
      <ScreenContainer>
        <ErrorState message={error} />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padded={false}>
      <PassengerScreenHeader title="Trip History" subtitle="HISTORY" />

      <ScrollView contentContainerStyle={styles.scroll}>
        <FilterChips filters={FILTERS} active={activeFilter} onChange={setActiveFilter} />

        {filtered.length === 0 ? (
          <EmptyState
            icon="⚓"
            title="No trips yet"
            message="Your completed and cancelled trips will appear here."
          />
        ) : (
          <View style={styles.list}>
            {filtered.map((b) => (
              <Pressable
                key={b.bookingId}
                onPress={() => router.push(`/(passenger)/trip/${b.bookingId}`)}
                style={styles.cardPress}
              >
                <TicketCard booking={b} />
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl, flexGrow: 1 },
  list: { gap: spacing.md },
  cardPress: { borderRadius: radii.md },
});
