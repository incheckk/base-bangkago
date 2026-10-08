import React, { useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radii, spacing } from '../theme/tokens';

// =============================================================
// Horizontal strip + edge chevron: shows "there is more to the
// right" only while there actually is, so date strips that fit
// on screen stay clean. Re-renders only on the boolean.
// =============================================================

interface Props {
  children: React.ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
}

export function ScrollHintBar({ children, contentContainerStyle }: Props) {
  const [moreRight, setMoreRight] = useState(false);
  const size = useRef({ w: 0, contentW: 0, x: 0 });

  const update = () => {
    const { w, contentW, x } = size.current;
    setMoreRight(contentW > w + 8 && x + w < contentW - 8);
  };

  return (
    <View style={styles.wrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={contentContainerStyle}
        onLayout={(e) => {
          size.current.w = e.nativeEvent.layout.width;
          update();
        }}
        onContentSizeChange={(w) => {
          size.current.contentW = w;
          update();
        }}
        onScroll={(e) => {
          size.current.x = e.nativeEvent.contentOffset.x;
          update();
        }}
        scrollEventThrottle={32}
      >
        {children}
      </ScrollView>
      {moreRight && (
        <View pointerEvents="none" style={styles.hint}>
          <View style={styles.hintPill}>
            <Text style={styles.hintChevron}>›</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative' },
  hint: {
    position: 'absolute', right: 0, top: 0, bottom: 0,
    alignItems: 'flex-end', justifyContent: 'center',
    paddingLeft: spacing.xs,
  },
  hintPill: {
    width: 22, height: 34,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    borderWidth: 1, borderColor: colors.borderSubtle,
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 4, shadowOffset: { width: -2, height: 0 },
    elevation: 3,
  },
  hintChevron: { fontSize: 20, lineHeight: 22, fontWeight: '700', color: colors.textSecondary },
});
