import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AdminScreenHeader } from '@/components/AdminScreenHeader';
import { MapContainer } from '@/components/MapContainer';
import { ScreenContainer } from '@/components/ScreenContainer';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { WatchRow, WatchSection, WatchValue } from '@/components/WatchList';
import { usePorts } from '@/hooks/useSupabase';
import { useAllVesselTracking, useFleetBoats } from '@/hooks/useVesselTracking';
import { FRESH_MS } from '@/services/queue.service';
import { colors, radii, spacing } from '@/theme/tokens';

/**
 * Where every boat is right now, from vessel_tracking. A fix older than the
 * dispatch freshness window is still shown but marked stale — "we last heard
 * from it 20 minutes ago" is the thing a watch officer needs to know.
 */
export default function CoastguardFleet() {
  const ports = usePorts();
  const tracking = useAllVesselTracking();
  const boats = useFleetBoats();

  // Freshness is relative to a ticking clock, not to render time.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const rows = useMemo(() => {
    const names = new Map(boats.data.map((b) => [b.bangkaId, b]));
    return tracking.data.map((v) => {
      const boat = names.get(v.bangkaId);
      const ageMs = now - new Date(v.recordedAt).getTime();
      return {
        ...v,
        boatName: boat?.bangkaName ?? 'Boat',
        operator: boat?.operatorName ?? null,
        capacity: boat?.capacity ?? 0,
        ageMs,
        live: ageMs <= FRESH_MS,
      };
    }).sort((a, b) => Number(b.live) - Number(a.live) || a.boatName.localeCompare(b.boatName));
  }, [tracking.data, boats.data, now]);

  const liveCount = rows.filter((r) => r.live).length;

  if (ports.loading || tracking.loading) {
    return (
      <ScreenContainer>
        <AdminScreenHeader role="coastguard" title="Fleet" showBack={false} />
        <LoadingState label="Loading fleet…" />
      </ScreenContainer>
    );
  }

  if (tracking.error) {
    return (
      <ScreenContainer>
        <AdminScreenHeader role="coastguard" title="Fleet" showBack={false} />
        <ErrorState message={tracking.error} />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padded={false}>
      <AdminScreenHeader
        role="coastguard"
        title="Fleet"
        subtitle={`${liveCount} reporting · ${rows.length} tracked`}
        showBack={false}
      />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.mapCard}>
          <MapContainer
            ports={ports.data}
            vessels={rows.map((r) => ({
              latitude: r.latitude,
              longitude: r.longitude,
              speed: r.speed,
              bangkaId: r.bangkaId,
            }))}
            height={240}
          />
        </View>

        {rows.length === 0 ? (
          <View style={styles.emptyBox}>
            <EmptyState
              icon="boat"
              title="No vessels tracked"
              message="Boats appear here once a bangkero starts reporting position."
            />
          </View>
        ) : (
          <WatchSection label="TRACKED BOATS" meta={`${rows.length}`}>
            {rows.map((r, i) => (
              <WatchRow
                key={r.trackId}
                first={i === 0}
                dot={r.live ? colors.primary : colors.warning}
                title={r.boatName}
                meta={[
                  r.operator,
                  r.capacity ? `${r.capacity} pax` : null,
                  r.live ? 'live' : `last seen ${minutesAgo(r.ageMs)}`,
                ].filter(Boolean).join(' · ')}
                right={
                  <WatchValue>
                    {r.speed !== null ? `${r.speed} kn` : '—'}
                  </WatchValue>
                }
              />
            ))}
          </WatchSection>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

function minutesAgo(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60000));
  if (min < 60) return `${min}m ago`;
  return `${Math.round(min / 60)}h ago`;
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.huge },
  mapCard: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    overflow: 'hidden',
  },
  emptyBox: { minHeight: 180, justifyContent: 'center' },
});
