import { type Href, router } from 'expo-router';

/**
 * Go back if possible, otherwise replace with the fallback route.
 * Used by sidebar navigation (which replaces screens) so the back button
 * always has somewhere to land.
 */
export function safeBack(fallback: Href) {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace(fallback);
  }
}

let lastNavAt = 0;

/**
 * One navigation per tap burst. Two taps 300 ms apart otherwise push the
 * same screen twice, which looks like a slow button (the first screen is
 * still mounting) and leaves the back button to unwind both.
 */
export function goOnce(navigate: () => void, gapMs = 800) {
  const now = Date.now();
  if (now - lastNavAt < gapMs) return;
  lastNavAt = now;
  navigate();
}
