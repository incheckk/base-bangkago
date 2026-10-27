import { useCallback, useEffect, useRef, useState } from 'react';
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import type { View as RNView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, elevation, radii, spacing, touchTarget, typography } from '../theme/tokens';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

/** Breathing room around the highlighted control. */
const PAD = 8;

export interface Rect { x: number; y: number; width: number; height: number }

export interface CoachStep {
  /** Matches the id passed to `useCoachTarget` on the control being taught. */
  target: string;
  title: string;
  body: string;
  /** Shown instead of "Next" when the user must tap the control itself. */
  action?: string;
}

/**
 * A module-level registry rather than a React context.
 *
 * Deliberate: a context would have to be mounted in every role's `_layout`,
 * and the passenger sheet measures inside a transformed parent that sits
 * outside any provider a screen could reasonably wrap. A registry keyed by id
 * lets a control announce itself from anywhere and the overlay read it
 * without the two being related in the tree.
 */
const RECTS: Record<string, Rect> = {};
const LISTENERS = new Set<() => void>();
/** Every mounted target's own measure function, so the overlay can ask them
 *  all to re-measure when it opens. */
const MEASURERS = new Map<string, () => void>();

/**
 * Re-measure every mounted target.
 *
 * `onLayout` fires only when layout CHANGES, and a measure taken during that
 * first pass can come back 0x0 on Android before the view is attached — so
 * relying on it alone left the registry empty and the overlay with nothing to
 * ring. The overlay calls this when it opens and on every step.
 */
export function remeasureAll() {
  MEASURERS.forEach((fn) => fn());
}

function publish(id: string, rect: Rect | null) {
  if (rect === null) {
    if (!(id in RECTS)) return;
    delete RECTS[id];
  } else {
    const prev = RECTS[id];
    // Layout fires constantly; only wake the overlay when a highlighted
    // control has actually moved.
    if (prev && prev.x === rect.x && prev.y === rect.y
      && prev.width === rect.width && prev.height === rect.height) return;
    RECTS[id] = rect;
  }
  LISTENERS.forEach((fn) => fn());
}

/** Subscribes the overlay to target positions. */
export function useCoachRects(): Record<string, Rect> {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    LISTENERS.add(fn);
    return () => { LISTENERS.delete(fn); };
  }, []);
  return RECTS;
}

/**
 * Marks a control as teachable.
 *
 * Spread the result onto the View wrapping the control. It measures itself in
 * window coordinates whenever it lays out, which is what lets the overlay cut
 * a hole in exactly the right place on any screen size — no hardcoded
 * coordinates, and it follows the control if the layout changes.
 */
export function useCoachTarget(id: string) {
  const ref = useRef<RNView>(null);

  const onLayout = useCallback(() => {
    // measureInWindow, not onLayout's own rect: it reports window coordinates
    // and accounts for the control sitting inside a transformed parent, which
    // the passenger sheet is. The rAF lets that transform settle first.
    requestAnimationFrame(() => {
      ref.current?.measureInWindow((x, y, width, height) => {
        if (width > 0 && height > 0) publish(id, { x, y, width, height });
      });
    });
  }, [id]);

  // Publish the measure function so the overlay can re-run it on demand, and
  // unregister on unmount so a step never points at a control that has gone.
  useEffect(() => {
    MEASURERS.set(id, onLayout);
    return () => {
      MEASURERS.delete(id);
      publish(id, null);
    };
  }, [id, onLayout]);

  return { ref, onLayout, collapsable: false as const };
}

/**
 * The teaching overlay.
 *
 * Dimming is drawn as four rectangles AROUND the target rather than one sheet
 * with a cut-out. That is not a shortcut: because nothing is rendered over the
 * target, the user's tap lands on the real control underneath — so the
 * tutorial teaches by letting them actually do it, instead of miming it.
 */
