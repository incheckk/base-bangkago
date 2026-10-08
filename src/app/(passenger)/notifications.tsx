import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PassengerScreenHeader } from '@/components/PassengerScreenHeader';
import { ScreenContainer } from '@/components/ScreenContainer';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { useAuth } from '@/hooks/useAuth';
import { useNotifications } from '@/hooks/useNotifications';
import { colors, radii, spacing, typography } from '@/theme/tokens';

export default function NotificationsScreen() {
  const { user } = useAuth();
  const { data, loading, error, markAsRead, markAllRead, clearOld } = useNotifications(user?.id ?? null);

  // Opening the inbox IS the read receipt — the home badge clears through
  // realtime. Older-than-a-day rows go via the explicit button below.
  useEffect(() => {
    if (!user?.id) return;
    void markAllRead();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  if (loading) {
    return (
      <ScreenContainer>
        <LoadingState label="Loading notifications…" />
      </ScreenContainer>
    );
  }

  if (error) {
    return (
      <ScreenContainer>
        <ErrorState message={error} />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padded={false}>
      <PassengerScreenHeader title="Notifications" subtitle="ALERTS" />
      <ScrollView contentContainerStyle={styles.scroll}>

        {data.length === 0 ? (
          <EmptyState
            icon="🔔"
            title="No notifications"
            message="You're all caught up!"
          />
        ) : (
          <>
            <Pressable style={styles.clearBtn} onPress={() => void clearOld()} hitSlop={8}>
              <Text style={styles.clearText}>Clear older than a day</Text>
            </Pressable>
            <View style={styles.list}>
              {data.map((n) => (
                <Pressable
                  key={n.notificationId}
                  onPress={() => markAsRead(n.notificationId)}
                  style={[styles.card, !n.isRead && styles.cardUnread]}
                >
                  {!n.isRead && <View style={styles.dot} />}
                  <View style={styles.cardContent}>
                    <Text style={styles.cardTitle}>{n.title}</Text>
                    <Text style={styles.cardMessage}>{n.message}</Text>
                    <Text style={styles.cardTime}>{formatTimeAgo(n.createdAt)}</Text>
                  </View>
                </Pressable>
              ))}
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
    padding: spacing.lg,
  },
  cardUnread: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
    marginRight: spacing.md,
    marginTop: spacing.xs,
  },
  cardContent: { flex: 1 },
  cardTitle: { flexShrink: 1, color: colors.text, fontSize: 15, fontWeight: '700', marginBottom: spacing.xs },
  cardMessage: { flexShrink: 1, color: colors.textSecondary, fontSize: 13, lineHeight: 18, marginBottom: spacing.sm },
  cardTime: { flexShrink: 1, color: colors.textMuted, fontSize: 12 },
});
