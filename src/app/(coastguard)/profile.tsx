import { StyleSheet, Text, View } from 'react-native';

import { AdminScreenHeader } from '@/components/AdminScreenHeader';
import { ScreenContainer } from '@/components/ScreenContainer';
import { useAuth } from '@/hooks/useAuth';
import { colors, radii, spacing, typography } from '@/theme/tokens';

/**
 * Read-only identity card for the coastguard/LGU tier — no edits, no
 * settings; the sidebar already carries Sign out.
 */
export default function CoastguardProfile() {
  const { profile } = useAuth();

  const name = profile ? `${profile.firstName} ${profile.lastName}`.trim() : '';
  const initials = name
    ? name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
    : 'CG';

  return (
    <ScreenContainer padded={false}>
      <AdminScreenHeader role="coastguard" title="Profile" />
      <View style={styles.wrap}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.role}>COASTGUARD / LGU · VIEW ONLY</Text>
        {!!profile?.phone && <Text style={styles.phone}>{profile.phone}</Text>}
        <Text style={styles.hint}>
          This tier can watch live port queues and fares. Editing ports, routes
          and users stays with the admin.
        </Text>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.xl, paddingTop: spacing.xxl, alignItems: 'center', gap: spacing.sm },
  avatar: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: colors.primary,
    justifyContent: 'center', alignItems: 'center', marginBottom: spacing.sm,
  },
  avatarText: { color: colors.primaryText, fontSize: 22, fontWeight: '700' },
  name: { ...typography.title, color: colors.text },
  role: { ...typography.micro, color: colors.primary, letterSpacing: 1, fontWeight: '700' },
  phone: { ...typography.body, color: colors.textSecondary },
  hint: {
    ...typography.caption, color: colors.textMuted, textAlign: 'center',
    marginTop: spacing.lg, backgroundColor: colors.surface, borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.borderSubtle, padding: spacing.md, lineHeight: 18,
  },
});
