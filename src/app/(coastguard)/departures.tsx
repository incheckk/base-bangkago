import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AdminScreenHeader } from '@/components/AdminScreenHeader';
import { ScreenContainer } from '@/components/ScreenContainer';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { WatchRow, WatchSection } from '@/components/WatchList';
import { useAllTrips } from '@/hooks/useAllTrips';
import { manilaTodayIso } from '@/utils/date';
import { colors, spacing } from '@/theme/tokens';

/**
 * Today's accepted trips, grouped per boat. `trip_stat` stays 'accepted'
 * through the whole sailing, so the phase is read from the timestamps:
 * depart_time set = at sea, onboarded_at set = boarding, neither = waiting.
 */
const PHASES = [
  { key: 'sea', label: 'AT SEA' },
  { key: 'boarding', label: 'BOARDING' },
  { key: 'waiting', label: 'WAITING' },
] as const;

export default function CoastguardDepartures() {
  const trips = useAllTrips('accepted');

  const groups = useMemo(() => {
    const today = manilaTodayIso();
    const todays = trips.data.filter(
      (b) => !b.scheduledDate || b.scheduledDate <= today
    );

    const byBoat = new Map<string, typeof todays>();
    for (const b of todays) {
      const boat = b.operatorBoatName ?? b.operatorName ?? 'Unassigned boat';
      const list = byBoat.get(boat) ?? [];
      list.push(b);
      byBoat.set(boat, list);
    }

    return [...byBoat.entries()]
      .map(([boat, rows]) => ({
        boat,
        operator: rows[0]?.operatorName ?? null,
        rows: rows.sort((a, b) => (a.scheduledTime ?? '').localeCompare(b.scheduledTime ?? '')),
        pax: rows.reduce((sum, b) => sum + (b.numOfPassenger ?? 0), 0),
        atSea: rows.some((b) => !!b.departTime),
      }))
      .sort((a, b) => Number(b.atSea) - Number(a.atSea) || a.boat.localeCompare(b.boat));
  }, [trips.data]);

  if (trips.loading) {
    return (
      <ScreenContainer>
        <AdminScreenHeader role="coastguard" title="Departures" showBack={false} />
        <LoadingState label="Loading departures…" />
      </ScreenContainer>
    );
  }

  if (trips.error) {
    return (
      <ScreenContainer>
        <AdminScreenHeader role="coastguard" title="Departures" showBack={false} />
        <ErrorState message={trips.error} />
      </ScreenContainer>
    );
  }

  const atSea = groups.filter((g) => g.atSea).length;

  return (
    <ScreenContainer padded={false}>
      <AdminScreenHeader
        role="coastguard"
        title="Departures"
        subtitle={`${atSea} at sea · ${groups.length} boat${groups.length === 1 ? '' : 's'} today`}
        showBack={false}
      />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {groups.length === 0 ? (
          <View style={styles.emptyBox}>
            <EmptyState
              icon="boat"
              title="Nothing sailing today"
              message="Accepted trips for today appear here as soon as a bangkero takes them."
            />
          </View>
        ) : (
          groups.map((g) => (
            <WatchSection
              key={g.boat}
              label={g.boat.toUpperCase()}
              meta={`${g.operator ?? '—'} · ${g.pax} pax`}
            >
              {g.rows.map((b, i) => {
                const phase = b.departTime ? 'sea' : b.onboardedAt ? 'boarding' : 'waiting';
                return (
                  <WatchRow
                    key={b.bookingId}
                    first={i === 0}
                    dot={
                      phase === 'sea' ? colors.primary
                        : phase === 'boarding' ? colors.warning
                          : colors.textMuted
                    }
                    title={`${b.fromPortName ?? '—'} → ${b.toPortName ?? '—'}`}
                    meta={[
                      b.ref,
                      `${b.numOfPassenger ?? 0} pax`,
                      b.serviceType === 'cargo' ? 'Padala' : null,
                      b.scheduledTime ? `slot ${b.scheduledTime}` : null,
                      PHASES.find((p) => p.key === phase)?.label,
                      b.departTime ? `left ${timeOf(b.departTime)}` : null,
                    ].filter(Boolean).join(' · ')}
                  />
                );
              })}
            </WatchSection>
          ))
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

function timeOf(value: string): string {
  // Manila clock for the watch officer, regardless of device timezone.
  return new Date(value).toLocaleTimeString('en-PH', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Manila',
  });
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.huge },
  emptyBox: { minHeight: 180, justifyContent: 'center' },
});
