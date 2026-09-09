import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { FilterChips } from '@/components/FilterChips';
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
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.back} onPress={() => router.back()}>← Back</Text>
        <Text style={styles.eyebrow}>HISTORY</Text>
        <Text style={styles.title}>Trip History</Text>

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
  back: { color: colors.primary, fontSize: 14, fontWeight: '600', marginBottom: spacing.lg },
  eyebrow: { ...typography.label, marginBottom: 2 },
  title: { ...typography.h1, marginBottom: spacing.lg },
  list: { gap: spacing.md },
  cardPress: { borderRadius: radii.md },
});
