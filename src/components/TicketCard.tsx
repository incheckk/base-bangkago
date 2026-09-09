import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing } from '../theme/tokens';
import { StatusPill } from './StatusPill';
import type { BookingDoc } from '../types/models';

interface Props {
  booking: BookingDoc;
  compact?: boolean;
}

export function TicketCard({ booking, compact = false }: Props) {
  return (
    <View style={[styles.card, compact && styles.compact]}>
      <View style={styles.topRow}>
        <Text style={styles.ref}>{booking.ref}</Text>
        <StatusPill status={booking.status} />
      </View>
      <View style={styles.routeRow}>
        <Text style={styles.port}>{booking.fromPortName}</Text>
        <Text style={styles.arrow}>→</Text>
        <Text style={styles.port}>{booking.toPortName}</Text>
      </View>
      {!compact && (
        <View style={styles.details}>
          <Text style={styles.detail}>{booking.numOfPassenger} pax</Text>
          <Text style={styles.detail}>·</Text>
          <Text style={styles.detail}>₱{booking.totalPrice}</Text>
          {booking.operatorName && (
            <>
              <Text style={styles.detail}>·</Text>
              <Text style={styles.detail}>{booking.operatorName}</Text>
            </>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
  },
  compact: { padding: spacing.md },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  ref: { color: colors.textMuted, fontSize: 11, letterSpacing: 0.5 },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  port: { color: colors.text, fontSize: 15, fontWeight: '700' },
  arrow: { color: colors.primary, fontSize: 15, fontWeight: '700' },
  details: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  detail: { color: colors.textSecondary, fontSize: 13 },
});
