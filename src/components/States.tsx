import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from './PrimaryButton';
import { colors, spacing, typography } from '../theme/tokens';

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.primary} size="large" />
      <Text style={styles.caption}>{label}</Text>
    </View>
  );
}

export function EmptyState({
  icon = '⚓', title, message,
}: { icon?: string; title: string; message: string }) {
  return (
    <View style={styles.center}>
      <Text style={styles.icon}>{icon}</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.caption}>{message}</Text>
    </View>
  );
}

export function ErrorState({
  message, onRetry,
}: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.center}>
      <Text style={styles.icon}>⚠️</Text>
      <Text style={styles.title}>Something went wrong</Text>
      <Text style={styles.caption}>{message}</Text>
      {onRetry && (
        <PrimaryButton
          label="Try again" onPress={onRetry}
          variant="secondary" style={{ marginTop: spacing.xl, minWidth: 160 }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: spacing.xl, paddingVertical: spacing.xxl,
  },
  icon: { fontSize: 40, marginBottom: spacing.md },
  title: { ...typography.h2, marginBottom: spacing.sm, textAlign: 'center' },
  caption: { ...typography.caption, textAlign: 'center', marginTop: spacing.sm },
});