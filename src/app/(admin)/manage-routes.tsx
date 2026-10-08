import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AdminScreenHeader } from '@/components/AdminScreenHeader';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { TextField } from '@/components/TextField';
import { LoadingState } from '@/components/States';
import { useRoutes } from '@/hooks/useRoutes';
import { useAllPorts } from '@/hooks/useAllPorts';
import { createRoute, updateRoute, deleteRoute } from '@/services/route.service';
import type { RouteDoc } from '@/types/models';
import { colors, radii, spacing, touchTarget, typography } from '@/theme/tokens';
export default function ManageRoutes() {
  const { data: routes, loading, refresh } = useRoutes();
  const { data: ports } = useAllPorts();
  const [showForm, setShowForm] = useState(false);
  const [openPick, setOpenPick] = useState<'start' | 'end' | null>(null);

  const [editId, setEditId] = useState<string | null>(null);
  const [startPortId, setStartPortId] = useState('');
  const [endPortId, setEndPortId] = useState('');
  const [baseFare, setBaseFare] = useState('');
  const [distanceKm, setDistanceKm] = useState('');
  const [estimatedMinutes, setEstimatedMinutes] = useState('');

  function resetForm() {
    setEditId(null);
    setStartPortId('');
    setEndPortId('');
    setBaseFare('');
    setDistanceKm('');
    setEstimatedMinutes('');
    setShowForm(false);
    setOpenPick(null);
  }

  function editRoute(route: RouteDoc) {
    setEditId(route.routeId);
    setStartPortId(route.startPortId);
    setEndPortId(route.endPortId);
    setBaseFare(String(route.baseFare));
    setDistanceKm(String(route.distanceKm ?? ''));
    setEstimatedMinutes(String(route.estimatedMinutes ?? ''));
    setShowForm(true);
  }

  async function handleSave() {
    if (!startPortId || !endPortId || !baseFare) return;
    try {
      const routeData: RouteDoc = {
        routeId: editId ?? '',
        startPortId,
        endPortId,
        baseFare: parseFloat(baseFare) || 0,
        distanceKm: distanceKm ? parseFloat(distanceKm) : null,
        estimatedMinutes: estimatedMinutes ? parseInt(estimatedMinutes) : 0,
        isActive: true,
      };
      if (editId) {
        await updateRoute(editId, routeData);
      } else {
        await createRoute(routeData);
      }
      resetForm();
      void refresh();
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Failed to save route');
    }
  }

  async function handleDelete(routeId: string) {
    Alert.alert('Delete Route', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteRoute(routeId);
            void refresh();
          } catch (e: any) {
            Alert.alert('Error', e.message ?? 'Failed to delete');
          }
        },
      },
    ]);
  }

  function getPortName(id: string) {
    return ports.find((p) => p.portId === id)?.portName ?? id;
  }

  if (loading) return <LoadingState />;

  return (
    <ScreenContainer padded={false}>
      <AdminScreenHeader
      title="Manage Routes"
      subtitle={`${routes.length} route${routes.length === 1 ? '' : 's'}`}
      />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {showForm && (
          <View style={styles.formCard}>
            <Text style={styles.formTitle}>{editId ? 'Edit Route' : 'New Route'}</Text>
            <PortSelect
              label="Start Port"
              value={startPortId}
              open={openPick === 'start'}
              onToggle={() => setOpenPick(openPick === 'start' ? null : 'start')}
              onPick={(id) => { setStartPortId(id); setOpenPick(null); }}
              ports={ports}
            />
            <View style={{ height: spacing.md }} />
            <PortSelect
              label="End Port"
              value={endPortId}
              open={openPick === 'end'}
              onToggle={() => setOpenPick(openPick === 'end' ? null : 'end')}
              onPick={(id) => { setEndPortId(id); setOpenPick(null); }}
              ports={ports}
            />
            <View style={{ height: spacing.md }} />
            <TextField label="Base Fare (₱)" value={baseFare} onChangeText={setBaseFare} placeholder="85" />
            <View style={{ height: spacing.md }} />
            <TextField label="Distance (km)" value={distanceKm} onChangeText={setDistanceKm} placeholder="12.5" />
            <View style={{ height: spacing.md }} />
            <TextField label="Est. Minutes" value={estimatedMinutes} onChangeText={setEstimatedMinutes} placeholder="45" />
            <View style={styles.formActions}>
              <Pressable onPress={resetForm} style={styles.cancelBtn}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <PrimaryButton label={editId ? 'Update' : 'Create'} onPress={handleSave} disabled={!startPortId || !endPortId || !baseFare} />
            </View>
          </View>
        )}

        {!showForm && (
          <PrimaryButton label="+ Add Route" onPress={() => setShowForm(true)} />
        )}

        <View style={styles.list}>
          {routes.map((r) => (
            <View key={r.routeId} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.routeName} numberOfLines={1}>{getPortName(r.startPortId)} → {getPortName(r.endPortId)}</Text>
                <Text style={styles.fare}>₱{r.baseFare}</Text>
              </View>
              <View style={styles.cardMeta}>
                <Text style={styles.metaText} numberOfLines={1}>{r.distanceKm ? `${r.distanceKm} km` : '—'}</Text>
                <Text style={styles.metaText} numberOfLines={1}>{r.estimatedMinutes ? `${r.estimatedMinutes} min` : '—'}</Text>
              </View>
              <View style={styles.cardActions}>
                <Pressable onPress={() => editRoute(r)} style={styles.editBtn}>
                  <Text style={styles.editText}>Edit</Text>
                </Pressable>
                <Pressable onPress={() => handleDelete(r.routeId)} style={styles.deleteBtn}>
                  <Text style={styles.deleteText}>Delete</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

/** Inline port dropdown — the old raw port-id TextFields invited typos. */
function PortSelect({
  label, value, open, onToggle, onPick, ports,
}: {
  label: string;
  value: string;
  open: boolean;
  onToggle: () => void;
  onPick: (id: string) => void;
  ports: { portId: string; portName: string }[];
}) {
  return (
    <View>
      <Text style={styles.selectLabel}>{label}</Text>
      <Pressable style={styles.selectBtn} onPress={onToggle}>
        <Text style={[styles.selectText, !value && styles.selectPlaceholder]} numberOfLines={1}>
          {value ? ports.find((p) => p.portId === value)?.portName ?? value : 'Pick a port'}
        </Text>
        <Text style={styles.selectCaret}>{open ? '▾' : '▸'}</Text>
      </Pressable>
      {open && (
        <View style={styles.selectList}>
          {ports.map((p) => (
            <Pressable
              key={p.portId}
              style={styles.selectOption}
              onPress={() => onPick(p.portId)}
            >
              <Text style={styles.selectOptionText} numberOfLines={1}>{p.portName}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },

  formCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.warning,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  formTitle: { flexShrink: 1, ...typography.label, color: colors.warning, marginBottom: spacing.md },
  formActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  cancelBtn: { minHeight: touchTarget, flex: 1, paddingVertical: spacing.md, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, backgroundColor: colors.surfaceAlt },
  cancelText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },

  list: { gap: spacing.md },
  selectLabel: { flexShrink: 1, color: colors.textSecondary, fontSize: 13, marginBottom: spacing.xs },
  selectBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    minHeight: touchTarget, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radii.sm, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  selectText: { flexShrink: 1, color: colors.text, fontSize: 14 },
  selectPlaceholder: { color: colors.textMuted },
  selectCaret: { color: colors.textSecondary, fontSize: 12 },
  selectList: {
    marginTop: spacing.xs, borderRadius: radii.sm, borderWidth: 1,
    borderColor: colors.border, backgroundColor: colors.surface, overflow: 'hidden',
  },
  selectOption: { minHeight: touchTarget, justifyContent: 'center', paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  selectOptionText: { flexShrink: 1, color: colors.text, fontSize: 14 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  routeName: { color: colors.text, fontSize: 15, fontWeight: '700', flex: 1 },
  fare: { flexShrink: 1, color: colors.warning, fontSize: 16, fontWeight: '700' },
  cardMeta: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.sm },
  metaText: { flexShrink: 1, color: colors.textMuted, fontSize: 12 },
  cardActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  editBtn: { flex: 1, paddingVertical: spacing.sm, alignItems: 'center', borderRadius: radii.sm, borderWidth: 1, borderColor: colors.warning },
  editText: { color: colors.warning, fontSize: 13, fontWeight: '600' },
  deleteBtn: { flex: 1, paddingVertical: spacing.sm, alignItems: 'center', borderRadius: radii.sm, borderWidth: 1, borderColor: colors.danger },
  deleteText: { color: colors.danger, fontSize: 13, fontWeight: '600' },
});
