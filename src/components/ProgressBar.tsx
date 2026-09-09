import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing } from '../theme/tokens';

interface Props {
  steps: string[];
  current: number;
}

export function ProgressBar({ steps, current }: Props) {
  return (
    <View style={styles.container}>
      {steps.map((step, i) => {
        const isActive = i === current;
        const isDone = i < current;
        return (
          <View key={step} style={styles.stepWrap}>
            <View style={[styles.dot, isDone && styles.dotDone, isActive && styles.dotActive]}>
              <Text style={[styles.dotText, (isDone || isActive) && styles.dotTextActive]}>
                {isDone ? '✓' : i + 1}
              </Text>
            </View>
            <Text style={[styles.label, isActive && styles.labelActive, isDone && styles.labelDone]}>
              {step}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  stepWrap: { alignItems: 'center', flex: 1 },
  dot: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 2, borderColor: colors.borderSubtle,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  dotDone: { backgroundColor: colors.primary, borderColor: colors.primary },
  dotActive: { backgroundColor: colors.primaryDark, borderColor: colors.primary, borderWidth: 2 },
  dotText: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  dotTextActive: { color: colors.text },
  label: { color: colors.textMuted, fontSize: 10, fontWeight: '600', textAlign: 'center' },
  labelActive: { color: colors.primary },
  labelDone: { color: colors.textSecondary },
});
