import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '../theme/tokens';

interface Props {
  children: React.ReactNode;
  style?: ViewStyle;
  padded?: boolean;
}

export function ScreenContainer({ children, style, padded = true }: Props) {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={[styles.inner, padded && styles.padded, style]}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  inner: { flex: 1 },
  padded: { paddingHorizontal: spacing.xl },
});