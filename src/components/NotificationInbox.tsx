import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from './Icon';
import { ScreenContainer } from './ScreenContainer';
import { EmptyState, ErrorState, LoadingState } from './States';
import { useAuth } from '@/hooks/useAuth';
import { useNotifications } from '@/hooks/useNotifications';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import type { NotificationCategory } from '@/types/models';

/**
 * One inbox for both apps. The row is tinted by kind (079) so a safety
 * alert never looks like a booking receipt: colour + icon + label, never
 * colour alone.
 */
const KINDS: Record<NotificationCategory, { icon: IconName; color: string; tint: string; label: string }> = {
  booking: { icon: 'boat', color: colors.primary, tint: colors.primaryTint, label: 'Trip' },
  payment: { icon: 'cash', color: colors.sun, tint: colors.warningTint, label: 'Payment' },
  cargo: { icon: 'parcel', color: colors.info, tint: colors.infoTint, label: 'Cargo' },
  safety: { icon: 'sos', color: colors.danger, tint: colors.dangerTint, label: 'Safety' },
  account: { icon: 'profile', color: colors.textSecondary, tint: colors.neutralTint, label: 'Account' },
  system: { icon: 'info', color: colors.textMuted, tint: colors.neutralTint, label: 'BangkaGo' },
};

export function NotificationInbox({ header }: { header: React.ReactNode }) {
  const { user } = useAuth();
  const { data, loading, error, markAsRead, markAllRead, clearOld } = useNotifications(user?.id ?? null);

  // Opening the inbox IS the read receipt — the home badge clears through
  // realtime. Older-than-a-day rows go via the explicit button below.
  React.useEffect(() => {
    if (!user?.id) return;
    void markAllRead();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  if (loading) {
    return (
      <ScreenContainer padded={false}>
        {header}
        <LoadingState label="Loading notifications…" />
      </ScreenContainer>
    );
  }

  if (error) {
    return (
      <ScreenContainer padded={false}>
        {header}
        <ErrorState message={error} />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padded={false}>
      {header}
      <ScrollView contentContainerStyle={styles.scroll}>
        {data.length === 0 ? (
          <EmptyState icon="bell" title="No notifications" message="You're all caught up." />
        ) : (
          <>
            <Pressable style={styles.clearBtn} onPress={() => void clearOld()} hitSlop={8}>
              <Text style={styles.clearText}>Clear older than a day</Text>
            </Pressable>
            <View style={styles.list}>
              {data.map((n) => {
                const kind = KINDS[n.category] ?? KINDS.system;
                return (
                  <Pressable
                    key={n.notificationId}
                    onPress={() => markAsRead(n.notificationId)}
                    style={({ pressed }) => [
                      styles.card,
                      { borderLeftColor: kind.color },
                      !n.isRead && styles.cardUnread,
                      pressed && styles.cardPressed,
                    ]}
                  >
                    <View style={[styles.chip, { backgroundColor: kind.tint }]}>
                      <Icon name={kind.icon} size={18} color={kind.color} />
                    </View>
                    <View style={styles.cardContent}>
                      <View style={styles.metaRow}>
                        <Text style={[styles.kind, { color: kind.color }]}>{kind.label.toUpperCase()}</Text>
                        <Text style={styles.cardTime}>{formatTimeAgo(n.createdAt)}</Text>
                        {!n.isRead && <View style={[styles.dot, { backgroundColor: kind.color }]} />}
                      </View>
                      <Text style={styles.cardTitle}>{n.title}</Text>
                      <Text style={styles.cardMessage}>{n.message}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

function formatTimeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl, flexGrow: 1 },
  clearBtn: { alignSelf: 'flex-end', marginBottom: spacing.sm },
  clearText: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  list: { gap: spacing.md },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderLeftWidth: 3,
    padding: spacing.lg,
  },
  cardUnread: { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
  cardPressed: { opacity: 0.72 },
  chip: {
    width: 34, height: 34, borderRadius: radii.sm,
    alignItems: 'center', justifyContent: 'center',
    marginRight: spacing.md,
  },
  cardContent: { flex: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  kind: { ...typography.label, fontSize: 10, flex: 1 },
  cardTitle: { flexShrink: 1, ...typography.bodyStrong, marginBottom: spacing.xs },
  cardMessage: { flexShrink: 1, ...typography.caption, marginBottom: spacing.sm },
  cardTime: { flexShrink: 1, color: colors.textMuted, fontSize: 11 },
  dot: { width: 7, height: 7, borderRadius: 4 },
});
