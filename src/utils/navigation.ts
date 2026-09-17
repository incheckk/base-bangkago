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
