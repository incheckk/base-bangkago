import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';

import { BangkeroScreenHeader } from '@/components/BangkeroScreenHeader';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { TextField } from '@/components/TextField';
import { useAuth } from '@/hooks/useAuth';
import { useBangkero } from '@/hooks/useSupabase';
import { friendlyAuthError, signOut } from '@/services/auth.service';
import {
  friendlyError as profileFriendlyError, updateBoat, updateName,
} from '@/services/profile.service';
import { supabase } from '@/services/supabase';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import { formatPhone } from '@/utils/phone';

const MENU_ITEMS = [
  { key: 'earnings', label: 'Earnings', icon: '💰' },
  { key: 'trips', label: 'Trip History', icon: '🚤' },
  { key: 'documents', label: 'Documents', icon: '📄' },
  { key: 'passengers', label: 'Passenger List', icon: '👥' },
  { key: 'weather', label: 'Weather', icon: '🌊' },
  { key: 'qr', label: 'My QR Code', icon: '📱' },
  { key: 'guide', label: 'Quick Guide', icon: '📖' },
  { key: 'settings', label: 'Settings', icon: '⚙️' },
] as const;

const ROUTE_MAP: Record<string, string> = {
  earnings: '/(bangkero)/earnings',
  trips: '/(bangkero)/trips',
  documents: '/(bangkero)/verify-boat',
  passengers: '/(bangkero)/passenger-list',
  weather: '/(bangkero)/weather',
  qr: '/(bangkero)/qr-code',
  guide: '/(bangkero)/quick-guide',
  settings: '/(bangkero)/profile',
};

