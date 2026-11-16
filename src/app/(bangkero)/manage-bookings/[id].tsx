import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';

import { BangkeroScreenHeader } from '@/components/BangkeroScreenHeader';
import { PassengerEditModal } from '@/components/PassengerEditModal';
import { ScreenContainer } from '@/components/ScreenContainer';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { StatusPill } from '@/components/StatusPill';
import { useRealtimeQuery } from '@/hooks/useRealtimeQuery';
import { useBooking } from '@/hooks/useSupabase';
import { type BookerDetails, getBookersForBookings } from '@/services/booking.service';
import { getPassengerDetailsByBooking } from '@/services/passenger-detail.service';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import type { BookingDoc, PassengerDetailDoc } from '@/types/models';
import { formatPhone } from '@/utils/phone';
import { sailingDayLabel } from '@/utils/sailings';

function travelDate(booking: BookingDoc): string {
  if (booking.scheduledDate) {
    return booking.scheduledTime
      ? `${sailingDayLabel(booking.scheduledDate)} - ${booking.scheduledTime}`
      : sailingDayLabel(booking.scheduledDate);
  }
  const date = new Date(booking.createdAt);
  if (Number.isNaN(date.getTime())) return booking.createdAt;
  return date.toLocaleString('en-PH', {
    timeZone: 'Asia/Manila',
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function paxLabel(booking: BookingDoc): string {
  return booking.serviceType === 'cargo'
    ? `${booking.numOfPassenger} parcel${booking.numOfPassenger === 1 ? '' : 's'}`
    : `${booking.numOfPassenger} pax`;
}

export default function BookingManifestScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = typeof params.id === 'string' ? params.id : null;
  const booking = useBooking(id);

  const [companions, setCompanions] = useState<PassengerDetailDoc[]>([]);
  const [booker, setBooker] = useState<BookerDetails | null>(null);
  const [editing, setEditing] = useState<PassengerDetailDoc | null>(null);

  const loadDetails = useCallback(async () => {
    if (!booking.data) return;
    try {
      const [rows, bookers] = await Promise.all([
        getPassengerDetailsByBooking(booking.data.bookingId),
        getBookersForBookings([booking.data.userId]),
      ]);
      setCompanions(rows);
      setBooker(bookers[booking.data.userId] ?? null);
    } catch {
      // Keep the last known list; realtime/focus retries.
    }
  }, [booking.data]);

  useEffect(() => { void loadDetails(); }, [loadDetails]);
  useRealtimeQuery(
    loadDetails,
    booking.data
      ? [{ table: 'passenger_details' }, { table: 'users' }]
      : []
  );

  if (booking.loading) {
    return (
      <ScreenContainer padded={false}>
        <BangkeroScreenHeader eyebrow="MANIFEST" title="Booking" />
        <View style={styles.center}><LoadingState label="Loading manifest..." /></View>
      </ScreenContainer>
    );
  }

  if (booking.error) {
    return (
      <ScreenContainer padded={false}>
        <BangkeroScreenHeader eyebrow="MANIFEST" title="Booking" />
        <View style={styles.center}><ErrorState message={booking.error} /></View>
      </ScreenContainer>
    );
  }

  if (!booking.data) {
    return (
      <ScreenContainer padded={false}>
        <BangkeroScreenHeader eyebrow="MANIFEST" title="Booking" />
        <View style={styles.center}>
          <EmptyState
            icon="bookings"
            title="Booking not found"
            message="It may have been cancelled or removed."
          />
        </View>
      </ScreenContainer>
    );
  }

  const b = booking.data;
  const bookerName = b.passengerName || 'Unknown booker';

  return (
    <ScreenContainer padded={false}>
      <BangkeroScreenHeader
        eyebrow="MANIFEST"
        title={b.ref}
        subtitle={`${b.fromPortName || 'Unknown port'} to ${b.toPortName || 'Unknown port'}`}
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.summary}>
          <View style={styles.summaryTop}>
            <View style={styles.summaryTitle}>
              <Text style={styles.refLabel}>BOOKING REFERENCE</Text>
              <Text style={styles.ref}>{b.ref}</Text>
            </View>
            <StatusPill status={b.status} />
          </View>

          <View style={styles.grid}>
            <Info label="Route" value={`${b.fromPortName || '-'} to ${b.toPortName || '-'}`} />
            <Info label="Date" value={travelDate(b)} />
            <Info label="Booker" value={bookerName} />
            <Info label="Contact" value={formatPhone(b.passengerPhone || '') || '-'} />
            <Info label="Passengers" value={paxLabel(b)} />
            <Info label="Operator" value={b.operatorName || 'Unassigned'} />
          </View>
        </View>

        <Text style={styles.sectionLabel}>PASSENGERS</Text>
        <View style={styles.passengerCard}>
          <View style={styles.passengerTop}>
            <View style={styles.passengerTitle}>
              <Text style={styles.passengerName} numberOfLines={1}>{bookerName}</Text>
              <Text style={styles.passengerType}>Booker</Text>
            </View>
            <View style={[styles.boardedPill, b.onboardedAt ? styles.boardedYes : styles.boardedNo]}>
              <Text style={[styles.boardedText, b.onboardedAt ? styles.boardedTextYes : styles.boardedTextNo]}>
                {b.onboardedAt ? 'Boarded' : 'Not boarded'}
              </Text>
            </View>
          </View>
          <Text style={styles.passengerMeta}>
            {formatPhone(b.passengerPhone || '') || 'No contact number'}
            {booker?.age != null ? `  -  ${booker.age} yrs` : ''}
          </Text>
          <Text style={styles.passengerAddress} numberOfLines={2}>
            {booker?.address || 'Address not on file'}
          </Text>
        </View>

        <View style={styles.companionHeader}>
          <Text style={styles.sectionLabel}>
            COMPANIONS ({companions.length})
          </Text>
          {companions.length > 0 && (
            <Text style={styles.companionHint}>Tap a companion to edit or remove.</Text>
          )}
        </View>

        {companions.length === 0 ? (
          <View style={styles.noCompanions}>
            <Text style={styles.noCompanionsText}>No companions listed on this booking.</Text>
          </View>
        ) : (
          companions.map((passenger) => (
            <Pressable
              key={passenger.passengerId}
              onPress={() => setEditing(passenger)}
              accessibilityRole="button"
              accessibilityLabel={`Edit ${passenger.firstName} ${passenger.lastName}`}
              style={({ pressed }) => [styles.companionCard, pressed && styles.pressed]}
            >
              <View style={styles.passengerTop}>
                <View style={styles.passengerTitle}>
                  <Text style={styles.passengerName} numberOfLines={1}>
                    {passenger.firstName} {passenger.lastName}
                  </Text>
                  <Text style={styles.passengerType}>{passenger.passengerType}</Text>
                </View>
                <View style={[styles.boardedPill, passenger.boardedAt ? styles.boardedYes : styles.boardedNo]}>
                  <Text style={[styles.boardedText, passenger.boardedAt ? styles.boardedTextYes : styles.boardedTextNo]}>
                    {passenger.boardedAt ? 'Boarded' : 'Not boarded'}
                  </Text>
                </View>
              </View>
              <Text style={styles.passengerMeta}>
                {formatPhone(passenger.contactNumber || '') || 'No contact number'}
                {passenger.age != null ? `  -  ${passenger.age} yrs` : ''}
                {passenger.sex ? `  -  ${passenger.sex}` : ''}
              </Text>
              <Text style={styles.passengerAddress} numberOfLines={2}>
                {passenger.address || 'Address not on file'}
              </Text>
            </Pressable>
          ))
        )}

      </ScrollView>

      <PassengerEditModal
        visible={!!editing}
        passenger={editing}
        onClose={() => setEditing(null)}
        onChanged={() => void loadDetails()}
      />
    </ScreenContainer>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.info}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },

  summary: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  summaryTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  summaryTitle: { flex: 1, minWidth: 0 },
  refLabel: { ...typography.label, fontSize: 10 },
  ref: { color: colors.text, fontSize: 20, fontWeight: '800', letterSpacing: 0.4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.md },
  info: { width: '50%', paddingRight: spacing.sm },
  infoLabel: { ...typography.label, fontSize: 10, marginBottom: 2 },
  infoValue: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },

  sectionLabel: { ...typography.label, marginBottom: spacing.sm },
  passengerCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  companionHeader: { marginTop: spacing.md },
  companionHint: { ...typography.caption, color: colors.textMuted, fontSize: 11, marginTop: -spacing.xs, marginBottom: spacing.sm },
  companionCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  passengerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  passengerTitle: { flex: 1, minWidth: 0 },
  passengerName: { color: colors.text, fontSize: 15, fontWeight: '700' },
  passengerType: { ...typography.caption, color: colors.primary, fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
  passengerMeta: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  passengerAddress: { ...typography.caption, color: colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: 2 },

  boardedPill: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radii.pill },
  boardedYes: { backgroundColor: colors.successTint },
  boardedNo: { backgroundColor: colors.warningTint },
  boardedText: { fontSize: 10, fontWeight: '700' },
  boardedTextYes: { color: colors.success },
  boardedTextNo: { color: colors.warning },

  noCompanions: {
    backgroundColor: colors.bgElevated,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  noCompanionsText: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },

  pressed: { opacity: 0.72 },
});
