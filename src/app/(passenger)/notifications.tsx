import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ScreenContainer } from '@/components/ScreenContainer';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { useAuth } from '@/hooks/useAuth';
import { useNotifications } from '@/hooks/useNotifications';
import { colors, radii, spacing, typography } from '@/theme/tokens';

export default function NotificationsScreen() {
  const { user } = useAuth();
  const { data, loading, error, markAsRead } = useNotifications(user?.id ?? null);

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
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.back} onPress={() => router.back()}>← Back</Text>
        <Text style={styles.eyebrow}>ALERTS</Text>
        <Text style={styles.title}>Notifications</Text>

        {data.length === 0 ? (
          <EmptyState
            icon="🔔"
            title="No notifications"
            message="You're all caught up!"
          />
        ) : (
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
  back: { color: colors.primary, fontSize: 14, fontWeight: '600', marginBottom: spacing.lg },
  eyebrow: { ...typography.label, marginBottom: 2 },
  title: { ...typography.h1, marginBottom: spacing.xl },
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
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: '700', marginBottom: spacing.xs },
  cardMessage: { color: colors.textSecondary, fontSize: 13, lineHeight: 18, marginBottom: spacing.sm },
  cardTime: { color: colors.textMuted, fontSize: 12 },
});
