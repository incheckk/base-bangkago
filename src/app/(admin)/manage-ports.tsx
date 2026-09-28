import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AdminScreenHeader } from '@/components/AdminScreenHeader';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { TextField } from '@/components/TextField';
import { LoadingState } from '@/components/States';
import { useAllPorts } from '@/hooks/useAllPorts';
import { useAllPortQueues } from '@/hooks/useSupabase';
import { createPort, updatePort, deletePort } from '@/services/route.service';
import { DWELL_MS } from '@/services/queue.service';
import type { PortDoc, PortQueueDoc } from '@/types/models';
import { colors, radii, spacing, touchTarget, typography } from '@/theme/tokens';

/** m:ss for the dwell countdowns on the queue rows. */
const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export default function ManagePorts() {
  const { data: ports, loading, refresh } = useAllPorts();
  const queues = useAllPortQueues();
  const [showForm, setShowForm] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [portName, setPortName] = useState('');
  const [location, setLocation] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [radius, setRadius] = useState('');

  // Dwell countdowns tick while any queue row exists; rooms without
  // boats don't need the re-render.
  const [now, setNow] = useState(() => Date.now());
  const hasQueues = queues.data.length > 0;
  useEffect(() => {
    if (!hasQueues) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasQueues]);

  const queuesByPort = new Map<string, PortQueueDoc[]>();
  for (const row of queues.data) {
    const list = queuesByPort.get(row.portId) ?? [];
    list.push(row);
    queuesByPort.set(row.portId, list);
  }

  function resetForm() {
    setEditId(null);
    setPortName('');
    setLocation('');
    setLatitude('');
    setLongitude('');
    setRadius('');
    setShowForm(false);
  }

  function editPort(port: PortDoc) {
    setEditId(port.portId);
    setPortName(port.portName);
    setLocation(port.location ?? '');
    setLatitude(port.latitude != null ? String(port.latitude) : '');
    setLongitude(port.longitude != null ? String(port.longitude) : '');
    setRadius(String(port.geofenceRadiusM));
    setShowForm(true);
  }

  async function handleSave() {
    if (!portName.trim()) return;
    try {
      const parsedRadius = parseInt(radius, 10);
      const portData = {
        portId: editId ?? '',
        portName: portName.trim(),
        location: location.trim(),
        latitude: latitude ? parseFloat(latitude) : 0,
        longitude: longitude ? parseFloat(longitude) : 0,
        geofenceRadiusM: Number.isFinite(parsedRadius) && parsedRadius > 0 ? parsedRadius : 300,
        isActive: true,
        sortOrder: ports.length,
      };
      if (editId) {
        await updatePort(editId, portData);
      } else {
        await createPort(portData);
      }
      resetForm();
      void refresh();
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
            void refresh();
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
      <AdminScreenHeader
      title="Manage Ports"
      subtitle={`${ports.length} port${ports.length === 1 ? '' : 's'}`}
      />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

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
            <View style={{ height: spacing.md }} />
            <TextField
              label="Queue radius (meters)"
              value={radius}
              onChangeText={setRadius}
              placeholder="300"
            />
            <Text style={styles.radiusHint}>
              Boats inside this radius of the port join its FCFS queue and become eligible for
              requests after a 5-minute dwell.
            </Text>
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
                <Text style={styles.portName} numberOfLines={1}>{p.portName}</Text>
                <View style={[styles.statusBadge, { backgroundColor: p.isActive ? colors.primaryTint : colors.dangerTint }]}>
                  <Text style={[styles.statusText, { color: p.isActive ? colors.primary : colors.danger }]}>
                    {p.isActive ? 'Active' : 'Inactive'}
                  </Text>
                </View>
              </View>
              <Text style={styles.location} numberOfLines={1}>{p.location}</Text>
              <View style={styles.cardMeta}>
                <Text style={styles.metaText}>Lat: {p.latitude ?? '—'}</Text>
                <Text style={styles.metaText}>Lng: {p.longitude ?? '—'}</Text>
                <Text style={styles.metaText}>Radius: {p.geofenceRadiusM} m</Text>
              </View>

              {/* Live FCFS queue (008) — oldest arrival first. */}
              <View style={styles.queueBlock}>
                <Text style={styles.queueTitle}>WAITING QUEUE</Text>
                {(() => {
                  const q = queuesByPort.get(p.portId) ?? [];
                  if (q.length === 0) {
                    return <Text style={styles.queueEmpty}>No boats waiting.</Text>;
                  }
                  return q.map((r, i) => {
                    const dwellLeft =
                      DWELL_MS - (now - new Date(r.enteredAt).getTime());
                    const listedAt = new Date(r.enteredAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    });
                    return (
                      <View key={r.queueId} style={styles.queueRow}>
                        <Text style={styles.queueRank}>#{i + 1}</Text>
                        <Text style={styles.queueName} numberOfLines={1}>
                          {r.displayName ?? 'Boat'}
                        </Text>
                        <View
                          style={[
                            styles.queueBadge,
                            {
                              backgroundColor: r.isAvailable
                                ? colors.primaryTint
                                : colors.surfaceAlt,
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.queueBadgeText,
                              { color: r.isAvailable ? colors.primary : colors.textMuted },
                            ]}
                          >
                            {r.isAvailable ? 'online' : 'offline'}
                          </Text>
                        </View>
                        <Text style={styles.queueStatus}>
                          {dwellLeft > 0 ? `dwell ${clock(dwellLeft)}` : `ready · ${listedAt}`}
                        </Text>
                      </View>
                    );
                  });
                })()}
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

  formCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.warning,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  formTitle: { flexShrink: 1, ...typography.label, color: colors.warning, marginBottom: spacing.md },
  radiusHint: { flexShrink: 1, ...typography.micro, color: colors.textMuted, marginTop: spacing.xs, lineHeight: 16 },
  formActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  cancelBtn: { minHeight: touchTarget, flex: 1, paddingVertical: spacing.md, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, backgroundColor: colors.surfaceAlt },
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
  statusText: { flexShrink: 1, fontSize: 12, fontWeight: '700' },
  location: { flexShrink: 1, color: colors.textMuted, fontSize: 13, marginTop: spacing.xs },
  cardMeta: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.sm },
  metaText: { flexShrink: 1, color: colors.textMuted, fontSize: 12 },
  cardActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },

  // ---------- live FCFS queue (008) ----------
  queueBlock: {
    marginTop: spacing.md, paddingTop: spacing.md,
    borderTopWidth: 1, borderTopColor: colors.borderSubtle, gap: spacing.xs,
  },
  queueTitle: { flexShrink: 1, ...typography.micro, color: colors.textMuted, letterSpacing: 1, marginBottom: spacing.xxs },
  queueEmpty: { flexShrink: 1, ...typography.caption, color: colors.textMuted },
  queueRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  queueRank: { width: 26, flexShrink: 0, ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  queueName: { flex: 1, ...typography.caption, color: colors.text },
  queueBadge: { paddingHorizontal: spacing.xs, paddingVertical: 2, borderRadius: radii.pill, flexShrink: 0 },
  queueBadgeText: { fontSize: 10, fontWeight: '700' },
  queueStatus: { flexShrink: 0, ...typography.micro, color: colors.textMuted },
  editBtn: { flex: 1, paddingVertical: spacing.sm, alignItems: 'center', borderRadius: radii.sm, borderWidth: 1, borderColor: colors.warning },
  editText: { color: colors.warning, fontSize: 13, fontWeight: '600' },
  deleteBtn: { flex: 1, paddingVertical: spacing.sm, alignItems: 'center', borderRadius: radii.sm, borderWidth: 1, borderColor: colors.danger },
  deleteText: { color: colors.danger, fontSize: 13, fontWeight: '600' },
});
