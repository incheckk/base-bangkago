import { router } from 'expo-router';
import { useState } from 'react';
import {
  Alert, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';

import { BangkeroScreenHeader } from '@/components/BangkeroScreenHeader';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { StatusCard } from '@/components/StatusCard';
import { useAuth } from '@/hooks/useAuth';
import { useSafetyAlerts } from '@/hooks/useSafetyAlerts';
import { useMyPortQueue, usePorts } from '@/hooks/useSupabase';
import { useTripManifest } from '@/hooks/useTripManifest';
import { friendlyError } from '@/services/booking.service';
import { getMyLastFix } from '@/services/queue.service';
import { createAlert } from '@/services/safety-alert.service';
import { getBangkaIdForBangkero } from '@/services/tracking.service';
import { colors, radii, spacing, typography } from '@/theme/tokens';

export default function SosAlertScreen() {
  const { profile, user } = useAuth();
  const uid = user?.id ?? null;

  // Port resolution: live queue row first (where the boat physically is),
  // then today's manifest departure port, else omit (port_id is nullable).
  // The old hardcoded 'p1' no longer exists since 021 reseeded the network,
  // which is exactly the FK violation in the bug report.
  const myQueue = useMyPortQueue(uid);
  const { manifest } = useTripManifest(uid);
  const ports = usePorts();
  const knownIds = new Set(ports.data.map((p) => p.portId));
  const queuePort = myQueue.data.entry?.portId ?? null;
  const manifestPort = manifest?.departurePortId ?? null;
  const valid = (id: string | null) => (id && knownIds.has(id) ? id : null);
  const resolvedPortId = valid(queuePort) ?? valid(manifestPort) ?? null;
  const resolvedPortName = resolvedPortId
    ? ports.data.find((p) => p.portId === resolvedPortId)?.portName ?? resolvedPortId
    : null;

  // Recent alerts unfiltered — filtering by a single (possibly null) port
  // would hide the bangkero's own history.
  const { data: alerts } = useSafetyAlerts(null);

  const [alertState, setAlertState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [sendError, setSendError] = useState<string | null>(null);

  // Mirror the admin System Alerts filter: resolved rows stay in the table
  // (is_resolved = true) but leave the active list, so a resolve in admin
  // visibly clears this screen too instead of looking stuck.
  const activeAlerts = alerts.filter((a) => !a.isResolved);
  const resolvedAlerts = alerts.filter((a) => a.isResolved);

  function handleSos() {
    Alert.alert(
      'Emergency SOS',
      'This will send an emergency alert to the coast guard and nearby vessels. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send Alert',
          style: 'destructive',
          onPress: async () => {
            setAlertState('sending');
            setSendError(null);
            try {
              const who = profile ? `${profile.firstName} ${profile.lastName}` : 'a bangkero';
              // Owned boat (satisfies safety_alerts_insert_bangkero RLS);
              // null falls back to the bangka-less port policy (005).
              const bangkaId = uid ? await getBangkaIdForBangkero(uid).catch(() => null) : null;
              // Fresh GPS so coast guard has location even when port is null.
              const fix = uid ? await getMyLastFix(uid).catch(() => null) : null;
              const where = resolvedPortName
                ? ` Near ${resolvedPortName}.`
                : queuePort ?? manifestPort
                  ? ' (port unknown).'
                  : ' (not queued — location below).';
              const gps = fix
                ? ` Last fix ${fix.latitude.toFixed(5)}, ${fix.longitude.toFixed(5)}.`
                : '';
              await createAlert({
                message: `Emergency SOS from ${who}.${where}${gps} Immediate assistance needed.`,
                severity: 'critical',
                bangkaId: bangkaId ?? undefined,
                portId: resolvedPortId ?? undefined,
              });
              setAlertState('sent');
            } catch (e) {
              setSendError(friendlyError(e));
              setAlertState('error');
            }
          },
        },
      ],
    );
  }

  return (
    <ScreenContainer padded={false}>
      <BangkeroScreenHeader title="SOS Alert" subtitle="EMERGENCY" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        <View style={styles.sosWrap}>
          <Pressable
            onPress={handleSos}
            disabled={alertState === 'sending'}
            style={({ pressed }) => [
              styles.sosButton,
              alertState === 'sent' && styles.sosSent,
              pressed && alertState === 'idle' && styles.sosPressed,
            ]}
          >
            <Text style={styles.sosText}>
              {alertState === 'sending' ? '…' : alertState === 'sent' ? '✓' : 'SOS'}
            </Text>
          </Pressable>
          <Text style={styles.sosLabel}>
            {alertState === 'sending'
              ? 'Sending alert…'
              : alertState === 'sent'
                ? 'Alert Sent'
                : resolvedPortName
                  ? `Tap to send emergency alert to coast guard (near ${resolvedPortName})`
                  : 'Tap to send emergency alert to coast guard'}
          </Text>
        </View>

        {alertState === 'sent' && (
          <View style={styles.sentBanner}>
            <Text style={styles.sentBannerText}>
              Emergency alert has been sent. Stay in position and await assistance.
            </Text>
          </View>
        )}

        {alertState === 'error' && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>
              {sendError ?? 'Failed to send alert. Try again.'}
            </Text>
          </View>
        )}

        {alerts.length === 0 ? (
          <Text style={styles.emptyLine}>No alerts yet — resolved and active alerts will appear here.</Text>
        ) : (
          <>
            <Text style={styles.sectionLabel}>
              ACTIVE ALERTS{activeAlerts.length > 0 ? ` · ${activeAlerts.length}` : ''}
            </Text>
            {activeAlerts.length === 0 ? (
              <Text style={styles.emptyLine}>You&apos;re clear — no active alerts.</Text>
            ) : (
              activeAlerts.map((a) => (
                <StatusCard
                  key={a.alertId}
                  title={a.severity.toUpperCase()}
                  message={a.message}
                  severity={a.severity}
                  timestamp={new Date(a.createdAt).toLocaleString()}
                />
              ))
            )}
            {resolvedAlerts.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>RESOLVED</Text>
                {resolvedAlerts.map((a) => (
                  <StatusCard
                    key={a.alertId}
                    title={a.severity.toUpperCase()}
                    message={a.message}
                    severity={a.severity}
                    timestamp={new Date(a.createdAt).toLocaleString()}
                    resolved
                  />
                ))}
              </>
            )}
          </>
        )}

        <View style={styles.footer}>
          <PrimaryButton
            label="Back to Home"
            variant="secondary"
            onPress={() => router.push('/(bangkero)/home')}
          />
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },

  sosWrap: { alignItems: 'center', marginVertical: spacing.xxl },
  sosButton: {
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  sosPressed: { opacity: 0.8 },
  sosSent: { backgroundColor: colors.primaryDark },
  sosText: { flexShrink: 1,
    color: colors.text,
    fontSize: 36,
    fontWeight: '900',
    letterSpacing: 2,
  },
  sosLabel: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    fontSize: 14,
  },

  sentBanner: {
    backgroundColor: colors.primaryTint,
    borderColor: colors.primary,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  sentBannerText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 20,
  },

  errorBanner: {
    backgroundColor: colors.dangerTint,
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  errorBannerText: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 20,
  },

  sectionLabel: { ...typography.label, marginTop: spacing.xl, marginBottom: spacing.md },
  emptyLine: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.sm },
  footer: { marginTop: spacing.xxl },
});
