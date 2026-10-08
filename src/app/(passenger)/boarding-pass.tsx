import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { PassengerScreenHeader } from '@/components/PassengerScreenHeader';
import { ScreenContainer } from '@/components/ScreenContainer';
import { ErrorState, LoadingState } from '@/components/States';
import { useBooking } from '@/hooks/useSupabase';
import { getPassengerDetailsByBooking } from '@/services/passenger-detail.service';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import type { PassengerDetailDoc } from '@/types/models';

/**
 * One QR per rider (020): the booker's code is the booking ref, every
 * companion's is 'PAX' + their qr_token. Accordion — one code at a time,
 * all collapsed by default, so the bangkero only faces the passenger
 * they are actually scanning.
 */
export default function BoardingPass() {
  const { bookingId } = useLocalSearchParams<{ bookingId?: string }>();
  const { data: booking, loading, error } = useBooking(bookingId ?? null);
  const [companions, setCompanions] = useState<PassengerDetailDoc[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (!bookingId) return;
    let alive = true;
    getPassengerDetailsByBooking(bookingId)
      .then((rows) => {
        if (alive) setCompanions(rows);
      })
      .catch((e) => {
        if (alive) setLoadError(e instanceof Error ? e.message : 'Could not load passengers.');
      });
    return () => {
      alive = false;
    };
  }, [bookingId]);

  if (loading) {
    return <ScreenContainer><LoadingState label="Loading boarding pass…" /></ScreenContainer>;
  }
  if (error || !booking) {
    return <ScreenContainer><ErrorState message={error ?? 'Booking not found.'} /></ScreenContainer>;
  }

  const bookerName = booking.passengerName ?? 'Booker';

  return (
    <ScreenContainer padded={false}>
      <PassengerScreenHeader title="Boarding QR Codes" showDrawer={false} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.hint}>
          Show each code to the bangkero at boarding. Everyone in the party must be scanned
          or ticked off before the trip starts.
        </Text>

        <PassengerQR
          name={bookerName}
          sublabel="You (booking ref)"
          value={booking.ref}
          open={openId === booking.ref}
          onToggle={() => setOpenId((prev) => (prev === booking.ref ? null : booking.ref))}
        />

        {companions.map((c) => (
          <PassengerQR
            key={c.passengerId}
            name={`${c.firstName} ${c.lastName}`}
            sublabel="Companion"
            value={`PAX${c.qrToken}`}
            open={openId === c.passengerId}
            onToggle={() => setOpenId((prev) => (prev === c.passengerId ? null : c.passengerId))}
          />
        ))}

        {companions.length === 0 && !loadError && (
          <Text style={styles.empty}>No companions on this booking — your code above covers everyone.</Text>
        )}
        {!!loadError && <ErrorState message={loadError} />}
      </ScrollView>
    </ScreenContainer>
  );
}

function PassengerQR({
  name,
  sublabel,
  value,
  open,
  onToggle,
}: {
  name: string;
  sublabel: string;
  value: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <View style={styles.card}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${name} boarding code`}
        style={styles.cardHead}
      >
        <View style={styles.cardHeadText}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          <Text style={styles.sublabel}>{sublabel}</Text>
        </View>
        <Text style={[styles.chevron, open && styles.chevronOpen]}>›</Text>
      </Pressable>
      {open && (
        <View style={styles.qrBox}>
          <View style={styles.qrWrap}>
            <QRCode value={value} size={132} backgroundColor="#FFFFFF" color="#0B1F2A" />
          </View>
          <Text style={styles.payload} numberOfLines={1}>{value}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.huge, gap: spacing.lg },

  hint: { ...typography.caption, color: colors.textMuted, lineHeight: 18 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cardHeadText: { flex: 1, minWidth: 0 },
  name: { ...typography.bodyStrong, fontSize: 16 },
  sublabel: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  chevron: { fontSize: 26, lineHeight: 28, fontWeight: '700', color: colors.textMuted },
  chevronOpen: { color: colors.primary, transform: [{ rotate: '90deg' }] },
  qrBox: { alignItems: 'center', gap: spacing.md, marginTop: spacing.lg },
  qrWrap: {
    backgroundColor: '#FFFFFF',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.sm,
  },
  payload: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 11,
    textAlign: 'center',
    letterSpacing: 1,
  },

  empty: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
});
