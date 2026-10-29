import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AdminScreenHeader } from '@/components/AdminScreenHeader';
import { Icon } from '@/components/Icon';
import { ScreenContainer } from '@/components/ScreenContainer';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { WatchRow, WatchSection } from '@/components/WatchList';
import { WeatherCard } from '@/components/WeatherCard';
import { useAllPorts } from '@/hooks/useAllPorts';
import { useAllTrips } from '@/hooks/useAllTrips';
import { useAllPortQueues } from '@/hooks/useSupabase';
import { useSafetyAlerts } from '@/hooks/useSafetyAlerts';
import { useAuth } from '@/hooks/useAuth';
import { DWELL_MS } from '@/services/queue.service';
import { STRAIT_POINT } from '@/services/weather.service';
import type { AlertSeverity } from '@/types/models';
import { colors, elevation, numeric, radii, spacing, touchTarget, typography } from '@/theme/tokens';

const SEVERITY_COLOR: Record<AlertSeverity, string> = {
  low: colors.textMuted,
  medium: colors.warning,
  high: colors.danger,
  critical: colors.danger,
};

/** "3m ago" — alerts and last-seen times. */
function ago(iso: string, now: number): string {
  const min = Math.round((now - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  return `${Math.round(min / 60)}h ago`;
}

/**
 * Coastguard / LGU home: what is happening in the strait right now, then the
 * two things worth tapping. Each figure and preview opens its own tab, so
 * this stays a summary instead of a second copy of every list.
 */
export default function CoastguardHome() {
  const { profile } = useAuth();
  const ports = useAllPorts();
  const queues = useAllPortQueues();
  const trips = useAllTrips('accepted');
  const alerts = useSafetyAlerts(null);

  /**
   * One clock for the dwell countdowns and the alert ages. Reading Date.now()
   * during render is impure (React Compiler flags it) and the values only
   * need minute precision.
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  })();

  const portName = (id: string | null) =>
    id ? ports.data.find((p) => p.portId === id)?.portName ?? id : null;

  const waiting = useMemo(
    () => [...queues.data].sort(
      (a, b) => new Date(a.enteredAt).getTime() - new Date(b.enteredAt).getTime()
    ),
    [queues.data]
  );

  // trip_stat stays 'accepted' through the whole sailing; depart_time is the sea clock.
  const atSea = trips.data.filter((b) => !!b.departTime);
  const openAlerts = useMemo(
    () => alerts.data
      .filter((a) => !a.isResolved)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [alerts.data]
  );

  const STATS = [
    { label: 'Waiting', value: waiting.length, route: '/(coastguard)/queues', flag: undefined as string | undefined },
    { label: 'At sea', value: atSea.length, route: '/(coastguard)/departures', flag: undefined as string | undefined },
    {
      label: 'Alerts', value: openAlerts.length, route: '/(coastguard)/alerts',
      flag: openAlerts.length > 0 ? colors.danger : undefined,
    },
  ];

  return (
    <ScreenContainer padded={false}>
      {/* Outside the ScrollView: SideDrawer's overlay is absolute. */}
      <AdminScreenHeader
        eyebrow="COASTGUARD / LGU"
        title={`${greeting}, ${profile?.firstName ?? 'Officer'}`}
        showBack={false}
        right={
          <Pressable
            onPress={() => router.push('/(coastguard)/profile')}
            accessibilityRole="button"
            accessibilityLabel="Profile"
            style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
          >
            <Icon name="profile" size={20} color={colors.text} />
          </Pressable>
        }
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {queues.loading || trips.loading || alerts.loading ? (
          <View style={styles.stateBox}><LoadingState label="Reading the strait…" /></View>
        ) : queues.error ? (
          <View style={styles.stateBox}><ErrorState message={queues.error} /></View>
        ) : (
          <>
            <View style={styles.summary}>
              <View style={styles.statStrip}>
                {STATS.map((st, i) => (
                  <Pressable
                    key={st.label}
                    onPress={() => router.push(st.route as never)}
                    accessibilityRole="button"
                    accessibilityLabel={`${st.label}: ${st.value}`}
                    style={({ pressed }) => [styles.stat, pressed && styles.statPressed]}
                  >
                    {i > 0 && <View style={styles.statRule} />}
                    <Text style={styles.statValue} numberOfLines={1}>{st.value}</Text>
                    <View style={styles.statLabelRow}>
                      {!!st.flag && <View style={[styles.statDot, { backgroundColor: st.flag }]} />}
                      <Text style={styles.statLabel} numberOfLines={1}>{st.label}</Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={styles.weatherWrap}>
              <WeatherCard latitude={STRAIT_POINT.lat} longitude={STRAIT_POINT.lon} place="Mactan–Olango" />
            </View>

            {/* ---------- waiting now ---------- */}
            <View style={styles.sectionHead}>
              <Text style={styles.sectionLabel}>WAITING NOW</Text>
              <Pressable
                onPress={() => router.push('/(coastguard)/queues')}
                accessibilityRole="button"
                accessibilityLabel="Open port queues"
                hitSlop={8}
              >
                <Text style={styles.link}>Port queues ›</Text>
              </Pressable>
            </View>

            {waiting.length === 0 ? (
              <View style={styles.emptyBox}>
                <EmptyState
                  icon="anchor"
                  title="No boats waiting"
                  message="Boats appear here the moment they join a port queue."
                />
              </View>
            ) : (
              <WatchSection label="BOATS" meta={`${waiting.length}`}>
                {waiting.slice(0, 4).map((r, i) => {
                  const dwellLeft = DWELL_MS - (now - new Date(r.enteredAt).getTime());
                  return (
                    <WatchRow
                      key={r.queueId}
                      first={i === 0}
                      dot={r.isAvailable ? colors.primary : colors.textMuted}
                      title={r.displayName ?? 'Boat'}
                      meta={portName(r.portId) ?? 'Port'}
                      right={
                        <Text style={styles.rowStat} numberOfLines={1}>
                          {dwellLeft > 0 ? 'dwell' : 'ready'}
                        </Text>
                      }
                    />
                  );
                })}
              </WatchSection>
            )}

            {/* ---------- alerts ---------- */}
            <View style={styles.sectionHead}>
              <Text style={styles.sectionLabel}>SAFETY ALERTS</Text>
              <Pressable
                onPress={() => router.push('/(coastguard)/alerts')}
                accessibilityRole="button"
                accessibilityLabel="Open alerts"
                hitSlop={8}
              >
                <Text style={styles.link}>All alerts ›</Text>
              </Pressable>
            </View>

            {openAlerts.length === 0 ? (
              <Text style={styles.quiet}>No open alerts.</Text>
            ) : (
              <WatchSection label="OPEN" meta={`${openAlerts.length}`}>
                {openAlerts.slice(0, 3).map((a, i) => (
                  <WatchRow
                    key={a.alertId}
                    first={i === 0}
                    wrap
                    dot={SEVERITY_COLOR[a.severity]}
                    title={a.message}
                    meta={[a.severity.toUpperCase(), portName(a.portId), ago(a.createdAt, now)]
                      .filter(Boolean).join(' · ')}
                  />
                ))}
              </WatchSection>
            )}
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: spacing.huge, paddingHorizontal: spacing.xl },

  iconBtn: {
    width: touchTarget, height: touchTarget,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: radii.pill,
    backgroundColor: colors.scrim,
    borderWidth: 1, borderColor: colors.borderSubtle,
    ...elevation.e1,
  },
  iconBtnPressed: { backgroundColor: colors.surfaceAlt },

  stateBox: { minHeight: 240, justifyContent: 'center' },

  summary: {
    backgroundColor: colors.bgElevated,
    borderRadius: radii.lg,
    borderWidth: 1, borderColor: colors.borderSubtle,
    paddingVertical: spacing.lg,
    ...elevation.e1,
  },
  statStrip: { flexDirection: 'row' },
  stat: { flex: 1, alignItems: 'center', paddingVertical: spacing.xs, paddingHorizontal: spacing.sm },
  statPressed: { opacity: 0.6 },
  statRule: {
    position: 'absolute', left: 0, top: 4, bottom: 4,
    width: 1, backgroundColor: colors.borderSubtle,
  },
  statValue: { ...typography.h2, ...numeric },
  statLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  statDot: { width: 6, height: 6, borderRadius: radii.pill },
  statLabel: { ...typography.caption, color: colors.textMuted },

  weatherWrap: { marginTop: spacing.lg },

  sectionHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: spacing.md, marginTop: spacing.xl, marginBottom: spacing.sm,
  },
  sectionLabel: { ...typography.label },
  link: { ...typography.caption, color: colors.primary, fontWeight: '600' },

  rowStat: { flexShrink: 1, ...typography.label, ...numeric, letterSpacing: 0 },
  quiet: {
    ...typography.label, fontWeight: '400', letterSpacing: 0,
    color: colors.textMuted, lineHeight: 18, marginTop: spacing.sm,
  },
  emptyBox: { minHeight: 140, justifyContent: 'center' },
});
