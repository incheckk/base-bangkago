import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { Platform, Vibration } from 'react-native';

/**
 * The "someone needs you" ping: vibration (always works in Expo Go) plus a
 * short bundled tone. Used when a bangkero accepts a booking and when they
 * press Notify — the local notifications service is a no-op in Expo Go on
 * Android, so this is the only guarantee of sound there.
 */
const PING = require('../../assets/sounds/ping.wav');

let player: ReturnType<typeof createAudioPlayer> | null = null;
let audioModeSet = false;

export function alertPing() {
  if (Platform.OS !== 'web') {
    Vibration.vibrate([0, 120, 80, 160]);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }
  try {
    if (!audioModeSet) {
      audioModeSet = true;
      setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
    }
    if (!player) player = createAudioPlayer(PING);
    // Rewind, then play — a bare play() after the first ping would be a no-op.
    const p = player;
    Promise.resolve(p.seekTo(0)).then(() => p.play()).catch(() => {});
  } catch {
    // A device that refuses audio still got the vibration.
  }
}
