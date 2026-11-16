import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon } from './Icon';
import { PrimaryButton } from './PrimaryButton';
import { getPassengerDetailsByBooking } from '../services/passenger-detail.service';
import { BOOKER_KEY } from '../services/booking.service';
import { colors, elevation, radii, spacing, touchTarget, typography } from '../theme/tokens';
import type { BookingDoc, PassengerDetailDoc } from '../types/models';

interface Props {
  /** The booking being resolved — null keeps the sheet closed. */
  booking: BookingDoc | null;
  busy: boolean;
  onClose: () => void;
  /** Selection keys: BOOKER_KEY, or the companion's passenger detail id. */
  onConfirm: (missing: string[], companions: PassengerDetailDoc[]) => void;
}

/**
 * Who actually missed the boat. Only passengers NOT already aboard are
 * selectable; everyone left unticked is marked aboard by the service, so
 * ticking nobody is impossible and a scanned boarding can never be undone.
 * Ticking EVERY unboarded passenger cancels the whole booking as a no-show.
 */
export function PartyNoShowSheet({ booking, busy, onClose, onConfirm }: Props) {
  const [companions, setCompanions] = useState<PassengerDetailDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const bookingId = booking?.bookingId ?? null;
  useEffect(() => {
    if (!bookingId) return;
    let alive = true;
    setCompanions(null);
    setError(null);
    setSelected(new Set());
    getPassengerDetailsByBooking(bookingId)
      .then((rows) => {
        if (alive) setCompanions(rows);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : 'Could not load the party.');
      });
    return () => {
      alive = false;
    };
  }, [bookingId]);

  if (!booking) return null;

  const rows = companions ?? [];
  const openCompanions = rows.filter((c) => !c.boardedAt && !c.noShowAt);
  const bookerAboard = !!booking.onboardedAt;
  const bookerAbsent = !bookerAboard && !!booking.noShowAt;
  const abandonsEveryone =
    !bookerAboard &&
    !rows.some((c) => !!c.boardedAt) &&
    selected.has(BOOKER_KEY) &&
    openCompanions.every((c) => selected.has(c.passengerId));

  function toggle(key: string) {
    if (busy) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function row(
    key: string,
    name: string,
    sub: string,
    state: 'open' | 'aboard' | 'absent'
  ) {
    const ticked = selected.has(key);
    const disabled = state !== 'open' || busy;
    return (
      <Pressable
        key={key}
        onPress={() => toggle(key)}
        disabled={disabled}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: ticked, disabled }}
        accessibilityLabel={`${name}, ${state === 'aboard' ? 'aboard' : state === 'absent' ? 'already marked absent' : 'did not board'}`}
        style={({ pressed }) => [
          styles.row,
          ticked && styles.rowTicked,
          pressed && styles.rowPressed,
        ]}
      >
        <View
          style={[
            styles.checkbox,
            ticked && styles.checkboxOn,
            state === 'aboard' && styles.checkboxAboard,
          ]}
        >
          {ticked && <Icon name="check" size={14} color={colors.primaryText} />}
        </View>
        <View style={styles.rowBody}>
          <Text style={[styles.rowName, state !== 'open' && styles.rowNameMuted]} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.rowSub} numberOfLines={1}>
            {sub}
          </Text>
        </View>
        {state !== 'open' && (
          <Text style={state === 'aboard' ? styles.pillAboard : styles.pillAbsent}>
            {state === 'aboard' ? 'Aboard' : 'No-show'}
          </Text>
        )}
      </Pressable>
    );
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => !busy && onClose()}>
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => !busy && onClose()}
          accessibilityLabel="Close"
        />
        <View style={styles.card}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
            <Text style={styles.title}>Who didn’t board?</Text>
            <Text style={styles.subtitle} numberOfLines={2}>
              {booking.ref} · {booking.fromPortName} → {booking.toPortName}
            </Text>

            <View style={styles.list}>
              {companions === null && !error && (
                <Text style={styles.loading}>Loading the party…</Text>
              )}
              {!!error && <Text style={styles.error}>{error}</Text>}
              {companions !== null && (
                <>
                  {row(
                    BOOKER_KEY,
                    booking.passengerName ?? 'Booker',
                    `Booker · ${booking.numOfPassenger} pax`,
                    bookerAboard ? 'aboard' : bookerAbsent ? 'absent' : 'open'
                  )}
                  {rows.map((c) =>
                    row(
                      c.passengerId,
                      `${c.firstName} ${c.lastName}`,
                      'Companion',
                      c.boardedAt ? 'aboard' : c.noShowAt ? 'absent' : 'open'
                    )
                  )}
                </>
              )}
            </View>

            <Text style={styles.hint}>
              {abandonsEveryone
                ? 'Nobody is aboard this booking — it is cancelled as a no-show and the booker gets a short booking ban.'
                : 'Everyone you leave unticked is marked aboard. Passengers already aboard cannot be changed here.'}
            </Text>

            <PrimaryButton
              label={abandonsEveryone ? 'Cancel booking as no-show' : 'Mark no-show'}
              variant="danger"
              onPress={() => onConfirm([...selected], rows)}
              loading={busy}
              disabled={busy || selected.size === 0 || companions === null}
            />
            <Pressable
              onPress={() => !busy && onClose()}
              hitSlop={8}
              style={styles.closeBtn}
              accessibilityRole="button"
            >
              <Text style={styles.closeText}>Go back</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.bg,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    maxHeight: '86%',
    ...elevation.e3,
  },
  scroll: { padding: spacing.xl },
  title: { ...typography.h2 },
  subtitle: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xxs },

  list: { marginTop: spacing.lg, gap: spacing.sm },
  loading: { ...typography.caption, color: colors.textMuted, paddingVertical: spacing.md },
  error: { ...typography.caption, color: colors.danger, paddingVertical: spacing.md },
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
  },
  rowTicked: { borderColor: colors.danger, backgroundColor: colors.dangerTint },
  rowPressed: { opacity: 0.8 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.danger, borderColor: colors.danger },
  checkboxAboard: { backgroundColor: colors.surfaceAlt, borderColor: colors.borderSubtle },
  rowBody: { flex: 1, minWidth: 0 },
  rowName: { ...typography.bodyStrong },
  rowNameMuted: { color: colors.textMuted },
  rowSub: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  pillAboard: { ...typography.micro, color: colors.success, fontWeight: '700' },
  pillAbsent: { ...typography.micro, color: colors.danger, fontWeight: '700' },

  hint: { ...typography.caption, color: colors.textMuted, lineHeight: 18, marginVertical: spacing.lg },
  closeBtn: { minHeight: touchTarget, alignItems: 'center', justifyContent: 'center' },
  closeText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
});
