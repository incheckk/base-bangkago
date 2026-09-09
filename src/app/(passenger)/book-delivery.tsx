import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { TextField } from '@/components/TextField';
import { usePorts } from '@/hooks/useSupabase';
import { colors, radii, spacing, typography } from '@/theme/tokens';

interface ParcelItem {
  itemName: string;
  quantity: string;
  kilogram: string;
}

export default function BookDelivery() {
  const ports = usePorts();
  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(null);
  const [receiverName, setReceiverName] = useState('');
  const [receiverContact, setReceiverContact] = useState('');
  const [items, setItems] = useState<ParcelItem[]>([{ itemName: '', quantity: '1', kilogram: '1' }]);
  const [date, setDate] = useState('');

  const fromPort = ports.data.find((p) => p.portId === fromId);
  const toPort = ports.data.find((p) => p.portId === toId);

  const totalKg = items.reduce((sum, i) => sum + (parseFloat(i.kilogram) || 0), 0);
  const baseFare = 85;
  const cargoFare = Math.round(baseFare * 1.5 * Math.max(1, Math.ceil(totalKg / 10)));

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

  const ready = !!fromId && !!toId && fromId !== toId && receiverName.trim() && items.some((i) => i.itemName.trim());

  return (
    <ScreenContainer padded={false}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.back} onPress={() => router.back()}>← Back</Text>
        <Text style={styles.title}>Book Delivery</Text>
        <Text style={styles.subtitle}>Send parcels and cargo between ports</Text>

        <Text style={styles.sectionLabel}>FROM PORT</Text>
        <View style={styles.chips}>
          {ports.data.map((p) => (
            <Pressable
              key={p.portId}
              onPress={() => setFromId(p.portId)}
              style={[styles.chip, fromId === p.portId && styles.chipActive, toId === p.portId && styles.chipDisabled]}
              disabled={toId === p.portId}
            >
              <Text style={[styles.chipText, fromId === p.portId && styles.chipTextActive]}>{p.portName}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={[styles.sectionLabel, styles.mt]}>TO PORT</Text>
        <View style={styles.chips}>
          {ports.data.map((p) => (
            <Pressable
              key={p.portId}
              onPress={() => setToId(p.portId)}
              style={[styles.chip, toId === p.portId && styles.chipActive, fromId === p.portId && styles.chipDisabled]}
              disabled={fromId === p.portId}
            >
              <Text style={[styles.chipText, toId === p.portId && styles.chipTextActive]}>{p.portName}</Text>
            </Pressable>
          ))}
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

        <Text style={[styles.sectionLabel, styles.mt]}>PREFERRED DATE</Text>
        <TextField label="Delivery Date" value={date} onChangeText={setDate} placeholder="MM/DD/YYYY" />

        <View style={styles.fareCard}>
          <View style={styles.fareRow}>
            <Text style={styles.fareLabel}>Total Weight</Text>
            <Text style={styles.fareValue}>{totalKg.toFixed(1)} kg</Text>
          </View>
          <View style={styles.fareRow}>
            <Text style={styles.fareLabel}>Estimated Fare</Text>
            <Text style={styles.fareValue}>₱{cargoFare}</Text>
          </View>
        </View>

        <PrimaryButton
          label={`Confirm Delivery · ₱${cargoFare}`}
          onPress={() => {
            router.push({
              pathname: '/(passenger)/payment',
              params: {
                fromId: fromPort?.portId,
                fromName: fromPort?.portName,
                toId: toPort?.portId,
                toName: toPort?.portName,
                serviceType: 'cargo',
                fare: String(cargoFare),
              },
            });
          }}
          disabled={!ready}
        />
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  back: { color: colors.primary, fontSize: 14, fontWeight: '600', marginBottom: spacing.lg },
  title: { ...typography.h1, marginBottom: spacing.xs },
  subtitle: { ...typography.caption, marginBottom: spacing.xl },

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
  chipText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
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
  itemNumber: { ...typography.label, marginBottom: 0 },
  removeText: { color: colors.danger, fontSize: 13, fontWeight: '600' },
  itemRow: { flexDirection: 'row', gap: spacing.md },
  itemHalf: { flex: 1 },

  addItemBtn: {
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
  fareValue: { color: colors.primary, fontSize: 16, fontWeight: '700' },
});
