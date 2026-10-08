import { useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { AdminScreenHeader } from '@/components/AdminScreenHeader';
import { ScreenContainer } from '@/components/ScreenContainer';
import { LoadingState } from '@/components/States';
import { useDevFlags } from '@/hooks/useSupabase';
import { friendlyError } from '@/services/booking.service';
import { setArrivalBypass, setDispatchBypass, setGatesBypass } from '@/services/dev.service';
import { colors, radii, spacing, typography } from '@/theme/tokens';

const LIFTED = [
  'Port queue membership (any perimeter)',
  '5-minute queue dwell',
  '3-minute GPS freshness',
  'Route lock (trips to other destinations)',
  'Capacity fit-check',
];

const KEPT = [
  'Boat must be online (availability ON)',
  'Registered bangkero only',
  'Booking must still be open',
  '3-minute offer hold (one boat at a time)',
  '"Already passed on this request"',
];

/**
 * Admin-only demo switches (migrations 009 + 010). While ON, the FCFS
 * dispatch rules and/or the bangkero gates (documents + rating) are
 * lifted so the classroom demo can proceed — for the presentation only.
 * Lives here rather than in SQL because the professor watches the phone,
 * not the dashboard.
 */
export default function DeveloperOptions() {
  const flags = useDevFlags();
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const dispatchOn = flags.data.dispatchBypass;
  const gatesOn = flags.data.gatesBypass;
  const arrivalOn = flags.data.arrivalBypass;
  const on = dispatchOn || gatesOn || arrivalOn;

  async function toggle(which: 'dispatch' | 'gates' | 'arrival', next: boolean) {
    setBusy(which);
    setActionError(null);
    try {
      if (which === 'dispatch') await setDispatchBypass(next);
      else if (which === 'gates') await setGatesBypass(next);
      else await setArrivalBypass(next);
      flags.refresh();
    } catch (e) {
      setActionError(friendlyError(e));
    }
    setBusy(null);
  }

  return (
    <ScreenContainer padded={false}>
      <AdminScreenHeader
        eyebrow="ADMIN"
        title="Developer Options"
        subtitle="Demo tools"
      />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={[styles.banner, on ? styles.bannerOn : styles.bannerOff]}>
          <Text style={[styles.bannerTitle, { color: on ? colors.danger : colors.textSecondary }]}>
            {on ? 'DEMO MODE ACTIVE' : 'DEMO / DEVELOPMENT ONLY'}
          </Text>
          <Text style={styles.bannerText}>
            {on
              ? 'Demo rules are lifted. Turn everything off after the presentation — remove this screen before public launch.'
              : 'These switches exist only for presentations. Turn on to demo booking acceptance away from any port, or an unverified boat going online.'}
          </Text>
        </View>

        {flags.loading ? (
          <View style={styles.stateBox}><LoadingState label="Reading flags…" /></View>
        ) : (
          <View style={styles.card}>
            <View style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>Bypass FCFS dispatch rules</Text>
                <Text style={styles.rowHint}>
                  Lets any available bangkero accept an open request — no queue, dwell, GPS,
                  route lock or capacity checks.
                </Text>
              </View>
              <Switch
                value={dispatchOn}
                onValueChange={(next) => void toggle('dispatch', next)}
                disabled={busy !== null}
                trackColor={{ false: colors.border, true: colors.warningTint }}
                thumbColor={dispatchOn ? colors.warning : colors.surface}
              />
            </View>
            <Text style={[styles.rowStatus, { color: dispatchOn ? colors.danger : colors.textMuted }]}>
              {busy === 'dispatch'
                ? 'Saving…'
                : dispatchOn
                  ? 'ON — rules are lifted'
                  : 'OFF — normal FCFS dispatch'}
            </Text>

            <View style={styles.divider} />

            <View style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>Skip bangkero gates</Text>
                <Text style={styles.rowHint}>
                  Lifts the document verification + registered-boat requirement for going online,
                  and the documents + rating floor for receiving or accepting offers.
                </Text>
              </View>
              <Switch
                value={gatesOn}
                onValueChange={(next) => void toggle('gates', next)}
                disabled={busy !== null}
                trackColor={{ false: colors.border, true: colors.warningTint }}
                thumbColor={gatesOn ? colors.warning : colors.surface}
              />
            </View>
            <Text style={[styles.rowStatus, { color: gatesOn ? colors.danger : colors.textMuted }]}>
              {busy === 'gates'
                ? 'Saving…'
                : gatesOn
                  ? 'ON — gates are lifted'
                  : 'OFF — verification + rating enforced'}
            </Text>

            <View style={styles.divider} />

            <View style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>Bypass arrival close-out</Text>
                <Text style={styles.rowHint}>
                  Lets Complete Trip finish accepted bookings even when passengers were never
                  marked onboarded — for stage demos where boarding was skipped.
                </Text>
              </View>
              <Switch
                value={arrivalOn}
                onValueChange={(next) => void toggle('arrival', next)}
                disabled={busy !== null}
                trackColor={{ false: colors.border, true: colors.warningTint }}
                thumbColor={arrivalOn ? colors.warning : colors.surface}
              />
            </View>
            <Text style={[styles.rowStatus, { color: arrivalOn ? colors.danger : colors.textMuted }]}>
              {busy === 'arrival'
                ? 'Saving…'
                : arrivalOn
                  ? 'ON — unboarded trips can close out'
                  : 'OFF — onboarding enforced'}
            </Text>
          </View>
        )}

        {actionError && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{actionError}</Text>
          </View>
        )}

        <View style={styles.listsRow}>
          <View style={styles.listCard}>
            <Text style={[styles.listTitle, { color: colors.danger }]}>LIFTED WHILE ON</Text>
            {LIFTED.map((item) => (
              <View key={item} style={styles.listItem}>
                <Text style={[styles.bullet, { color: colors.danger }]}>×</Text>
                <Text style={styles.listText}>{item}</Text>
              </View>
            ))}
          </View>

          <View style={styles.listCard}>
            <Text style={[styles.listTitle, { color: colors.success }]}>STILL ENFORCED</Text>
            {KEPT.map((item) => (
              <View key={item} style={styles.listItem}>
                <Text style={[styles.bullet, { color: colors.success }]}>✓</Text>
                <Text style={styles.listText}>{item}</Text>
              </View>
            ))}
          </View>
        </View>

        <Text style={styles.footnote}>
          Server-enforced: the flag lives in the database (dev_flags), so every dispatch function
          checks it — the phone cannot fake a bypass on its own.
        </Text>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.huge, gap: spacing.lg },

  stateBox: { minHeight: 120 },

  banner: {
    borderRadius: radii.lg,
    borderWidth: 2,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  bannerOn: { backgroundColor: colors.dangerTint, borderColor: colors.danger },
  bannerOff: { backgroundColor: colors.surfaceAlt, borderColor: colors.borderSubtle },
  bannerTitle: { ...typography.label, fontWeight: '800' },
  bannerText: { ...typography.caption, color: colors.textSecondary, lineHeight: 18 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowText: { flex: 1, gap: spacing.xs },
  rowLabel: { ...typography.bodyStrong },
  rowHint: { ...typography.caption, color: colors.textSecondary, lineHeight: 16 },
  rowStatus: { ...typography.label, fontWeight: '700' },
  divider: {
    height: 1, backgroundColor: colors.borderSubtle,
    marginTop: spacing.md,
  },

  errorBox: {
    backgroundColor: colors.dangerTint,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.danger,
    padding: spacing.md,
  },
  errorText: { ...typography.caption, color: colors.danger },

  listsRow: { gap: spacing.lg },
  listCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  listTitle: { ...typography.label, fontWeight: '800', marginBottom: spacing.xs },
  listItem: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  bullet: { ...typography.bodyStrong, width: 14, textAlign: 'center' },
  listText: { ...typography.caption, color: colors.textSecondary, flex: 1, lineHeight: 18 },

  footnote: { ...typography.caption, color: colors.textMuted, lineHeight: 16 },
});
