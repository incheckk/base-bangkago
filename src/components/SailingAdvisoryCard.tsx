import { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, TextInput, View } from 'react-native';

import { PrimaryButton } from './PrimaryButton';
import { friendlyError } from '../services/booking.service';
import { maybeAutoClearAdvisory, setSailingAdvisory } from '../services/advisory.service';
import { sailVerdict, STRAIT_POINT } from '../services/weather.service';
import { useLiveWeather } from '../hooks/useLiveWeather';
import { useSailingAdvisory } from '../hooks/useSailingAdvisory';
import { colors, radii, spacing } from '../theme/tokens';

const SOURCE_LABEL: Record<string, string> = {
  coastguard: 'Coastguard advisory',
  weather: 'Weather advisory',
  admin_override: 'Admin advisory',
};

const HOURS = 6;

/**
 * The strait's switch, shown to the coastguard and the admin. Suspending
 * cancels today's un-sailed trips and notifies everyone; resuming opens the
 * gates again.
 *
 * A weather-sourced suspension clears itself the moment the live strait
 * reading is back to 'good' — a manual suspension never does.
 */
export function SailingAdvisoryCard({ role = 'coastguard' }: {
  role?: 'coastguard' | 'admin';
}) {
  const { advisory, active, refresh } = useSailingAdvisory();
  const weather = useLiveWeather(STRAIT_POINT.lat, STRAIT_POINT.lon);

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verdict = weather.data ? sailVerdict(weather.data) : null;
  // A stale (offline) reading must never turn into a cancel-all prompt.
  const rough = verdict === 'rough' && !!weather.data && !weather.data.stale;
  const roughReason = weather.data
    ? `Rough sea: ${weather.data.windKmh} km/h wind${weather.data.waveM != null
      ? `, ${weather.data.waveM} m waves` : ''}`
    : '';

  useEffect(() => {
    if (!advisory?.active || advisory.source !== 'weather' || verdict !== 'good') return;
    maybeAutoClearAdvisory(true)
      .then((cleared) => { if (cleared) void refresh(); })
      .catch(() => {
        // The 6-hour expiry is the fallback; never block the screen on this.
      });
  }, [advisory?.active, advisory?.source, verdict, refresh]);

  async function submit(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      await setSailingAdvisory({
        suspended: next,
        reason: next ? reason.trim() : undefined,
        source: role === 'admin' ? 'admin_override' : 'coastguard',
        hours: HOURS,
      });
      await refresh();
      setOpen(false);
      setReason('');
    } catch (e) {
      setError(friendlyError(e));
    }
    setBusy(false);
  }

  function openSuspend() {
    if (rough && !reason.trim()) setReason(roughReason);
    setOpen(true);
  }

  // No row = migration 069 has not run yet. Hide the control instead of
  // offering a switch that can only fail.
  if (!advisory) return null;

  if (active) {
    const until = advisory?.expiresAt
      ? new Date(advisory.expiresAt).toLocaleTimeString('en-PH', {
        hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Manila',
      })
      : null;

    return (
      <View style={[styles.card, styles.cardOn]}>
        <Text style={styles.labelOn}>SAILING SUSPENDED</Text>
        <Text style={styles.reason}>{advisory?.reason ?? 'All trips on hold'}</Text>
        <Text style={styles.meta}>
          {SOURCE_LABEL[advisory?.source ?? 'coastguard'] ?? advisory?.source}
          {until ? ` · ends ${until}` : ' · no automatic end'}
        </Text>
        {!!error && <Text style={styles.error}>{error}</Text>}
        <PrimaryButton
          label={busy ? 'Resuming…' : 'Resume sailing'}
          variant="secondary"
          onPress={() => void submit(false)}
          loading={busy}
          style={styles.action}
        />
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.label}>SAILING OPEN</Text>
      <Text style={styles.hint}>
        Suspend when the sea is unsafe: today&apos;s trips that have not left the port are
        cancelled, bangkeros are told to stay in, and nobody can accept or sail.
      </Text>
      {rough && (
        <Text style={styles.rough}>
          {roughReason}. Suspend before anyone sails.
        </Text>
      )}
      <PrimaryButton
        label="Suspend sailing"
        variant="danger"
        onPress={openSuspend}
        style={styles.action}
      />

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Suspend all sailing?</Text>
            <Text style={styles.sheetHint}>
              Reason shown to bangkeros and passengers. Ends automatically after {HOURS} hours,
              or when you resume.
            </Text>
            <TextInput
              value={reason}
              onChangeText={setReason}
              placeholder="e.g. Rough sea, 2 m waves"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              multiline
            />
            {!!error && <Text style={styles.error}>{error}</Text>}
            <View style={styles.sheetActions}>
              <PrimaryButton
                label="Cancel"
                variant="secondary"
                onPress={() => setOpen(false)}
                style={styles.sheetBtn}
              />
              <PrimaryButton
                label="Suspend"
                variant="danger"
                onPress={() => void submit(true)}
                loading={busy}
                style={styles.sheetBtn}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
  },
  cardOn: { backgroundColor: colors.dangerTint, borderColor: colors.danger },

  label: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, color: colors.textMuted },
  labelOn: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, color: colors.danger },

  reason: { fontSize: 15, fontWeight: '600', color: colors.text, marginTop: spacing.xs },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  hint: { fontSize: 13, color: colors.textSecondary, lineHeight: 19, marginTop: spacing.xs },
  rough: { fontSize: 13, fontWeight: '600', color: colors.danger, lineHeight: 19, marginTop: spacing.sm },
  error: { fontSize: 12, color: colors.danger, marginTop: spacing.sm },

  action: { marginTop: spacing.md },

  overlay: {
    flex: 1,
    backgroundColor: colors.backdrop,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
  sheetHint: { fontSize: 13, color: colors.textSecondary, lineHeight: 19, marginTop: spacing.xs },
  input: {
    marginTop: spacing.md,
    minHeight: 72,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.md,
    padding: spacing.md,
    color: colors.text,
    fontSize: 15,
    textAlignVertical: 'top',
  },
  sheetActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  sheetBtn: { flex: 1 },
});
