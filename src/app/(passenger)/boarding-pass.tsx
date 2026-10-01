import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
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
 * companion's is 'PAX' + their qr_token. The bangkero scans them from
 * the boarding checklist — showing all of them here keeps the whole
 * party on one screen.
 */
export default function BoardingPass() {
  const { bookingId } = useLocalSearchParams<{ bookingId?: string }>();
  const { data: booking, loading, error } = useBooking(bookingId ?? null);
  const [companions, setCompanions] = useState<PassengerDetailDoc[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

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

        <PassengerQR name={bookerName} sublabel="You (booking ref)" value={booking.ref} />

        {companions.map((c) => (
          <PassengerQR
            key={c.passengerId}
            name={`${c.firstName} ${c.lastName}`}
            sublabel="Companion"
            value={`PAX${c.qrToken}`}
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

function PassengerQR({ name, sublabel, value }: { name: string; sublabel: string; value: string }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={styles.cardHeadText}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          <Text style={styles.sublabel}>{sublabel}</Text>
        </View>
        <View style={styles.qrWrap}>
          <QRCode value={value} size={132} backgroundColor="#FFFFFF" color="#0B1F2A" />
        </View>
      </View>
      <Text style={styles.payload} numberOfLines={1}>{value}</Text>
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
    marginTop: spacing.md,
    letterSpacing: 1,
  },

  empty: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
});
