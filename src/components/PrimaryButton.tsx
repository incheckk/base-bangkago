import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, ViewStyle } from 'react-native';
import { colors, radii, spacing } from '../theme/tokens';

interface Props {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
  style?: ViewStyle;
}

export function PrimaryButton({
  label, onPress, loading = false, disabled = false, variant = 'primary', style,
}: Props) {
  const isOff = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isOff, busy: loading }}
      onPress={onPress}
      disabled={isOff}
      style={({ pressed }) => [
        styles.base,
        variant === 'primary' && styles.primary,
        variant === 'secondary' && styles.secondary,
        variant === 'danger' && styles.danger,
        isOff && styles.disabled,
        pressed && !isOff && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.primaryText : colors.text} />
      ) : (
        <Text style={[
          styles.label,
          variant === 'primary' ? styles.labelPrimary : styles.labelOther,
          isOff && styles.labelDisabled,
        ]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 52, borderRadius: radii.md, alignItems: 'center',
    justifyContent: 'center', paddingHorizontal: spacing.lg,
  },
  primary: { backgroundColor: colors.primary },
  secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  danger: { backgroundColor: colors.danger },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.8 },
  label: { fontSize: 15, fontWeight: '700' },
  labelPrimary: { color: colors.primaryText },
  labelOther: { color: colors.text },
  labelDisabled: { color: colors.textOnDisabled },
});