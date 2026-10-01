import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, typography } from '../theme/tokens';

// =============================================================
// Shared sailing-date picker (020). Today…+13 — 14 days total.
// The four fixed slots (7am/10am/1pm/5pm) are required only when
// the chosen date is in the future: same-day rides leave whenever
// a boat is ready, exactly like before.
// =============================================================

export const SLOTS = ['07:00', '10:00', '13:00', '17:00'] as const;

export function slotLabel(hhmm: string): string {
  const hour = parseInt(hhmm.slice(0, 2), 10);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:00 ${suffix}`;
}

/** YYYY-MM-DD in the device's local day. */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function todayIso(): string {
  return isoDay(new Date());
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface Props {
  date: string;
  time: string | null;
  onDate: (date: string) => void;
  onTime: (time: string | null) => void;
}

export function SchedulePicker({ date, time, onDate, onTime }: Props) {
  const days: { iso: string; dow: string; day: string; month: string; isToday: boolean }[] = [];
  const now = new Date();
  for (let i = 0; i < 14; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    days.push({
      iso: isoDay(d),
      dow: WEEKDAYS[d.getDay()],
      day: String(d.getDate()),
      month: MONTHS[d.getMonth()],
      isToday: i === 0,
    });
  }

  const advance = date > todayIso();

  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
        {days.map((d) => {
          const active = d.iso === date;
          return (
            <Pressable
              key={d.iso}
              onPress={() => {
                onDate(d.iso);
                // Slots belong to future sailings only — clear on same-day.
                if (d.iso <= todayIso()) onTime(null);
              }}
              accessibilityRole="button"
              accessibilityLabel={`${d.dow} ${d.month} ${d.day}${d.isToday ? ', today' : ''}`}
              style={({ pressed }) => [styles.day, active && styles.dayActive, pressed && !active && styles.pressed]}
            >
              <Text style={[styles.dayDow, active && styles.dayTextActive]}>{d.dow}</Text>
              <Text style={[styles.dayNum, active && styles.dayTextActive]}>{d.day}</Text>
              <Text style={[styles.dayMonth, active && styles.dayTextActive]}>{d.month}</Text>
              {d.isToday && <Text style={[styles.dayToday, active && styles.dayTodayActive]}>Today</Text>}
            </Pressable>
          );
        })}
      </ScrollView>

      {advance && (
        <View style={styles.slotsWrap}>
          <Text style={styles.slotLabel}>DEPARTURE TIME</Text>
          <View style={styles.slots}>
            {SLOTS.map((s) => {
              const active = time === s;
              return (
                <Pressable
                  key={s}
                  onPress={() => onTime(s)}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.slot, active && styles.slotActive, pressed && !active && styles.pressed]}
                >
                  <Text style={[styles.slotText, active && styles.slotTextActive]}>{slotLabel(s)}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { gap: spacing.sm, paddingVertical: spacing.xxs },

  day: {
    width: 58, alignItems: 'center', paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.borderSubtle,
  },
  dayActive: { backgroundColor: colors.primaryTint, borderColor: colors.primary },
  dayDow: { ...typography.caption, fontSize: 10, color: colors.textMuted, fontWeight: '600' },
  dayNum: { fontSize: 18, fontWeight: '700', color: colors.text, marginVertical: 1 },
  dayMonth: { fontSize: 10, color: colors.textMuted },
  dayToday: { fontSize: 9, fontWeight: '700', color: colors.primary, marginTop: 2 },
  dayTodayActive: { color: colors.primary },
  dayTextActive: { color: colors.primary },

  pressed: { opacity: 0.7 },

  slotsWrap: { marginTop: spacing.lg },
  slotLabel: { ...typography.label, marginBottom: spacing.sm },
  slots: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  slot: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    borderWidth: 1, borderColor: colors.borderSubtle,
    minHeight: 36, justifyContent: 'center',
  },
  slotActive: { backgroundColor: colors.primaryTint, borderColor: colors.primary },
  slotText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  slotTextActive: { color: colors.primary },
});
