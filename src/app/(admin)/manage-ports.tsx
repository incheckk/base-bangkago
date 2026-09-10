import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { TextField } from '@/components/TextField';
import { LoadingState } from '@/components/States';
import { getAllPorts, createPort, updatePort, deletePort } from '@/services/route.service';
import type { PortDoc } from '@/types/models';
import { colors, radii, spacing, typography } from '@/theme/tokens';
export default function ManagePorts() {
  const [ports, setPorts] = useState<PortDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [portName, setPortName] = useState('');
  const [location, setLocation] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const p = await getAllPorts();
      setPorts(p);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setEditId(null);
    setPortName('');
    setLocation('');
    setLatitude('');
    setLongitude('');
    setShowForm(false);
  }

  function editPort(port: PortDoc) {
    setEditId(port.portId);
    setPortName(port.portName);
    setLocation(port.location ?? '');
    setLatitude(port.latitude != null ? String(port.latitude) : '');
    setLongitude(port.longitude != null ? String(port.longitude) : '');
    setShowForm(true);
  }

  async function handleSave() {
    if (!portName.trim()) return;
    try {
      const portData = {
        portId: editId ?? '',
        portName: portName.trim(),
        location: location.trim(),
        latitude: latitude ? parseFloat(latitude) : 0,
        longitude: longitude ? parseFloat(longitude) : 0,
        isActive: true,
        sortOrder: ports.length,
      };
      if (editId) {
        await updatePort(editId, portData);
      } else {
        await createPort(portData);
      }
      resetForm();
      loadData();
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Failed to save port');
    }
  }

  async function handleDelete(portId: string) {
    Alert.alert('Delete Port', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deletePort(portId);
            loadData();
          } catch (e: any) {
            Alert.alert('Error', e.message ?? 'Failed to delete');
          }
        },
      },
    ]);
  }

  if (loading) return <LoadingState />;

  return (
    <ScreenContainer padded={false}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.back} onPress={() => router.back()}>← Back</Text>
        <Text style={styles.title}>Manage Ports</Text>
        <Text style={styles.count}>{ports.length} port{ports.length === 1 ? '' : 's'}</Text>

        {showForm && (
          <View style={styles.formCard}>
            <Text style={styles.formTitle}>{editId ? 'Edit Port' : 'New Port'}</Text>
            <TextField label="Port Name" value={portName} onChangeText={setPortName} placeholder="Puerto Galera" />
            <View style={{ height: spacing.md }} />
            <TextField label="Location" value={location} onChangeText={setLocation} placeholder="Oriental Mindoro" />
            <View style={{ height: spacing.md }} />
            <TextField label="Latitude" value={latitude} onChangeText={setLatitude} placeholder="13.4125" />
            <View style={{ height: spacing.md }} />
            <TextField label="Longitude" value={longitude} onChangeText={setLongitude} placeholder="120.8234" />
            <View style={styles.formActions}>
              <Pressable onPress={resetForm} style={styles.cancelBtn}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <PrimaryButton label={editId ? 'Update' : 'Create'} onPress={handleSave} disabled={!portName.trim()} />
            </View>
          </View>
        )}

        {!showForm && (
          <PrimaryButton label="+ Add Port" onPress={() => setShowForm(true)} />
        )}

        <View style={styles.list}>
          {ports.map((p) => (
            <View key={p.portId} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.portName}>{p.portName}</Text>
                <View style={[styles.statusBadge, { backgroundColor: p.isActive ? colors.primaryTint : colors.dangerTint }]}>
                  <Text style={[styles.statusText, { color: p.isActive ? colors.primary : colors.danger }]}>
                    {p.isActive ? 'Active' : 'Inactive'}
                  </Text>
                </View>
              </View>
              <Text style={styles.location}>{p.location}</Text>
              <View style={styles.cardMeta}>
                <Text style={styles.metaText}>Lat: {p.latitude ?? '—'}</Text>
                <Text style={styles.metaText}>Lng: {p.longitude ?? '—'}</Text>
              </View>
              <View style={styles.cardActions}>
                <Pressable onPress={() => editPort(p)} style={styles.editBtn}>
                  <Text style={styles.editText}>Edit</Text>
                </Pressable>
                <Pressable onPress={() => handleDelete(p.portId)} style={styles.deleteBtn}>
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
  portName: { color: colors.text, fontSize: 15, fontWeight: '700', flex: 1 },
  statusBadge: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radii.pill },
  statusText: { fontSize: 12, fontWeight: '700' },
  location: { color: colors.textMuted, fontSize: 13, marginTop: spacing.xs },
  cardMeta: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.sm },
  metaText: { color: colors.textMuted, fontSize: 12 },
  cardActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  editBtn: { flex: 1, paddingVertical: spacing.sm, alignItems: 'center', borderRadius: radii.sm, borderWidth: 1, borderColor: colors.warning },
  editText: { color: colors.warning, fontSize: 13, fontWeight: '600' },
  deleteBtn: { flex: 1, paddingVertical: spacing.sm, alignItems: 'center', borderRadius: radii.sm, borderWidth: 1, borderColor: colors.danger },
  deleteText: { color: colors.danger, fontSize: 13, fontWeight: '600' },
});
