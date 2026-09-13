import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { TextField } from '@/components/TextField';
import { LoadingState } from '@/components/States';
import { getAllRoutes, createRoute, updateRoute, deleteRoute, getAllPorts } from '@/services/route.service';
import type { RouteDoc, PortDoc } from '@/types/models';
import { colors, radii, spacing, typography } from '@/theme/tokens';
export default function ManageRoutes() {
  const [routes, setRoutes] = useState<RouteDoc[]>([]);
  const [ports, setPorts] = useState<PortDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [startPortId, setStartPortId] = useState('');
  const [endPortId, setEndPortId] = useState('');
  const [baseFare, setBaseFare] = useState('');
  const [distanceKm, setDistanceKm] = useState('');
  const [estimatedMinutes, setEstimatedMinutes] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [r, p] = await Promise.all([getAllRoutes(), getAllPorts()]);
      setRoutes(r);
      setPorts(p);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setEditId(null);
    setStartPortId('');
    setEndPortId('');
    setBaseFare('');
    setDistanceKm('');
    setEstimatedMinutes('');
    setShowForm(false);
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
      loadData();
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
            loadData();
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
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.back} onPress={() => router.back()}>← Back</Text>
        <Text style={styles.title}>Manage Routes</Text>
        <Text style={styles.count}>{routes.length} route{routes.length === 1 ? '' : 's'}</Text>

        {showForm && (
          <View style={styles.formCard}>
            <Text style={styles.formTitle}>{editId ? 'Edit Route' : 'New Route'}</Text>
            <TextField label="Start Port ID" value={startPortId} onChangeText={setStartPortId} placeholder="port-id" />
            <View style={{ height: spacing.md }} />
            <TextField label="End Port ID" value={endPortId} onChangeText={setEndPortId} placeholder="port-id" />
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
                <Text style={styles.routeName}>{getPortName(r.startPortId)} → {getPortName(r.endPortId)}</Text>
                <Text style={styles.fare}>₱{r.baseFare}</Text>
              </View>
              <View style={styles.cardMeta}>
                <Text style={styles.metaText}>{r.distanceKm ? `${r.distanceKm} km` : '—'}</Text>
                <Text style={styles.metaText}>{r.estimatedMinutes ? `${r.estimatedMinutes} min` : '—'}</Text>
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

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  back: { color: colors.primary, fontSize: 14, fontWeight: '600', marginBottom: spacing.lg },
  title: { ...typography.h1, marginBottom: spacing.xs },
  count: { ...typography.caption, marginBottom: spacing.xl },

  formCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.warning,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  formTitle: { ...typography.label, color: colors.warning, marginBottom: spacing.md },
  formActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  cancelBtn: { flex: 1, paddingVertical: spacing.md, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, backgroundColor: colors.surfaceAlt },
  cancelText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },

  list: { gap: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  routeName: { color: colors.text, fontSize: 15, fontWeight: '700', flex: 1 },
  fare: { color: colors.warning, fontSize: 16, fontWeight: '700' },
  cardMeta: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.sm },
  metaText: { color: colors.textMuted, fontSize: 12 },
  cardActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  editBtn: { flex: 1, paddingVertical: spacing.sm, alignItems: 'center', borderRadius: radii.sm, borderWidth: 1, borderColor: colors.warning },
  editText: { color: colors.warning, fontSize: 13, fontWeight: '600' },
  deleteBtn: { flex: 1, paddingVertical: spacing.sm, alignItems: 'center', borderRadius: radii.sm, borderWidth: 1, borderColor: colors.danger },
  deleteText: { color: colors.danger, fontSize: 13, fontWeight: '600' },
});
