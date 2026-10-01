import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PassengerScreenHeader } from '@/components/PassengerScreenHeader';
import { PrimaryButton } from '@/components/PrimaryButton';
import { SchedulePicker, todayIso } from '@/components/SchedulePicker';
import { ScreenContainer } from '@/components/ScreenContainer';
import { ErrorState, LoadingState } from '@/components/States';
import { useAuth } from '@/hooks/useAuth';
import { usePorts } from '@/hooks/useSupabase';
import { friendlyError, getActiveBooking, getBookingBan } from '@/services/booking.service';
import { getIslandPackage } from '@/services/island-package.service';
import type { IslandPackageDoc } from '@/types/models';
import { colors, radii, spacing, typography } from '@/theme/tokens';

/**
 * Package booking: pax count only — everyone rides under the booker's
 * name (no companion form; LAUNCH note). The itinerary's first→last
 * ports become the booking's route, so nothing downstream changes.
 * Money: total = price × pax, 50% GCash escrow now, rest onboard.
 */
export default function BookPackage() {
  const { profile } = useAuth();
  const params = useLocalSearchParams<{ packageId?: string }>();
  const ports = usePorts();

  const [pkg, setPkg] = useState<IslandPackageDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pax, setPax] = useState(1);
  const [scheduledDate, setScheduledDate] = useState(todayIso());
  const [scheduledTime, setScheduledTime] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const pkgId = params.packageId;
        if (!pkgId) throw new Error('Missing package. Go back and pick one.');
        const row = await getIslandPackage(pkgId);
        if (!alive) return;
        if (!row) throw new Error('That package no longer exists.');
        setPkg(row);
        setPax(1);
        setLoadError(null);
      } catch (e) {
        if (alive) setLoadError(friendlyError(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [params.packageId]);

  const portName = (id: string) =>
    ports.data.find((p) => p.portId === id)?.portName ?? id;

  const total = pkg ? pkg.price * pax : 0;
  const down = Math.round(total * 0.5);
  const remainder = total - down;
  // Escrow follows the date (020): same-day hop = pay onboard like any
  // ride; future hop = 50% GCash to the admin, gated until they clear it.
  const advance = scheduledDate > todayIso();

  async function proceed() {
    if (!pkg || checking) return;
    const first = pkg.stops[0];
    const last = pkg.stops[pkg.stops.length - 1];
    if (pkg.stops.length < 2 || !first || !last || first === last) {
      setNotice('This package has no route yet. Go back and pick another.');
      return;
    }
    if (advance && !scheduledTime) {
      setNotice('Pick a departure time for your sailing date.');
      return;
    }

    // One active booking at a time + no-show ban — same pre-check as
    // book-ride; createBooking is the backstop at the pay step.
    if (profile) {
      setChecking(true);
      setNotice(null);
      try {
        const [active, banInfo] = await Promise.all([
          getActiveBooking(profile.uid),
          getBookingBan(profile.uid),
        ]);
        if (banInfo) {
          setNotice(
            `You were marked as a no-show. You can book again in ${banInfo.minutesLeft} minute${banInfo.minutesLeft === 1 ? '' : 's'}.`
          );
          setChecking(false);
          return;
        }
        if (active) {
          setNotice('You already have a pending booking.');
          setChecking(false);
          return;
        }
      } catch {
        // network hiccup — the payment step's createBooking is the backstop
      }
      setChecking(false);
    }

    router.push({
      pathname: '/(passenger)/payment',
      params: {
        fromId: first,
        fromName: portName(first),
        toId: last,
        toName: portName(last),
        count: String(pax),
        serviceType: 'passenger',
        fare: String(total),
        packageId: pkg.packageId,
        packageName: pkg.packageName,
        scheduledDate,
        scheduledTime: scheduledTime ?? '',
        ...(advance ? { downAmount: String(down), remainder: String(remainder) } : {}),
      },
    });
  }

  if (loading || ports.loading) {
    return (
      <ScreenContainer>
        <PassengerScreenHeader title="Book Island Hop" />
        <LoadingState label="Loading package…" />
      </ScreenContainer>
    );
  }
  if (loadError || ports.error || !pkg) {
    return (
      <ScreenContainer>
        <PassengerScreenHeader title="Book Island Hop" />
        <ErrorState message={loadError ?? ports.error ?? 'Could not load this package.'} />
      </ScreenContainer>
    );
  }

  const atMin = pax <= 1;
  const atMax = pax >= pkg.maxCapacity;

  return (
    <ScreenContainer padded={false}>
      <PassengerScreenHeader title="Book Island Hop" />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <View style={styles.cardTop}>
            <Text style={styles.pkgName} numberOfLines={2}>{pkg.packageName}</Text>
            <View style={styles.priceWrap}>
              <Text style={styles.price}>₱{pkg.price}</Text>
              <Text style={styles.priceUnit}>per pax</Text>
            </View>
          </View>
          {!!pkg.description && <Text style={styles.pkgDesc}>{pkg.description}</Text>}
          <View style={styles.metaRow}>
            <Text style={styles.meta}>⏱ {pkg.durationHours} hrs</Text>
            <Text style={styles.meta}>👥 up to {pkg.maxCapacity} pax</Text>
          </View>
        </View>

        <Text style={styles.sectionLabel}>ITINERARY</Text>
        <View style={styles.card}>
          {pkg.stops.map((stopId, i) => (
            <View key={`${stopId}-${i}`} style={styles.stopRow}>
              <View style={styles.stopIndexWrap}>
                <Text style={styles.stopIndex}>{i + 1}</Text>
              </View>
              <View style={styles.stopBody}>
                <Text style={styles.stopName} numberOfLines={1}>{portName(stopId)}</Text>
                {i < pkg.stops.length - 1 && <View style={styles.stopLine} />}
              </View>
            </View>
          ))}
        </View>

        <Text style={styles.sectionLabel}>SAILING DATE</Text>
        <SchedulePicker
          date={scheduledDate}
          time={scheduledTime}
          onDate={setScheduledDate}
          onTime={setScheduledTime}
        />

        <Text style={styles.sectionLabel}>PASSENGERS</Text>
        <View style={styles.paxCard}>
          <Text style={styles.paxLabel}>Seats</Text>
          <View style={styles.stepper}>
            <Pressable
              onPress={() => !atMin && setPax((n) => Math.max(1, n - 1))}
              disabled={atMin}
              accessibilityRole="button"
              accessibilityLabel="Fewer passengers"
              style={({ pressed }) => [
                styles.stepBtn,
                atMin && styles.stepBtnOff,
                pressed && !atMin && styles.stepBtnPressed,
              ]}
            >
              <Text style={[styles.stepBtnText, atMin && styles.stepBtnTextOff]}>−</Text>
            </Pressable>
            <Text style={styles.stepValue}>{pax}</Text>
            <Pressable
              onPress={() => !atMax && setPax((n) => Math.min(pkg.maxCapacity, n + 1))}
              disabled={atMax}
              accessibilityRole="button"
              accessibilityLabel="More passengers"
              style={({ pressed }) => [
                styles.stepBtn,
                atMax && styles.stepBtnOff,
                pressed && !atMax && styles.stepBtnPressed,
              ]}
            >
              <Text style={[styles.stepBtnText, atMax && styles.stepBtnTextOff]}>+</Text>
            </Pressable>
          </View>
        </View>
        <Text style={styles.paxHint}>
          Everyone rides under your booking name — tickets are checked at the pier.
        </Text>

        <Text style={styles.sectionLabel}>PAYMENT SUMMARY</Text>
        <View style={styles.card}>
          <View style={styles.sumRow}>
            <Text style={styles.sumLabel}>Total ({pax} × ₱{pkg.price})</Text>
            <Text style={styles.sumValue}>₱{total}</Text>
          </View>
          {advance ? (
            <>
              <View style={styles.sumDivider} />
              <View style={styles.sumRow}>
                <View style={styles.sumLabelWrap}>
                  <Text style={styles.sumLabelStrong}>GCash downpayment (50%)</Text>
                  <Text style={styles.sumHint}>Paid now to the admin&apos;s QR · held in escrow</Text>
                </View>
                <Text style={styles.sumDown}>₱{down}</Text>
              </View>
              <View style={styles.sumRow}>
                <Text style={styles.sumLabelStrong}>Remaining, collected onboard</Text>
                <Text style={styles.sumValue}>₱{remainder}</Text>
              </View>
            </>
          ) : (
            <View style={styles.sumRow}>
              <View style={styles.sumLabelWrap}>
                <Text style={styles.sumLabelStrong}>Collected onboard</Text>
                <Text style={styles.sumHint}>Same-day hop — no downpayment needed</Text>
              </View>
            </View>
          )}
        </View>

        {!!notice && (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>{notice}</Text>
          </View>
        )}

        <View style={styles.footer}>
          <PrimaryButton
            label={advance ? 'Proceed to Downpayment' : 'Proceed to Payment'}
            onPress={proceed}
            loading={checking}
            disabled={checking || !profile || (advance && !scheduledTime)}
          />
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.huge },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  pkgName: { flex: 1, ...typography.title, fontSize: 16 },
  priceWrap: { alignItems: 'flex-end' },
  price: { ...typography.h2, color: colors.primary },
  priceUnit: { ...typography.label, letterSpacing: 0, fontSize: 10 },
  pkgDesc: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm },
  metaRow: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.md },
  meta: { ...typography.caption, color: colors.textMuted, fontSize: 11 },

  sectionLabel: { ...typography.label, marginTop: spacing.xl, marginBottom: spacing.md },

  stopRow: { flexDirection: 'row', gap: spacing.md },
  stopIndexWrap: { alignItems: 'center', width: 24 },
  stopIndex: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border,
    textAlign: 'center', lineHeight: 22, fontSize: 12, fontWeight: '700',
    color: colors.primary,
  },
  stopBody: { flex: 1 },
  stopName: { ...typography.bodyStrong, lineHeight: 24 },
  stopLine: { width: 2, height: 14, backgroundColor: colors.border, marginVertical: 2, marginLeft: 11 },

  paxCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surface, borderRadius: radii.lg,
    borderWidth: 1, borderColor: colors.borderSubtle, padding: spacing.lg,
  },
  paxLabel: { ...typography.bodyStrong },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stepBtn: {
    width: 38, height: 38, borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center', justifyContent: 'center',
  },
  stepBtnOff: { opacity: 0.4 },
  stepBtnPressed: { borderColor: colors.primary },
  stepBtnText: { fontSize: 20, fontWeight: '700', color: colors.primary },
  stepBtnTextOff: { color: colors.textMuted },
  stepValue: { ...typography.title, minWidth: 28, textAlign: 'center' },
  paxHint: { ...typography.caption, color: colors.textMuted, fontSize: 11, marginTop: spacing.sm },

  sumRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: spacing.md, paddingVertical: spacing.xs,
  },
  sumLabelWrap: { flex: 1 },
  sumLabel: { ...typography.caption, flex: 1 },
  sumLabelStrong: { ...typography.caption, color: colors.text, fontWeight: '700', flexShrink: 1 },
  sumHint: { ...typography.caption, color: colors.textMuted, fontSize: 11, marginTop: 2 },
  sumDivider: { height: 1, backgroundColor: colors.borderSubtle, marginVertical: spacing.sm },
  sumValue: { ...typography.bodyStrong, flexShrink: 1 },
  sumDown: { ...typography.bodyStrong, color: colors.primary, flexShrink: 1 },

  notice: {
    backgroundColor: colors.dangerTint, borderColor: colors.danger, borderWidth: 1,
    borderRadius: radii.md, padding: spacing.md, marginTop: spacing.lg,
  },
  noticeText: { color: colors.danger, fontSize: 13, lineHeight: 18 },

  footer: { marginTop: spacing.xl },
});
