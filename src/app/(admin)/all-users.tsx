import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { FilterChips } from '@/components/FilterChips';
import { ScreenContainer } from '@/components/ScreenContainer';
import { LoadingState } from '@/components/States';
import { getAllUsers } from '@/services/admin.service';
import type { UserDoc } from '@/types/models';
import { colors, radii, spacing, typography } from '@/theme/tokens';

const ADMIN_ACCENT = '#F59E0B';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'passenger', label: 'Passengers' },
  { key: 'bangkero', label: 'Bangkeros' },
  { key: 'admin', label: 'Admins' },
];

const ROLE_COLORS: Record<string, string> = {
  passenger: colors.primary,
  bangkero: ADMIN_ACCENT,
  admin: colors.accent,
};

export default function AllUsersScreen() {
  const [users, setUsers] = useState<UserDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    getAllUsers()
      .then(setUsers)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    let list = users;
    if (filter !== 'all') {
      list = list.filter((u) => u.role === filter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((u) =>
        (u.firstName ?? '').toLowerCase().includes(q) ||
        (u.lastName ?? '').toLowerCase().includes(q) ||
        (u.email ?? '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [users, filter, search]);

  if (loading) return <LoadingState />;

  return (
    <ScreenContainer padded={false}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.back} onPress={() => router.back()}>← Back</Text>
        <Text style={styles.title}>All Users</Text>
        <Text style={styles.count}>{filtered.length} user{filtered.length === 1 ? '' : 's'}</Text>

        <View style={styles.searchWrap}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search users…"
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={setSearch}
          />
        </View>

        <View style={styles.chipsWrap}>
          <FilterChips filters={FILTERS} active={filter} onChange={setFilter} />
        </View>

        <View style={styles.list}>
          {filtered.map((u) => (
            <Pressable
              key={u.uid}
              onPress={() => router.push({ pathname: '/(admin)/suspend-user' as any, params: { userId: u.uid, userName: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim(), role: u.role } })}
              style={({ pressed }) => [styles.userCard, pressed && styles.cardPressed]}
            >
              <View style={styles.userRow}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>
                    {(u.firstName ?? '?').charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.userInfo}>
                  <Text style={styles.userName}>{`${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || 'Unknown'}</Text>
                  <Text style={styles.userDate}>
                    Joined {u.createdAt
                      ? new Date(u.createdAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
                      : 'N/A'}
                  </Text>
                </View>
                <View style={[styles.roleBadge, { backgroundColor: (ROLE_COLORS[u.role] ?? colors.textMuted) + '20' }]}>
                  <Text style={[styles.roleText, { color: ROLE_COLORS[u.role] ?? colors.textMuted }]}>
                    {u.role ? u.role.charAt(0).toUpperCase() + u.role.slice(1) : 'Unknown'}
                  </Text>
                </View>
              </View>
            </Pressable>
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
  count: { ...typography.caption, marginBottom: spacing.lg },

  searchWrap: { marginBottom: spacing.md },
  searchInput: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },

  chipsWrap: { marginBottom: spacing.md },

  list: { gap: spacing.md },
  userCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
  },
  cardPressed: { borderColor: ADMIN_ACCENT },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.text, fontSize: 16, fontWeight: '700' },
  userInfo: { flex: 1 },
  userName: { color: colors.text, fontSize: 15, fontWeight: '600' },
  userDate: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  roleBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
  },
  roleText: { fontSize: 12, fontWeight: '700' },
});
