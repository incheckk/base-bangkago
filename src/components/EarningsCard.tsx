import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing, typography } from '../theme/tokens';

interface Props {
  title: string;
  subtitle?: string;
  onPress?: () => void;
  rightIcon?: string;
}

export function EarningsCard({ title, subtitle, onPress, rightIcon = '→' }: Props) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.content}>
        <Text style={styles.title}>{title}</Text>
        {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      </View>
      {onPress && <Text style={styles.arrow}>{rightIcon}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pressed: { borderColor: colors.border },
  content: { flex: 1 },
  title: { color: colors.text, fontSize: 15, fontWeight: '700' },
  subtitle: { ...typography.caption, marginTop: 4 },
  arrow: { color: colors.primary, fontSize: 18, fontWeight: '700', marginLeft: spacing.md },
});
