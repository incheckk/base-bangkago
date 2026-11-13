import React from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { ICONS, Icon, type IconName } from './Icon';
import { PrimaryButton } from './PrimaryButton';
import { colors, radii, spacing, typography } from '../theme/tokens';

const isIconName = (s: string): s is IconName => s in ICONS;

/** Renders a vector icon when given an IconName, otherwise falls back to text
 *  so screens still passing emoji keep working until they are migrated. */
function StateGlyph({ icon, tint }: { icon: string; tint: string }) {
  if (isIconName(icon)) {
    return (
      <View style={[styles.glyphRing, { borderColor: tint }]}>
        <Icon name={icon} size={26} color={tint} />
      </View>
    );
  }
  return <Text style={styles.icon}>{icon}</Text>;
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  // Same idea as the web loader: the brand boat riding a slow swell. Every
  // screen runs its page loads through here, so one component covers all
  // roles; native driver keeps it off the JS thread during the fetch.
  const [bob] = React.useState(() => new Animated.Value(0));
  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, {
          toValue: 1, duration: 850, easing: Easing.inOut(Easing.quad), useNativeDriver: true,
        }),
        Animated.timing(bob, {
          toValue: 0, duration: 850, easing: Easing.inOut(Easing.quad), useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [bob]);

  return (
    <View
      style={styles.center}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
    >
      <View style={styles.loaderRing}>
        <Animated.View
          style={{
            transform: [
              { translateY: bob.interpolate({ inputRange: [0, 1], outputRange: [3, -3] }) },
              { rotate: bob.interpolate({ inputRange: [0, 1], outputRange: ['-4deg', '4deg'] }) },
            ],
          }}
        >
          <Icon name="boat" size={28} color={colors.primary} />
        </Animated.View>
      </View>
      <Text style={styles.caption}>{label}</Text>
    </View>
  );
}

export function EmptyState({
  icon = '⚓', title, message,
}: { icon?: string; title: string; message: string }) {
  return (
    <View style={styles.center}>
      <StateGlyph icon={icon} tint={colors.textMuted} />
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
  loaderRing: {
    width: 64, height: 64, borderRadius: radii.pill,
    backgroundColor: colors.primaryTint,
    borderWidth: 1, borderColor: colors.primaryBorder,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.md,
  },
  glyphRing: {
    width: 56, height: 56, borderRadius: 999,
    borderWidth: 1, alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.md, opacity: 0.9,
  },
  title: { ...typography.h2, marginBottom: spacing.sm, textAlign: 'center' },
  caption: { ...typography.caption, textAlign: 'center', marginTop: spacing.sm },
});