export function CoachOverlay({
  visible, steps, rects, onDone,
}: {
  visible: boolean;
  steps: CoachStep[];
  rects: Record<string, Rect>;
  onDone: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);

  /**
   * Where this overlay's own top-left sits in the window.
   *
   * Targets are measured with `measureInWindow`, but the overlay is only
   * absoluteFill within ITS PARENT — and that parent is not always the
   * window. On the bangkero screen it is mounted inside ScreenContainer,
   * whose origin is below the safe area and header, so every ring was drawn
   * that far too low. Subtracting this origin converts window coordinates
   * into the overlay's own, wherever a screen chooses to mount it.
   */
  const rootRef = useRef<RNView>(null);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });

  /**
   * Ask every target where it is, each time the overlay opens and on every
   * step. The delayed second pass catches the sheet's transform settling and
   * Android's first-layout zeros — without it a replay rings nothing, because
   * no layout has changed since the first run.
   */
  useEffect(() => {
    if (!visible) return;
    const sync = () => {
      remeasureAll();
      rootRef.current?.measureInWindow((x, y) => setOrigin({ x, y }));
    };
    sync();
    const t = setTimeout(sync, 220);
    return () => clearTimeout(t);
  }, [visible, index]);

  if (!visible || steps.length === 0) return null;

  const i = Math.min(index, steps.length - 1);
  const step = steps[i];
  const target = rects[step.target];
  const last = i >= steps.length - 1;

  function finish() {
    setIndex(0);
    onDone();
  }
  function next() {
    if (last) finish();
    else setIndex((n) => n + 1);
  }

  // A step whose control is not on screen (a tile scrolled out of view, a
  // request list that is empty) is skipped rather than pointing at nothing.
  if (!target) {
    return (
      <View ref={rootRef} style={styles.full} pointerEvents="box-none">
        <View style={styles.dimAll} pointerEvents="auto" />
        <Bubble
          step={step} i={i} total={steps.length} last={last}
          top={SCREEN_H / 2 - 90} onNext={next} onSkip={finish}
        />
      </View>
    );
  }

  const hole = {
    x: Math.max(0, target.x - origin.x - PAD),
    y: Math.max(0, target.y - origin.y - PAD),
    w: target.width + PAD * 2,
    h: target.height + PAD * 2,
  };

  /**
   * The bubble is pinned to whichever end of the screen the target is NOT in,
   * rather than floating a fixed gap from the hole.
   *
   * Offsetting from the hole meant a target near an edge pushed the bubble
   * past it — the first step highlights the status bar, a few points from the
   * top, so the bubble was positioned off the screen entirely. Pinning cannot
   * overflow at any screen size, and the ring already shows where to look, so
   * the bubble does not need to hug it.
   */
  // Judged on the target's WINDOW position, since that is what the viewer
  // sees; `hole` is in the overlay's local space and would skew this by the
  // overlay's own offset.
  const targetInTopHalf = target.y + target.height / 2 < SCREEN_H * 0.5;
  const bubbleTop = targetInTopHalf ? undefined : insets.top + spacing.lg;
  const bubbleBottom = targetInTopHalf ? insets.bottom + spacing.lg : undefined;

  return (
    <View ref={rootRef} style={styles.full} pointerEvents="box-none">
      {/* Four dimmers; the gap between them IS the hole. */}
      <Pressable style={[styles.dim, { top: 0, left: 0, right: 0, height: hole.y }]} onPress={() => {}} />
      <Pressable style={[styles.dim, { top: hole.y + hole.h, left: 0, right: 0, bottom: 0 }]} onPress={() => {}} />
      <Pressable style={[styles.dim, { top: hole.y, left: 0, width: hole.x, height: hole.h }]} onPress={() => {}} />
      <Pressable
        style={[styles.dim, { top: hole.y, left: hole.x + hole.w, right: 0, height: hole.h }]}
        onPress={() => {}}
      />

      {/* The ring is pointerEvents none so it never eats the tap it points at. */}
      <View
        pointerEvents="none"
        style={[
          styles.ring,
          { top: hole.y, left: hole.x, width: hole.w, height: hole.h },
        ]}
      />

      <Bubble
        step={step} i={i} total={steps.length} last={last}
        top={bubbleTop} bottom={bubbleBottom}
        safeBottom={insets.bottom}
        onNext={next} onSkip={finish}
      />
    </View>
  );
}

function Bubble({
  step, i, total, last, top, bottom, safeBottom = 0, onNext, onSkip,
}: {
  step: CoachStep; i: number; total: number; last: boolean;
  top?: number; bottom?: number; safeBottom?: number;
  onNext: () => void; onSkip: () => void;
}) {
  return (
    <View
      style={[
        styles.bubble,
        top !== undefined ? { top } : null,
        bottom !== undefined ? { bottom: Math.max(bottom, safeBottom + spacing.md) } : null,
      ]}
    >
      <Text style={styles.count}>STEP {i + 1} OF {total}</Text>
      <Text style={styles.title}>{step.title}</Text>
      <Text style={styles.body}>{step.body}</Text>

      <View style={styles.row}>
        <Pressable
          onPress={onSkip}
          accessibilityRole="button"
          accessibilityLabel="Skip the tutorial"
          hitSlop={8}
          style={({ pressed }) => [styles.skip, pressed && styles.pressed]}
        >
          <Text style={styles.skipText}>Skip</Text>
        </Pressable>

        <Pressable
          onPress={onNext}
          accessibilityRole="button"
          style={({ pressed }) => [styles.next, pressed && styles.nextPressed]}
        >
          <Text style={styles.nextText}>{last ? 'Got it' : step.action ?? 'Next'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  full: { ...StyleSheet.absoluteFill, zIndex: 2000 },
  dim: { position: 'absolute', backgroundColor: 'rgba(4,14,22,0.82)' },
  dimAll: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(4,14,22,0.82)' },

  ring: {
    position: 'absolute',
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: colors.primary,
  },

  bubble: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    maxWidth: SCREEN_W - spacing.lg * 2,
    backgroundColor: colors.bgElevated,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    ...elevation.e3,
  },
  count: { ...typography.label, marginBottom: spacing.xxs },
  title: { ...typography.title, marginBottom: spacing.xs },
  body: { ...typography.caption, color: colors.textSecondary },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    gap: spacing.md,
  },
  skip: {
    minHeight: touchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  pressed: { opacity: 0.6 },
  skipText: { ...typography.bodyStrong, color: colors.textMuted },
  next: {
    minHeight: touchTarget,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextPressed: { backgroundColor: colors.primaryDark },
  nextText: { ...typography.bodyStrong, color: colors.primaryText, fontWeight: '700' },
});
