import React, { useState } from 'react';
import {
  KeyboardTypeOptions, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { colors, radii, spacing, typography } from '../theme/tokens';

interface Props {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  secure?: boolean;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: 'none' | 'words' | 'sentences';
  error?: string | null;
  maxLength?: number;
  editable?: boolean;
}

export function TextField({
  label, value, onChangeText, placeholder, secure = false,
  keyboardType = 'default', autoCapitalize = 'none',
  error = null, maxLength, editable = true,
}: Props) {
  const [hidden, setHidden] = useState(secure);
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label.toUpperCase()}</Text>
      <View style={[
        styles.field,
        focused && styles.fieldFocused,
        !!error && styles.fieldError,
        !editable && styles.fieldDisabled,
      ]}>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          secureTextEntry={hidden}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          maxLength={maxLength}
          editable={editable}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        {secure && (
          <Pressable onPress={() => setHidden((h) => !h)} hitSlop={10}>
            <Text style={styles.toggle}>{hidden ? 'Show' : 'Hide'}</Text>
          </Pressable>
        )}
      </View>
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.lg },
  label: { ...typography.label, marginBottom: spacing.sm },
  field: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
    borderRadius: radii.md, borderWidth: 1, borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.lg, height: 52,
  },
  fieldFocused: { borderColor: colors.primary },
  fieldError: { borderColor: colors.danger },
  fieldDisabled: { opacity: 0.5 },
  input: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 0 },
  toggle: { color: colors.primary, fontSize: 13, fontWeight: '600' },
  error: { color: colors.danger, fontSize: 12, marginTop: spacing.xs },
});