import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AdminScreenHeader } from '@/components/AdminScreenHeader';
import { ScreenContainer } from '@/components/ScreenContainer';
import { StatusPill } from '@/components/StatusPill';
import { useAllTrips } from '@/hooks/useAllTrips';
import { getParcelByBooking } from '@/services/parcel.service';
import { getPassengerDetailsByBooking } from '@/services/passenger-detail.service';
import { supabase } from '@/services/supabase';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import { formatPhone } from '@/utils/phone';
import type { ParcelDoc, ParcelItemDoc, PassengerDetailDoc } from '@/types/models';

export default function AdminBookingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data } = useAllTrips();
  const booking = data.find((b) => b.bookingId === id);

  // Manifest: companions + the parcel and its item lines. RLS lets an admin
  // read all three (038, 064) — this is the safety/audit view of a trip.
  const [companions, setCompanions] = useState<PassengerDetailDoc[]>([]);
  const [parcel, setParcel] = useState<ParcelDoc | null>(null);
  const [items, setItems] = useState<ParcelItemDoc[]>([]);
  const [manifestLoading, setManifestLoading] = useState(true);
  const [manifestError, setManifestError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setManifestLoading(true);
    (async () => {
      try {
        const [people, cargo] = await Promise.all([
          getPassengerDetailsByBooking(id),
          getParcelByBooking(id),
        ]);
        let rows: ParcelItemDoc[] = [];
        if (cargo) {
          const { data: itemRows } = await supabase
            .from('parcel_items')
            .select('*')
            .eq('parcel_id', cargo.parcelId);
          rows = (itemRows ?? []).map((r: any) => ({
            itemId: r.id,
            itemName: r.item_name,
            quantity: r.quantity,
            kilogram: r.kilogram,
            parcelId: r.parcel_id,
          }));
        }
        if (!alive) return;
        setCompanions(people);
        setParcel(cargo);
        setItems(rows);
        setManifestError(null);
      } catch (e: any) {
        if (alive) setManifestError(e?.message ?? 'Could not load the manifest');
      } finally {
        if (alive) setManifestLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [id]);

  if (!booking) {
    return (
      <ScreenContainer>
        <AdminScreenHeader title="Booking" />
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>Booking not found</Text>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padded={false}>
      <AdminScreenHeader title="Booking Details" />

      <View style={styles.content}>
        <View style={styles.refRow}>
          <Text style={styles.ref}>{booking.ref}</Text>
          <StatusPill status={booking.status as any} />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>ROUTE</Text>
          <Text style={styles.route} numberOfLines={1}>{booking.fromPortName} → {booking.toPortName}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>PASSENGER</Text>
          <Text style={styles.info} numberOfLines={1}>{booking.passengerName ?? 'N/A'}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>OPERATOR</Text>
          <Text style={styles.info} numberOfLines={1}>{booking.operatorName ?? 'Not assigned'}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>DETAILS</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Passengers</Text>
            <Text style={styles.value}>{booking.numOfPassenger}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Total Fare</Text>
            <Text style={styles.valueAccent}>₱{booking.totalPrice}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Created</Text>
            <Text style={styles.value} numberOfLines={1}>
              {new Date(booking.createdAt).toLocaleDateString('en-PH', {
                month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
              })}
            </Text>
          </View>
          {booking.departTime && (
            <View style={styles.row}>
              <Text style={styles.label}>Departure</Text>
              <Text style={styles.value} numberOfLines={1}>
                {new Date(booking.departTime).toLocaleTimeString('en-PH', {
                  hour: '2-digit', minute: '2-digit',
                })}
              </Text>
            </View>
          )}
          {booking.arrivalTime && (
            <View style={styles.row}>
              <Text style={styles.label}>Arrival</Text>
              <Text style={styles.value} numberOfLines={1}>
                {new Date(booking.arrivalTime).toLocaleTimeString('en-PH', {
                  hour: '2-digit', minute: '2-digit',
                })}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>MANIFEST</Text>

          {manifestLoading ? (
            <Text style={styles.sub}>Loading manifest…</Text>
          ) : (
            <>
              {!!manifestError && <Text style={styles.error}>{manifestError}</Text>}

              <Text style={styles.subLabel}>PASSENGERS</Text>
              <View style={styles.row}>
                <Text style={styles.label}>Booker</Text>
                <Text style={styles.value} numberOfLines={1}>
                  {booking.passengerName ?? 'N/A'}
                </Text>
              </View>
              {!!booking.passengerPhone && (
                <View style={styles.row}>
                  <Text style={styles.label}>Contact</Text>
                  <Text style={styles.value} numberOfLines={1}>
                    {formatPhone(booking.passengerPhone)}
                  </Text>
                </View>
              )}
              {companions.map((c) => (
                <View key={c.passengerId} style={styles.manifestBlock}>
                  <Text style={styles.value} numberOfLines={1}>
                    {c.firstName} {c.lastName}
                    {c.age ? ` · ${c.age}` : ''}
                    {c.sex ? ` · ${c.sex}` : ''}
                    {c.noShowAt ? ' · NO-SHOW' : c.boardedAt ? ' · boarded' : ''}
                  </Text>
                  {!!c.contactNumber && (
                    <Text style={styles.sub} numberOfLines={1}>{formatPhone(c.contactNumber)}</Text>
                  )}
                  {!!c.address && <Text style={styles.sub} numberOfLines={1}>{c.address}</Text>}
                </View>
              ))}
              {companions.length === 0 && (
                <Text style={styles.sub}>No companions recorded on this booking.</Text>
              )}

              <Text style={[styles.subLabel, styles.subLabelGap]}>ITEMS / PARCELS</Text>
              {parcel ? (
                <>
                  <View style={styles.row}>
                    <Text style={styles.label}>Receiver</Text>
                    <Text style={styles.value} numberOfLines={1}>{parcel.receiverName}</Text>
                  </View>
                  {!!parcel.receiverContact && (
                    <View style={styles.row}>
                      <Text style={styles.label}>Contact</Text>
                      <Text style={styles.value} numberOfLines={1}>
                        {formatPhone(parcel.receiverContact)}
                      </Text>
                    </View>
                  )}
                  <View style={styles.row}>
                    <Text style={styles.label}>Mode</Text>
                    <Text style={styles.value} numberOfLines={1}>
                      {(parcel.deliveryType ?? 'accompanied').toUpperCase()} · {parcel.status}
                    </Text>
                  </View>
                  {parcel.totalWeightKg != null && (
                    <View style={styles.row}>
                      <Text style={styles.label}>Weight</Text>
                      <Text style={styles.value}>{parcel.totalWeightKg} kg</Text>
                    </View>
                  )}
                  {items.length === 0 ? (
                    <Text style={styles.sub}>No item lines recorded for this parcel.</Text>
                  ) : (
                    items.map((it) => (
                      <View key={it.itemId} style={styles.manifestBlock}>
                        <Text style={styles.value} numberOfLines={1}>
                          {it.itemName} × {it.quantity}
                        </Text>
                        <Text style={styles.sub}>{it.kilogram} kg</Text>
                      </View>
                    ))
                  )}
                </>
              ) : (
                <Text style={styles.sub}>No parcel on this booking.</Text>
              )}
            </>
          )}
        </View>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.md,
  },

  content: { paddingHorizontal: spacing.xl },

  refRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: spacing.xl,
  },
  ref: { flexShrink: 1, color: colors.textMuted, fontSize: 13, letterSpacing: 0.5 },

  card: {
    backgroundColor: colors.surface, borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.borderSubtle,
    padding: spacing.lg, marginBottom: spacing.md,
  },
  cardLabel: { ...typography.label, marginBottom: spacing.sm },
  route: { flexShrink: 1, color: colors.text, fontSize: 16, fontWeight: '700' },
  info: { flexShrink: 1, color: colors.textSecondary, fontSize: 14 },
  row: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  label: { color: colors.textSecondary, fontSize: 13 },
  value: { flexShrink: 1, color: colors.text, fontSize: 13, fontWeight: '600' },
  valueAccent: { flexShrink: 1, color: colors.warning, fontSize: 13, fontWeight: '700' },

  subLabel: { ...typography.label, color: colors.textMuted, marginBottom: spacing.xs },
  subLabelGap: { marginTop: spacing.lg },
  sub: { color: colors.textMuted, fontSize: 12, marginTop: spacing.xxs },
  error: { color: colors.danger, fontSize: 12, marginBottom: spacing.sm },
  manifestBlock: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },

  center: { flex: 1, paddingHorizontal: spacing.xl, paddingTop: spacing.lg },
  emptyTitle: { ...typography.h2, marginTop: spacing.xxl, textAlign: 'center' },
});