export default function BangkeroProfileScreen() {
  const { user, profile } = useAuth();
  const bangkero = useBangkero(user?.id ?? null);

  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [boatName, setBoatName] = useState('');
  const [capacity, setCapacity] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [saved, setSaved] = useState<{ first: string; last: string; boat: string } | null>(null);
  const [bangkaCapacity, setBangkaCapacity] = useState<string | null>(null);

  const op = bangkero.data;
  const uid = user?.id ?? null;

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('bangkas')
        .select('capacity')
        .eq('bangkero_id', uid)
        .maybeSingle();
      if (!cancelled && data) setBangkaCapacity(String(data.capacity ?? ''));
    })();
    return () => { cancelled = true; };
  }, [uid]);

  const initials = profile
    ? `${profile.firstName.charAt(0)}${profile.lastName.charAt(0)}`
    : '??';

  function startEdit() {
    if (!profile) return;
    setFirstName(profile.firstName);
    setLastName(profile.lastName);
    setBoatName(saved?.boat ?? op?.displayName ?? '');
    setCapacity(bangkaCapacity ?? '');
    setError(null);
    setEditing(true);
  }

  async function saveProfile() {
    if (!profile || !uid) return;
    setSavingProfile(true);
    setError(null);
    try {
      await updateName({
        uid,
        firstName,
        lastName,
        isBangkero: true,
      });
      await updateBoat({
        uid,
        boatName,
        capacity,
      });
      const newBoat = boatName.trim() || (saved?.boat ?? op?.displayName ?? '');
      setSaved({ first: firstName.trim(), last: lastName.trim(), boat: newBoat });
      if (capacity.trim()) setBangkaCapacity(capacity.trim());
      setEditing(false);
    } catch (e) {
      setError(profileFriendlyError(e));
    }
    setSavingProfile(false);
  }

  async function handleSignOut() {
    setSigningOut(true);
    setError(null);
    try {
      await signOut();
    } catch (e) {
      setError(friendlyAuthError(e));
      setSigningOut(false);
    }
  }

  const displayFirst = saved?.first ?? profile?.firstName ?? '';
  const displayLast = saved?.last ?? profile?.lastName ?? '';
  const displayBoat = saved?.boat ?? op?.displayName ?? '';

  return (
    <ScreenContainer padded={false}>
      <BangkeroScreenHeader title="Profile" showDrawer={false} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        <View style={styles.header}>
          <View style={styles.avatar}>
            <Text style={styles.initials}>{initials}</Text>
          </View>
          <Text style={styles.name}>
            {profile ? `${displayFirst} ${displayLast}` : 'Loading…'}
          </Text>
          <Text style={styles.phone}>
            {profile ? formatPhone(profile.phone) : ''}
          </Text>
          {op && (
            <Text style={styles.boatName}>{displayBoat}</Text>
          )}
          <View style={[
            styles.badge,
            op?.verificationStat === 'verified' ? styles.badgeVerified : styles.badgePending,
          ]}>
            <Text style={[
              styles.badgeText,
              op?.verificationStat === 'verified' ? styles.badgeTextVerified : styles.badgeTextPending,
            ]}>
              {op?.verificationStat === 'verified' ? '✓ Verified' : 'Pending Verification'}
            </Text>
          </View>
        </View>

        {editing ? (
          <View style={styles.editCard}>
            <TextField
              label="First Name"
              value={firstName}
              onChangeText={setFirstName}
              autoCapitalize="words"
            />
            <TextField
              label="Last Name"
              value={lastName}
              onChangeText={setLastName}
              autoCapitalize="words"
            />
            <TextField
              label="Boat Name"
              value={boatName}
              onChangeText={setBoatName}
              autoCapitalize="words"
              placeholder="e.g. Maria Bangka"
            />
            <TextField
              label="Capacity (passengers)"
              value={capacity}
              onChangeText={setCapacity}
              keyboardType="number-pad"
              placeholder="10"
            />
            <View style={styles.editActions}>
              <PrimaryButton
                label="Cancel"
                variant="secondary"
                onPress={() => setEditing(false)}
                style={styles.editActionBtn}
              />
              <PrimaryButton
                label="Save"
                onPress={saveProfile}
                loading={savingProfile}
                disabled={savingProfile || !firstName.trim() || !lastName.trim()}
                style={styles.editActionBtn}
              />
            </View>
          </View>
        ) : (
          <View style={styles.editWrap}>
            <PrimaryButton
              label="Edit Profile"
              variant="secondary"
              onPress={startEdit}
            />
          </View>
        )}

        {op && !editing && (
          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Boat Name</Text>
              <Text style={styles.infoValue}>{displayBoat}</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Capacity</Text>
              <Text style={styles.infoValue}>
                {bangkaCapacity ? `${bangkaCapacity} pax` : '—'}
              </Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Permit Number</Text>
              <Text style={styles.infoValue}>{op.permitNumber ?? '—'}</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Status</Text>
              <Text style={[styles.infoValue, op.isAvailable ? styles.statusOnline : styles.statusOffline]}>
                {op.isAvailable ? 'Online' : 'Offline'}
              </Text>
            </View>
          </View>
        )}

        <Text style={styles.sectionLabel}>MENU</Text>
        <View style={styles.menuCard}>
          {MENU_ITEMS.map((item, i) => (
            <Pressable
              key={item.key}
              onPress={() => router.push(ROUTE_MAP[item.key] as any)}
              style={({ pressed }) => [
                styles.menuItem,
                i < MENU_ITEMS.length - 1 && styles.menuBorder,
                pressed && styles.menuPressed,
              ]}
            >
              <Text style={styles.menuIcon}>{item.icon}</Text>
              <Text style={styles.menuLabel}>{item.label}</Text>
              <Text style={styles.menuArrow}>›</Text>
            </Pressable>
          ))}
        </View>

        {!!error && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>{error}</Text>
          </View>
        )}

        <View style={styles.footer}>
          <PrimaryButton
            label="Sign Out"
            variant="danger"
            onPress={handleSignOut}
            loading={signingOut}
          />
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },

  header: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  initials: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '700',
  },
  name: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  phone: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  boatName: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  badge: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
  },
  badgeVerified: { backgroundColor: 'rgba(52,214,176,0.15)' },
  badgePending: { backgroundColor: 'rgba(232,169,60,0.15)' },
  badgeText: { fontSize: 12, fontWeight: '700' },
  badgeTextVerified: { color: colors.primary },
  badgeTextPending: { color: colors.warning },

  infoCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  infoLabel: { color: colors.textSecondary, fontSize: 14 },
  infoValue: { color: colors.text, fontSize: 14, fontWeight: '600' },
  statusOnline: { color: colors.primary },
  statusOffline: { color: colors.textMuted },
  divider: { height: 1, backgroundColor: colors.borderSubtle },

  sectionLabel: { ...typography.label, marginBottom: spacing.md },

  editWrap: { marginBottom: spacing.xl },
  editCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  editActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
  editActionBtn: { flex: 1 },

  menuCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  menuBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  menuPressed: { backgroundColor: colors.bgElevated },
  menuIcon: { fontSize: 18, marginRight: spacing.md },
  menuLabel: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '600' },
  menuArrow: { color: colors.textMuted, fontSize: 20 },

  banner: {
    backgroundColor: 'rgba(224,82,82,0.12)',
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  bannerText: { color: colors.danger, fontSize: 13, lineHeight: 18 },

  footer: { marginTop: spacing.xxl },
});
