import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ScrollView, StyleSheet, Text, View,
} from 'react-native';

import { BangkeroScreenHeader } from '@/components/BangkeroScreenHeader';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { useTripManifest } from '@/hooks/useTripManifest';
import { useAuth } from '@/hooks/useAuth';
import {
  getParcelsForBangkero, updateParcelStatus,
} from '@/services/parcel.service';
import { friendlyError } from '@/services/booking.service';
import { createNotification } from '@/services/notification.service';
import { supabase } from '@/services/supabase';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import type { ParcelDoc, ParcelStatus } from '@/types/models';

const NEXT_STATUS: Partial<Record<ParcelStatus, { label: string; next: ParcelStatus }>> = {
  pending: { label: 'Mark In Transit', next: 'in_transit' },
  in_transit: { label: 'Mark Delivered', next: 'delivered' },
};

export default function ArrivedScreen() {
  const { user } = useAuth();
  const { manifest, passengers, loading } = useTripManifest(user?.id ?? null);

  const [completing, setCompleting] = useState(false);
  const [parcels, setParcels] = useState<ParcelDoc[]>([]);
  const [parcelBusy, setParcelBusy] = useState<string | null>(null);
  const [parcelError, setParcelError] = useState<string | null>(null);

  const departureTime = manifest?.actualDepartureTime
    ? new Date(manifest.actualDepartureTime)
    : null;
  const now = new Date();
  const durationMin = departureTime
    ? Math.round((now.getTime() - departureTime.getTime()) / 60000)
    : null;

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await getParcelsForBangkero(user.id);
        if (!cancelled) setParcels(rows);
      } catch {
        if (!cancelled) setParcels([]);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  async function advanceParcel(parcel: ParcelDoc) {
    const step = NEXT_STATUS[parcel.status];
    if (!step || parcelBusy) return;
    setParcelBusy(parcel.parcelId);
    setParcelError(null);
    try {
      await updateParcelStatus(parcel.parcelId, step.next);
      setParcels((prev) =>
        prev.map((p) => (p.parcelId === parcel.parcelId ? { ...p, status: step.next } : p))
      );
    } catch (e) {
      setParcelError(friendlyError(e));
    }
    setParcelBusy(null);
  }

  async function handleComplete() {
    setCompleting(true);
    if (user?.id) {
      supabase
        .from('bookings')
        .select('id, ref, user_id')
        .eq('operator_id', user.id)
        .eq('trip_stat', 'accepted')
        .then(({ data }) => {
          (data ?? []).forEach((b) => {
            if (b.user_id) {
              createNotification(
                b.user_id,
                'Arrived at Destination',
                `Boat for trip ${b.ref} has arrived. Please disembark.`
              ).catch(() => {});
            }
          });
        });
    }
    setTimeout(() => {
      router.push('/(bangkero)/post-trip');
    }, 800);
  }

  return (
    <ScreenContainer padded={false}>
      <BangkeroScreenHeader title="Arrived" showDrawer={false} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        <View style={styles.hero}>
          <View style={styles.checkCircle}>
            <Text style={styles.checkIcon}>✓</Text>
          </View>
          <Text style={styles.title}>Arrived at Destination</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {durationMin !== null ? `Trip duration: ${durationMin} minutes` : 'Trip completed'}
          </Text>
        </View>

        {loading ? (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderText}>Loading trip details…</Text>
          </View>
        ) : (
          <>
            <Text style={styles.sectionLabel}>DISEMBARKATION</Text>
            <View style={styles.card}>
              <View style={styles.cardRow}>
                <Text style={styles.cardLabel}>Passengers</Text>
                <Text style={styles.cardValue}>{passengers.length} to disembark</Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.cardRow}>
                <Text style={styles.cardLabel}>Status</Text>
                <Text style={[styles.cardValue, styles.statusPending]}>Pending</Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.cardRow}>
                <Text style={styles.cardLabel}>Parcels</Text>
                <Text style={styles.cardValue}>{parcels.length} to unload</Text>
              </View>
            </View>

            {parcels.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>PARCEL DELIVERY</Text>
                {parcelError && (
                  <View style={styles.banner}>
                    <Text style={styles.bannerText}>{parcelError}</Text>
                  </View>
                )}
                {parcels.map((p) => {
                  const step = NEXT_STATUS[p.status];
                  return (
                    <View key={p.parcelId} style={styles.parcelCard}>
                      <View style={styles.parcelTop}>
                        <Text style={styles.parcelName}>{p.receiverName}</Text>
                        <Text style={[
                          styles.parcelStatus,
                          p.status === 'delivered' && styles.parcelStatusOk,
                          p.status === 'returned' && styles.parcelStatusBad,
                        ]}>
                          {p.status.replace('_', ' ')}
                        </Text>
                      </View>
                      <Text style={styles.parcelMeta}>₱{p.totalPrice}</Text>
                      {step && (
                        <PrimaryButton
                          label={step.label}
                          onPress={() => advanceParcel(p)}
                          loading={parcelBusy === p.parcelId}
                          disabled={!!parcelBusy}
                          style={styles.parcelBtn}
                        />
                      )}
                    </View>
                  );
                })}
              </>
            )}

            <View style={styles.footer}>
              <PrimaryButton
                label="Complete Trip"
                onPress={handleComplete}
                loading={completing}
                disabled={completing}
              />
              <View style={{ height: spacing.md }} />
              <PrimaryButton
                label="View Summary"
                variant="secondary"
                onPress={() => router.push('/(bangkero)/trips')}
              />
            </View>
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  hero: {
    alignItems: 'center',
    marginVertical: spacing.xxl,
  },
  checkCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  checkIcon: {
    color: colors.text,
    fontSize: 36,
    fontWeight: '700',
  },
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  subtitle: { flexShrink: 1,
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },

  placeholder: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.xl,
    alignItems: 'center',
  },
  placeholderText: { color: colors.textMuted, fontSize: 14 },

  sectionLabel: { ...typography.label, marginBottom: spacing.md },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  cardLabel: { color: colors.textSecondary, fontSize: 14 },
  cardValue: { flexShrink: 1, color: colors.text, fontSize: 14, fontWeight: '600' },
  statusPending: { color: colors.warning },
  divider: { height: 1, backgroundColor: colors.borderSubtle },

  banner: {
    backgroundColor: colors.dangerTint,
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  bannerText: { flexShrink: 1, color: colors.danger, fontSize: 13, lineHeight: 18 },

  parcelCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  parcelTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  parcelName: { flexShrink: 1, color: colors.text, fontSize: 15, fontWeight: '700' },
  parcelStatus: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.warning,
    textTransform: 'uppercase',
  },
  parcelStatusOk: { color: colors.primary },
  parcelStatusBad: { color: colors.danger },
  parcelMeta: { flexShrink: 1, ...typography.caption, color: colors.textMuted, marginBottom: spacing.md },
  parcelBtn: { marginTop: spacing.xs },

  footer: { marginTop: spacing.xxl },
});
