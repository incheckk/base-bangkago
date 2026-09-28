import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PassengerScreenHeader } from '@/components/PassengerScreenHeader';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { ErrorState, LoadingState } from '@/components/States';
import { TextField } from '@/components/TextField';
import { useAuth } from '@/hooks/useAuth';
import { usePorts } from '@/hooks/useSupabase';
import { useRoutes } from '@/hooks/useRoutes';
import { getActiveBooking, getBookingBan, routeIdFor } from '@/services/booking.service';
import type { RouteDoc } from '@/types/models';
import { colors, radii, spacing, touchTarget, typography } from '@/theme/tokens';

interface ParcelItem {
  itemName: string;
  quantity: string;
  kilogram: string;
}

export default function BookDelivery() {
  const { user } = useAuth();
  const ports = usePorts();
  const { data: routes, loading: routesLoading, error: routesError } = useRoutes();
  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(null);
  const [receiverName, setReceiverName] = useState('');
  const [receiverContact, setReceiverContact] = useState('');
  const [items, setItems] = useState<ParcelItem[]>([{ itemName: '', quantity: '1', kilogram: '1' }]);
  const [checking, setChecking] = useState(false);
  const [blocked, setBlocked] = useState<{ bookingId: string; ref: string } | null>(null);
  const [ban, setBan] = useState<number | null>(null);

  const activeRoutes = routes.filter((r) => r.isActive);
  const routeFor = (from: string | null, to: string | null): RouteDoc | null => {
    if (!from || !to) return null;
    const id = routeIdFor(from, to);
    return activeRoutes.find((r) => r.routeId === id) ?? null;
  };

  useEffect(() => {
    if (!fromId || !toId) return;
    const id = routeIdFor(fromId, toId);
    if (!routes.some((r) => r.isActive && r.routeId === id)) setToId(null);
  }, [fromId, toId, routes]);

  const fromPort = ports.data.find((p) => p.portId === fromId);
  const toPort = ports.data.find((p) => p.portId === toId);
  const route = routeFor(fromId, toId);

  const totalKg = items.reduce((sum, i) => sum + (parseFloat(i.kilogram) || 0), 0);
  const cargoFare = route
    ? Math.round(route.baseFare * 1.5 * Math.max(1, Math.ceil(totalKg / 10)))
    : null;

  function addItem() {
    setItems((prev) => [...prev, { itemName: '', quantity: '1', kilogram: '1' }]);
  }

  function updateItem(index: number, field: keyof ParcelItem, value: string) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)));
  }

  function removeItem(index: number) {
    if (items.length <= 1) return;
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  const ready =
    !!fromId &&
    !!toId &&
    fromId !== toId &&
    cargoFare !== null &&
    !!receiverName.trim() &&
    items.some((i) => i.itemName.trim());

  if (ports.loading || routesLoading) {
    return <ScreenContainer><LoadingState label="Loading ports…" /></ScreenContainer>;
  }
  if (ports.error || routesError) {
    return <ScreenContainer><ErrorState message={ports.error ?? routesError ?? 'Could not load routes.'} /></ScreenContainer>;
  }

  async function confirmDelivery() {
    if (!ready || checking || !fromPort || !toPort || cargoFare === null) return;
    // No-show ban first, then one active booking at a time — createBooking
    // re-checks both at the pay step.
    if (user) {
      setChecking(true);
      try {
        const [active, banInfo] = await Promise.all([
          getActiveBooking(user.id),
          getBookingBan(user.id),
        ]);
        if (banInfo) {
          setBan(banInfo.minutesLeft);
          setChecking(false);
          return;
        }
        if (active) {
          setBlocked(active);
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
        fromId: fromPort.portId,
        fromName: fromPort.portName,
        toId: toPort.portId,
        toName: toPort.portName,
        serviceType: 'cargo',
        fare: String(cargoFare),
        receiverName,
        receiverContact,
        itemsJson: JSON.stringify(items),
      },
    });
  }

  return (
    <ScreenContainer padded={false}>
      <PassengerScreenHeader title="Book Delivery" subtitle="Send parcels and cargo between ports" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        <Text style={styles.sectionLabel}>FROM PORT</Text>
        <View style={styles.chips}>
          {ports.data.map((p) => (
            <Pressable
              key={p.portId}
              onPress={() => setFromId(p.portId)}
              style={[styles.chip, fromId === p.portId && styles.chipActive, toId === p.portId && styles.chipDisabled]}
              disabled={toId === p.portId}
            >
              <Text style={[styles.chipText, fromId === p.portId && styles.chipTextActive]} numberOfLines={1}>{p.portName}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={[styles.sectionLabel, styles.mt]}>TO PORT</Text>
        <View style={styles.chips}>
          {ports.data.map((p) => {
            const blocked = !!fromId && p.portId !== fromId && !routeFor(fromId, p.portId);
            const off = fromId === p.portId || blocked;
            return (
              <Pressable
                key={p.portId}
                onPress={() => setToId(p.portId)}
                style={[styles.chip, toId === p.portId && styles.chipActive, off && styles.chipDisabled]}
                disabled={off}
              >
                <Text style={[styles.chipText, toId === p.portId && styles.chipTextActive]} numberOfLines={1}>{p.portName}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.sectionLabel, styles.mt]}>RECEIVER INFO</Text>
        <TextField label="Receiver Name" value={receiverName} onChangeText={setReceiverName} placeholder="Juan Dela Cruz" />
        <View style={{ height: spacing.md }} />
        <TextField label="Contact Number" value={receiverContact} onChangeText={setReceiverContact} placeholder="+639171234567" />

        <Text style={[styles.sectionLabel, styles.mt]}>PARCEL ITEMS</Text>
        {items.map((item, idx) => (
          <View key={idx} style={styles.itemCard}>
            <View style={styles.itemHeader}>
              <Text style={styles.itemNumber}>Item {idx + 1}</Text>
              {items.length > 1 && (
                <Pressable onPress={() => removeItem(idx)}>
                  <Text style={styles.removeText}>Remove</Text>
                </Pressable>
              )}
            </View>
            <TextField label="Item Name" value={item.itemName} onChangeText={(v) => updateItem(idx, 'itemName', v)} placeholder="e.g. Box of vegetables" />
            <View style={styles.itemRow}>
              <View style={styles.itemHalf}>
                <TextField label="Qty" value={item.quantity} onChangeText={(v) => updateItem(idx, 'quantity', v)} placeholder="1" />
              </View>
              <View style={styles.itemHalf}>
                <TextField label="Weight (kg)" value={item.kilogram} onChangeText={(v) => updateItem(idx, 'kilogram', v)} placeholder="1" />
              </View>
            </View>
          </View>
        ))}

        <Pressable onPress={addItem} style={styles.addItemBtn}>
          <Text style={styles.addItemText}>+ Add Another Item</Text>
        </Pressable>

        <View style={styles.fareCard}>
          <View style={styles.fareRow}>
            <Text style={styles.fareLabel}>Total Weight</Text>
            <Text style={styles.fareValue}>{totalKg.toFixed(1)} kg</Text>
          </View>
          <View style={styles.fareRow}>
            <Text style={styles.fareLabel}>Estimated Fare</Text>
            <Text style={styles.fareValue} numberOfLines={1}>{cargoFare !== null ? `₱${cargoFare}` : '—'}</Text>
          </View>
        </View>

        <PrimaryButton
          label={cargoFare !== null ? `Confirm Delivery · ₱${cargoFare}` : 'Confirm Delivery'}
          onPress={confirmDelivery}
          disabled={!ready}
          loading={checking}
        />
      </ScrollView>

      {/* One active trip at a time — the pending booking is offered directly. */}
      <Modal
        visible={!!blocked}
        transparent
        animationType="fade"
        onRequestClose={() => setBlocked(null)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setBlocked(null)}
            accessibilityLabel="Close"
          />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>You already have a pending booking</Text>
            <Text style={styles.modalHint}>
              Only one active booking at a time. View it to track or cancel it.
            </Text>
            <View style={styles.blockedRef}>
              <Text style={styles.blockedRefLabel}>PENDING BOOKING</Text>
              <Text style={styles.blockedRefValue}>{blocked?.ref}</Text>
            </View>
            <View style={styles.modalActions}>
              <View style={styles.modalActionBtn}>
                <PrimaryButton label="Close" variant="secondary" onPress={() => setBlocked(null)} />
              </View>
              <View style={styles.modalActionBtn}>
                <PrimaryButton
                  label="View booking"
                  onPress={() => {
                    const target = blocked;
                    setBlocked(null);
                    if (target) router.push(`/(passenger)/booking/${target.bookingId}`);
                  }}
                />
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* No-show ban: booking is refused until the timer runs out. */}
      <Modal
        visible={ban !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setBan(null)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setBan(null)}
            accessibilityLabel="Close"
          />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>You were marked as a no-show</Text>
            <Text style={styles.modalHint}>
              You were told to board and the boat left without you. You can&apos;t
              book again for {ban} minute{ban === 1 ? '' : 's'} — the ban lifts on
              its own.
            </Text>
            <View style={styles.modalActions}>
              <View style={styles.modalActionBtn}>
                <PrimaryButton label="Close" variant="secondary" onPress={() => setBan(null)} />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },

  sectionLabel: { ...typography.label, marginBottom: spacing.md },
  mt: { marginTop: spacing.xl },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipDisabled: { opacity: 0.35 },
  chipText: { flexShrink: 1, color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: colors.primaryText },

  itemCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  itemNumber: { flexShrink: 1, ...typography.label, marginBottom: 0 },
  removeText: { color: colors.danger, fontSize: 13, fontWeight: '600' },
  itemRow: { flexDirection: 'row', gap: spacing.md },
  itemHalf: { flex: 1 },

  addItemBtn: { minHeight: touchTarget, justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.primary,
    borderStyle: 'dashed',
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  addItemText: { color: colors.primary, fontSize: 14, fontWeight: '600' },

  fareCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.xl,
    gap: spacing.sm,
  },
  fareRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fareLabel: { ...typography.caption },
  fareValue: { flexShrink: 1, color: colors.primary, fontSize: 16, fontWeight: '700' },

  // ---------- blocked modal (same pattern as book-ride) ----------
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.xl,
  },
  modalTitle: { ...typography.title, marginBottom: spacing.xs },
  modalHint: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.lg },
  blockedRef: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.md,
    marginBottom: spacing.xl,
    alignItems: 'center',
  },
  blockedRefLabel: { ...typography.label, color: colors.textMuted, marginBottom: spacing.xxs },
  blockedRefValue: { color: colors.text, fontSize: 16, fontWeight: '700', letterSpacing: 1 },
  modalActions: { flexDirection: 'row', gap: spacing.md },
  modalActionBtn: { flex: 1 },
});
