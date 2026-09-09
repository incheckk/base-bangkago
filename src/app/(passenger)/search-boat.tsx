import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ScreenContainer } from '@/components/ScreenContainer';
import { usePorts } from '@/hooks/useSupabase';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import type { PortDoc } from '@/types/models';

export default function SearchBoat() {
  const ports = usePorts();
  const [query, setQuery] = useState('');

  const filtered = query.length > 0
    ? ports.data.filter((p) =>
        p.portName.toLowerCase().includes(query.toLowerCase()) ||
        (p.location ?? '').toLowerCase().includes(query.toLowerCase())
      )
    : ports.data;

  function selectPort(port: PortDoc) {
    router.push({ pathname: '/(passenger)/book-ride', params: { from: port.portName, fromId: port.portId } });
  }

  return (
    <ScreenContainer padded={false}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.backBtn}>← Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Select Port</Text>
        <View style={{ width: 50 }} />
      </View>

      <View style={styles.searchWrap}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search port or location…"
          placeholderTextColor={colors.textMuted}
          value={query}
          onChangeText={setQuery}
          autoFocus
        />
      </View>

      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {filtered.map((port) => (
          <Pressable
            key={port.portId}
            onPress={() => selectPort(port)}
            style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
          >
            <Text style={styles.itemIcon}>📍</Text>
            <View style={styles.itemContent}>
              <Text style={styles.itemName}>{port.portName}</Text>
              {!!port.location && <Text style={styles.itemLocation}>{port.location}</Text>}
            </View>
            <Text style={styles.itemArrow}>→</Text>
          </Pressable>
        ))}
        {filtered.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No ports found</Text>
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.md,
  },
  backBtn: { color: colors.primary, fontSize: 15, fontWeight: '600' },
  headerTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },

  searchWrap: { paddingHorizontal: spacing.xl, marginBottom: spacing.md },
  searchInput: {
    backgroundColor: colors.surface, borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.lg, height: 48,
    color: colors.text, fontSize: 15,
  },

  list: { paddingHorizontal: spacing.xl },
  item: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.borderSubtle,
    padding: spacing.lg, marginBottom: spacing.sm,
  },
  itemPressed: { borderColor: colors.primary },
  itemIcon: { fontSize: 20 },
  itemContent: { flex: 1 },
  itemName: { color: colors.text, fontSize: 15, fontWeight: '700' },
  itemLocation: { ...typography.caption, marginTop: 2 },
  itemArrow: { color: colors.primary, fontSize: 16, fontWeight: '700' },

  empty: { alignItems: 'center', paddingTop: spacing.xxl },
  emptyText: { color: colors.textMuted, fontSize: 14 },
});
