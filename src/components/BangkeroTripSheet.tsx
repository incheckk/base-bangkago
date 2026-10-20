import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from './PrimaryButton';
import { todayIso } from './SchedulePicker';
import { StatusPill } from './StatusPill';
import { colors, elevation, radii, spacing, touchTarget, typography } from '../theme/tokens';
import type { BookingDoc } from '../types/models';

/**
 * The accept desk. Accepting no longer throws the bangkero into the boarding
 * scanner — this sheet shows the booking just accepted plus everything already
 * on the boat, sectioned so a solo ride is never confused with a group, and
 * the bangkero can keep accepting from the home list behind it.
 */

const isSameDay = (b: BookingDoc) => !b.scheduledDate || b.scheduledDate <= todayIso();

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (iso: string) => {
  const [, m, d] = iso.split('-').map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${d}`;
};

const MODE_LABEL: Record<string, string> = {
  accompanied: 'ACCOMPANIED',
  piggyback: 'PIGGYBACK',
  batched: 'BATCHED',
  solo: 'SOLO',
};

function typeOf(b: BookingDoc): string {
  if (b.serviceType === 'cargo') {
    return `PADALA${b.cargoMode ? ` · ${MODE_LABEL[b.cargoMode] ?? b.cargoMode.toUpperCase()}` : ''}`;
  }
  if (b.serviceType === 'rental') return 'CHARTER';
  return b.numOfPassenger === 1 ? 'SOLO' : `GROUP · ${b.numOfPassenger} pax`;
}

interface Props {
  visible: boolean;
  /** Accepted trips for today-or-earlier + the focus row (may be an advance). */
  trips: BookingDoc[];
  focusId: string | null;
  capacity: number | null;
  notifying: boolean;
  onClose: () => void;
  onNotify: () => void;
  onScan: (b: BookingDoc) => void;
  onSail: () => void;
}

export function BangkeroTripSheet({
  visible, trips, focusId, capacity, notifying, onClose, onNotify, onScan, onSail,
}: Props) {
  const focus = trips.find((t) => t.bookingId === focusId) ?? null;
  const dayTrips = trips.filter(isSameDay);
  const load = dayTrips.reduce((sum, t) => sum + t.numOfPassenger, 0);
  const solo = dayTrips.filter((t) => t.numOfPassenger === 1);
  const group = dayTrips.filter((t) => t.numOfPassenger > 1);
  const full = capacity !== null && load >= capacity;
  const focusIsAdvance = !!focus && !isSameDay(focus);

  const section = (title: string, rows: BookingDoc[]) =>
    rows.length > 0 ? (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          {title} · {rows.length}
        </Text>
        {rows.map((b) => (
          <View key={b.bookingId} style={[styles.row, b.bookingId === focusId && styles.rowFocus]}>
            <View style={styles.rowMain}>
              <Text style={styles.rowRef} numberOfLines={1}>
                {b.ref}
                {b.bookingId === focusId ? ' · just accepted' : ''}
              </Text>
              <Text style={styles.rowRoute} numberOfLines={1}>
                {b.fromPortName} → {b.toPortName}
              </Text>
            </View>
            <View style={styles.rowMeta}>
              <Text style={styles.rowType}>{typeOf(b)}</Text>
              <Text style={styles.rowPax}>{b.numOfPassenger} pax</Text>
            </View>
          </View>
        ))}
      </View>
    ) : null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={styles.card}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
            <View style={styles.topRow}>
              <View style={styles.topText}>
                <Text style={styles.title}>
                  {!focus ? 'Boat load' : focusIsAdvance ? 'Advance booking confirmed' : 'Trip accepted'}
                </Text>
                <Text style={styles.subtitle} numberOfLines={2}>
                  {focus
                    ? `${focus.ref} · ${focus.fromPortName} → ${focus.toPortName}`
                    : 'Your boat load'}
                </Text>
              </View>
              {focus && <StatusPill status={focus.status} />}
            </View>

            {focusIsAdvance ? (
              <View style={styles.advanceBox}>
                <Text style={styles.advanceTitle}>No boarding scan needed today</Text>
                <Text style={styles.advanceText}>
                  This trip sails{' '}
                  {focus?.scheduledDate ? shortDate(focus.scheduledDate) : 'on its date'}
                  {focus?.scheduledTime ? ` at ${focus.scheduledTime}` : ''}. Passengers scan on
                  board that morning — you can keep accepting bookings for today.
                </Text>
              </View>
            ) : (
              <>
                <View style={styles.loadBox}>
                  <View style={styles.loadHead}>
                    <Text style={styles.loadLabel}>BOAT LOAD</Text>
                    <Text style={[styles.loadValue, full && styles.loadValueFull]}>
                      {load}
                      {capacity !== null ? `/${capacity}` : ''} pax
                    </Text>
                  </View>
                  {capacity !== null && capacity > 0 && (
                    <View style={styles.barTrack}>
                      <View
                        style={[
                          styles.barFill,
                          { width: `${Math.min(100, Math.round((load / capacity) * 100))}%` },
                          full && styles.barFillFull,
                        ]}
                      />
                    </View>
                  )}
                  <Text style={styles.loadHint}>
                    {dayTrips.length} booking{dayTrips.length === 1 ? '' : 's'} ·{' '}
                    {solo.length} solo · {group.length} group. Close this sheet to accept more
                    same-route bookings.
                  </Text>
                </View>

                {section('SOLO BOOKINGS', solo)}
                {section('GROUP BOOKINGS', group)}
              </>
            )}

            <View style={styles.actions}>
              {!focusIsAdvance && dayTrips.length > 0 && (
                <>
                  <PrimaryButton
                    label="Notify passengers"
                    variant="secondary"
                    onPress={onNotify}
                    loading={notifying}
                  />
                  <View style={styles.gap} />
                  <PrimaryButton
                    label="Scan boarding QR"
                    variant="secondary"
                    onPress={() => {
                      const target = focus ?? dayTrips[0];
                      if (target) onScan(target);
                    }}
                  />
                  <View style={styles.gap} />
                  <PrimaryButton
                    label={full ? 'Ready to sail' : 'Sail now'}
                    onPress={onSail}
                  />
                  {!full && capacity !== null && (
                    <Text style={styles.sailHint}>
                      Boat not full ({load}/{capacity}) — you will be asked before sailing.
                    </Text>
                  )}
                </>
              )}
              <View style={styles.gap} />
              <Pressable onPress={onClose} hitSlop={8} style={styles.closeBtn}>
                <Text style={styles.closeText}>
                  {focus && !focusIsAdvance ? 'Keep accepting' : 'Close'}
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: spacing.lg },
  card: {
    backgroundColor: colors.bg,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    maxHeight: '86%',
    ...elevation.e3,
  },
  scroll: { padding: spacing.xl },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  topText: { flex: 1, minWidth: 0 },
  title: { ...typography.h2 },
  subtitle: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xxs },
  gap: { height: spacing.md },

  advanceBox: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  advanceTitle: { ...typography.bodyStrong, color: colors.text },
  advanceText: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },

  loadBox: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  loadHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  loadLabel: { ...typography.label, color: colors.textMuted },
  loadValue: { ...typography.h2, color: colors.primary },
  loadValueFull: { color: colors.success },
  barTrack: {
    height: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
    overflow: 'hidden',
    marginTop: spacing.sm,
  },
  barFill: { height: '100%', backgroundColor: colors.primary, borderRadius: radii.pill },
  barFillFull: { backgroundColor: colors.success },
  loadHint: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm },

  section: { marginTop: spacing.lg },
  sectionTitle: { ...typography.label, color: colors.textMuted, marginBottom: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    marginBottom: spacing.sm,
  },
  rowFocus: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
  rowMain: { flex: 1, minWidth: 0 },
  rowRef: { ...typography.bodyStrong },
  rowRoute: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  rowMeta: { alignItems: 'flex-end' },
  rowType: { ...typography.micro, color: colors.primary, fontSize: 10 },
  rowPax: { ...typography.caption, color: colors.textMuted, marginTop: 2 },

  actions: { marginTop: spacing.xl },
  sailHint: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm, textAlign: 'center' },
  closeBtn: { minHeight: touchTarget, alignItems: 'center', justifyContent: 'center' },
  closeText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
});
