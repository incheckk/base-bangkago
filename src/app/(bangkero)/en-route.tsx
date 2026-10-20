import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';

import { BangkeroScreenHeader } from '@/components/BangkeroScreenHeader';
import { MapContainer } from '@/components/MapContainer';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { EmptyState, LoadingState } from '@/components/States';
import { useAuth } from '@/hooks/useAuth';
import { useLockBack } from '@/hooks/useLockBack';
import { useDevFlags, usePorts } from '@/hooks/useSupabase';
import { useTripManifest } from '@/hooks/useTripManifest';
import { useVesselTracking } from '@/hooks/useVesselTracking';
import { stampManifestArrival } from '@/services/manifest.service';
import { createAlert } from '@/services/safety-alert.service';
import { getOutboxDepth, peekLastQueuedFix, type TrackFix } from '@/services/tracking.service';
import { formatDistance, haversineM } from '@/services/queue.service';
import { supabase } from '@/services/supabase';
import { colors, radii, spacing, typography } from '@/theme/tokens';

/*
 * The sailing screen — the phase between "Ready to Depart" and "Arrived".
 *
 * Sailing is a DERIVED state, not a new trip status: the trip is underway
 * while the manifest carries actual_departure_time and no
 * actual_arrival_time. Every timestamp here is stamped by a real tap, so
 * the offline demo replays honestly.
 *
 * The stuck-departure monitor: after 4 minutes of near-zero movement the
 * operator is asked "is there a problem?". No answer in 60s escalates to
 * a safety alert — unless the arrival-bypass demo switch is on, which
 * suppresses escalation (rehearsals must not pile up alerts) while still
 * letting the prompt itself be demoed.
 */

/** Movement under this over the window counts as "not moving". */
const STUCK_MAX_DISPLACEMENT_M = 100;
const STUCK_MAX_SPEED = 0.5; // m/s
const STUCK_WINDOW_MS = 4 * 60_000;
const STUCK_PROMPT_TIMEOUT_MS = 60_000;
const STUCK_REPROMPT_MS = 5 * 60_000;

/** Sampling cadence for the movement monitor (independent of the GPS watch). */
const STUCK_SAMPLE_MS = 60_000;

/** Outbox depth poll — how fast the RECORDING/OFFLINE chip reacts. */
const CHIP_POLL_MS = 10_000;

const DEFAULT_ROUTE_MINUTES = 30;

