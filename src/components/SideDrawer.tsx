import React, { useState } from 'react';
import { Animated, Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing, typography } from '../theme/tokens';

interface DrawerItem {
  icon: string;
  label: string;
  onPress: () => void;
  danger?: boolean;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  items: DrawerItem[];
  title?: string;
}

const SCREEN_WIDTH = Dimensions.get('window').width;
const DRAWER_WIDTH = SCREEN_WIDTH * 0.75;

export function SideDrawer({ visible, onClose, items, title }: Props) {
  const [offset] = useState(new Animated.Value(-DRAWER_WIDTH));

  React.useEffect(() => {
    Animated.timing(offset, {
      toValue: visible ? 0 : -DRAWER_WIDTH,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [visible]);

  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <Animated.View style={[styles.drawer, { transform: [{ translateX: offset }] }]}>
        {title && <Text style={styles.title}>{title}</Text>}
        {items.map((item, i) => (
          <Pressable
            key={i}
            onPress={() => { item.onPress(); onClose(); }}
            style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
          >
            <Text style={styles.icon}>{item.icon}</Text>
            <Text style={[styles.label, item.danger && styles.labelDanger]}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 1000 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  drawer: {
    position: 'absolute',
    left: 0, top: 0, bottom: 0,
    width: DRAWER_WIDTH,
    backgroundColor: colors.bgElevated,
    paddingTop: 60,
    paddingHorizontal: spacing.xl,
  },
  title: { ...typography.h2, marginBottom: spacing.xl, paddingHorizontal: spacing.lg },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    marginBottom: spacing.xs,
  },
  itemPressed: { backgroundColor: colors.surface },
  icon: { fontSize: 20 },
  label: { color: colors.text, fontSize: 15, fontWeight: '600' },
  labelDanger: { color: colors.danger },
});
