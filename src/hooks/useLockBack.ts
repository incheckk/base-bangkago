import { useEffect } from 'react';
import { BackHandler } from 'react-native';

/**
 * Absorb the Android hardware back gesture while this screen is mounted.
 * Terminal success screens use it so the only way out is the screen's own
 * buttons (which `router.replace`) — back can never walk into the payment
 * form or the completed-transaction screen and re-run it.
 */
export function useLockBack() {
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);
}