export default function EnRouteScreen() {
  // The manifest is finalised and the boat is at sea — nothing behind this
  // screen (departure/finalize) may be reached again. Hardware back is
  // absorbed; the header has no back arrow; home carries an ON TRIP banner.
  useLockBack();
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const ports = usePorts();
  const { manifest, loading } = useTripManifest(uid);
  const devFlags = useDevFlags();
  const arrivalBypass = devFlags.data.arrivalBypass;

  const bangkaId = manifest?.bangkaId ?? null;
  const sailing = !!manifest?.actualDepartureTime && !manifest.actualArrivalTime;

  // ---------- route estimate (ETA) ----------
  const [routeMins, setRouteMins] = useState<number | null>(null);
  const depPortId = manifest?.departurePortId ?? null;
  const arrPortId = manifest?.arrivalPortId ?? null;
  useEffect(() => {
    if (!depPortId || !arrPortId) return;
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase
          .from('routes')
          .select('estimated_minutes')
          .eq('start_port_id', depPortId)
          .eq('end_port_id', arrPortId)
          .maybeSingle();
        if (alive) setRouteMins(data?.estimated_minutes ?? DEFAULT_ROUTE_MINUTES);
      } catch {
        if (alive) setRouteMins(DEFAULT_ROUTE_MINUTES);
      }
    })();
    return () => {
      alive = false;
    };
  }, [depPortId, arrPortId]);

  // ---------- offline outbox chip ----------
  const [pending, setPending] = useState(0);
  useEffect(() => {
    if (!bangkaId) return;
    let alive = true;
    const tick = () => {
      getOutboxDepth(bangkaId)
        .then((n) => {
          if (alive) setPending(n);
        })
        .catch(() => {});
    };
    tick();
    const t = setInterval(tick, CHIP_POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [bangkaId]);

  // ---------- latest fix: newest server row vs newest queued fix ----------
  const { data: positions } = useVesselTracking(bangkaId);
  const [lastQueued, setLastQueued] = useState<TrackFix | null>(null);
  useEffect(() => {
    if (!bangkaId) return;
    let alive = true;
    const tick = () => {
      peekLastQueuedFix(bangkaId)
        .then((f) => {
          if (alive) setLastQueued(f);
        })
        .catch(() => {});
    };
    tick();
    const t = setInterval(tick, CHIP_POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [bangkaId]);

  // The server's newest fix and the local queue's newest fix race — the
  // later recordedAt wins. Offline, the queue IS the position.
  const latest = useMemo(() => {
    const server = positions[0] ?? null;
    const serverAt = server ? Date.parse(server.recordedAt) : 0;
    const queuedAt = lastQueued ? Date.parse(lastQueued.recordedAt) : 0;
    if (lastQueued && queuedAt >= serverAt) {
      return {
        latitude: lastQueued.lat,
        longitude: lastQueued.lng,
        recordedAt: lastQueued.recordedAt,
      };
    }
    return server
      ? { latitude: server.latitude, longitude: server.longitude, recordedAt: server.recordedAt }
      : null;
  }, [positions, lastQueued]);

  // ---------- progress + ETA ----------
  const depPort = depPortId ? ports.data.find((p) => p.portId === depPortId) : undefined;
  const arrPort = arrPortId ? ports.data.find((p) => p.portId === arrPortId) : undefined;
  const totalM =
    depPort?.latitude != null && depPort.longitude != null &&
    arrPort?.latitude != null && arrPort.longitude != null
      ? haversineM(depPort.latitude, depPort.longitude, arrPort.latitude, arrPort.longitude)
      : null;
  const coveredM =
    totalM != null && depPort?.latitude != null && depPort.longitude != null && latest
      ? haversineM(depPort.latitude, depPort.longitude, latest.latitude, latest.longitude)
      : null;
  const progress =
    totalM != null && totalM > 0 && coveredM != null ? Math.min(1, coveredM / totalM) : 0;
  const departTimeIso = manifest?.actualDepartureTime ?? null;
  const etaLabel = useMemo(() => {
    const departMs = departTimeIso ? Date.parse(departTimeIso) : null;
    if (departMs == null || routeMins == null) return null;
    const eta = departMs + routeMins * 60_000 * (1 - progress);
    return new Date(eta).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
  }, [departTimeIso, routeMins, progress]);
  const remainingLabel =
    totalM != null && coveredM != null ? formatDistance(Math.max(0, totalM - coveredM)) : null;

  // ---------- stuck-departure monitor ----------
  const firstFixRef = useRef<{ lat: number; lng: number; at: number } | null>(null);
  const lastPromptRef = useRef(0);
  const bypassRef = useRef(arrivalBypass);
  const bangkaRef = useRef<string | null>(null);
  useEffect(() => {
    bypassRef.current = arrivalBypass;
    bangkaRef.current = bangkaId;
  }, [arrivalBypass, bangkaId]);

  const promptStuck = useCallback(() => {
    let answered = false;
    Alert.alert(
      'Your boat has not moved in 4 minutes.',
      'Is there a problem?',
      [
        { text: 'Yes — we’re fine', onPress: () => { answered = true; } },
        {
          text: 'No — we need help',
          style: 'destructive',
          onPress: () => {
            answered = true;
            router.push('/(bangkero)/sos-alert');
          },
        },
      ],
    );
    // Nobody answered in 60s — the operator may be incapacitated. Auto-
    // escalate so "no response" is never "nothing happens". Demo mode
    // (arrival bypass) keeps rehearsals free of stray safety alerts.
    setTimeout(() => {
      if (answered || bypassRef.current) return;
      createAlert({
        message:
          'Boat has not moved since departure and the operator did not respond to the check-in prompt. Needs immediate contact.',
        severity: 'high',
        bangkaId: bangkaRef.current ?? undefined,
      }).catch(() => {
        // Offline at sea: the escalation is lost with the connection.
        // Queuing safety alerts offline is deferred (LAUNCH_DEFERRED).
      });
    }, STUCK_PROMPT_TIMEOUT_MS);
  }, []);

  useEffect(() => {
    if (!sailing) return;
    let alive = true;
    const sample = async () => {
      let pos: Location.LocationObject;
      try {
        pos = await Location.getCurrentPositionAsync({});
      } catch {
        return; // no GPS — cannot judge movement, skip this window
      }
      if (!alive) return;
      const at = Date.now();
      const { latitude, longitude, speed } = pos.coords;
      if (!firstFixRef.current) {
        firstFixRef.current = { lat: latitude, lng: longitude, at };
        return;
      }
      const first = firstFixRef.current;
      const elapsed = at - first.at;
      const displaced = haversineM(first.lat, first.lng, latitude, longitude);
      if (
        elapsed >= STUCK_WINDOW_MS &&
        at - lastPromptRef.current >= STUCK_REPROMPT_MS &&
        displaced < STUCK_MAX_DISPLACEMENT_M &&
        (speed ?? 0) < STUCK_MAX_SPEED
      ) {
        lastPromptRef.current = at;
        promptStuck();
      }
    };
    void sample();
    const t = setInterval(() => {
      void sample();
    }, STUCK_SAMPLE_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [sailing, promptStuck]);

  // ---------- arrival ----------
  const [arriving, setArriving] = useState(false);
  const handleArrive = useCallback(async () => {
    if (!manifest || arriving) return;
    setArriving(true);
    try {
      if (!manifest.actualArrivalTime) await stampManifestArrival(manifest);
    } catch {
      // Offline at the pier: arrived.tsx re-stamps on its next load
      // (idempotent), and Complete Trip shows the retry banner.
    }
    setArriving(false);
    router.push('/(bangkero)/arrived');
  }, [manifest, arriving]);

  // ---------- render ----------
  if (loading) {
    return (
      <ScreenContainer padded={false}>
        <BangkeroScreenHeader eyebrow="SAILING" title="En Route" showBack={false} />
        <LoadingState label="Loading your trip…" />
      </ScreenContainer>
    );
  }

  if (!sailing || !manifest) {
    return (
      <ScreenContainer padded={false}>
        <BangkeroScreenHeader eyebrow="SAILING" title="En Route" showBack={false} />
        <EmptyState
          icon="boat"
          title="No trip in progress"
          message="Sailing starts from Departure when you tap Ready to Depart."
        />
        <View style={styles.emptyAction}>
          <PrimaryButton
            label="Back to Home"
            variant="secondary"
            onPress={() => router.replace('/(bangkero)/home')}
          />
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padded={false}>
      <BangkeroScreenHeader eyebrow="SAILING" title="En Route" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <MapContainer
          ports={ports.data}
          fromPortId={manifest.departurePortId}
          toPortId={manifest.arrivalPortId}
          height={260}
          // Inside a ScrollView — the page keeps the vertical drag.
          draggable={false}
          vessels={
            latest
              ? [{ latitude: latest.latitude, longitude: latest.longitude, bangkaId: manifest.bangkaId }]
              : []
          }
        />

        {/* ---------- trip card ---------- */}
        <View style={styles.card}>
          <View style={styles.chipRow}>
            {pending > 0 ? (
              <View style={[styles.chip, styles.chipOffline]}>
                <Text style={styles.chipOfflineText}>OFFLINE · {pending} points saved</Text>
              </View>
            ) : (
              <View style={[styles.chip, styles.chipLive]}>
                <View style={styles.chipDot} />
                <Text style={styles.chipLiveText}>RECORDING</Text>
              </View>
            )}
            <Text style={styles.eta} numberOfLines={1}>
              {etaLabel ? `ETA ~${etaLabel}` : 'Calculating ETA…'}
            </Text>
          </View>

          <View style={styles.progressWrap}>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
            </View>
            <View style={styles.progressLabels}>
              <Text style={styles.progressPct}>{Math.round(progress * 100)}%</Text>
              {!!remainingLabel && (
                <Text style={styles.progressRemaining}>{remainingLabel} to {arrPort?.portName ?? 'destination'}</Text>
              )}
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Departed</Text>
            <Text style={styles.metaValue}>
              {manifest.actualDepartureTime
                ? new Date(manifest.actualDepartureTime).toLocaleTimeString('en-PH', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : '—'}
            </Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Aboard</Text>
            <Text style={styles.metaValue}>{manifest.totalPassengersOnBoard} pax</Text>
          </View>
          {!!latest && (
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Last fix</Text>
              <Text style={styles.metaValue}>
                {new Date(latest.recordedAt).toLocaleTimeString('en-PH', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Text>
            </View>
          )}
        </View>

        {arrivalBypass && (
          <Text
            onPress={handleArrive}
            style={styles.devChip}
            accessibilityRole="button"
          >
            DEV · Skip sailing →
          </Text>
        )}

        <View style={styles.footer}>
          <PrimaryButton
            label="I have arrived"
            onPress={() => void handleArrive()}
            loading={arriving}
            disabled={arriving}
          />
          <View style={{ height: spacing.md }} />
          <PrimaryButton
            label="SOS — Emergency help"
            variant="danger"
            onPress={() => router.push('/(bangkero)/sos-alert')}
          />
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: spacing.xxl },
  emptyAction: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl },

  card: {
    marginTop: spacing.lg,
    marginHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderWidth: 1,
  },
  chipLive: { backgroundColor: colors.primaryTint, borderColor: colors.primary },
  chipDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  chipLiveText: { ...typography.label, color: colors.primary, letterSpacing: 0 },
  chipOffline: { backgroundColor: colors.warningTint, borderColor: colors.warning },
  chipOfflineText: { ...typography.label, color: colors.warning, letterSpacing: 0 },
  eta: { flexShrink: 1, ...typography.caption, textAlign: 'right' },

  progressWrap: { marginTop: spacing.lg },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.bgElevated,
    overflow: 'hidden',
  },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: colors.primary },
  progressLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  progressPct: { ...typography.bodyStrong, color: colors.text },
  progressRemaining: { ...typography.caption, color: colors.textMuted },

  divider: { height: 1, backgroundColor: colors.borderSubtle, marginVertical: spacing.md },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xxs,
  },
  metaLabel: { color: colors.textSecondary, fontSize: 14 },
  metaValue: { color: colors.text, fontSize: 14, fontWeight: '600' },

  // Demo affordance — deliberately unmistakable, and only rendered
  // while the arrival-bypass switch is on (developer-options).
  devChip: {
    ...typography.label,
    color: colors.warning,
    backgroundColor: colors.warningTint,
    borderColor: colors.warning,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: radii.pill,
    textAlign: 'center',
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    overflow: 'hidden',
  },

  footer: { marginTop: spacing.xxl, paddingHorizontal: spacing.lg },
});
