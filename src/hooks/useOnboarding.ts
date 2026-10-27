import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

/**
 * Keyed by uid, not by a single global flag: two people sharing the demo
 * phone each get their own first run, and signing out and back in does not
 * replay the tour.
 */
const seenKey = (uid: string) => `bangkago:tour-seen:${uid}`;

/**
 * A replay asked for on one screen has to reach the hook instance on another.
 *
 * The tutorial runs on the home screen, but it is replayed from Profile —
 * two separate instances of this hook. Clearing the stored key alone does not
 * help, because home's effect only re-reads when the uid changes. This
 * counter is what tells every instance to look again.
 */
let VERSION = 0;
const LISTENERS = new Set<() => void>();

/** Clear the flag and tell every mounted instance to re-read it. */
export async function requestReplay(uid: string | null) {
  if (!uid) return;
  try {
    await AsyncStorage.removeItem(seenKey(uid));
  } catch {
    // Unreadable storage already means "never seen" below.
  }
  VERSION += 1;
  LISTENERS.forEach((fn) => fn());
}

/**
 * "Has this account seen the welcome tour yet?"
 *
 * Local to the device on purpose — it is a UI preference, not a fact about
 * the trip record, so it needs no column and no migration. The cost is that
 * reinstalling replays the tour once, which is the right failure: showing a
 * short guide twice is better than hiding it from someone who needs it.
 */
export function useOnboarding(uid: string | null) {
  const [show, setShow] = useState(false);
  const [checked, setChecked] = useState(false);
  const [version, setVersion] = useState(VERSION);

  useEffect(() => {
    const fn = () => setVersion(VERSION);
    LISTENERS.add(fn);
    return () => { LISTENERS.delete(fn); };
  }, []);

  useEffect(() => {
    let alive = true;
    if (!uid) {
      setShow(false);
      setChecked(false);
      return;
    }
    AsyncStorage.getItem(seenKey(uid))
      .then((v) => {
        if (!alive) return;
        setShow(v === null);
        setChecked(true);
      })
      .catch(() => {
        // Storage unreadable — never let a tutorial block the app.
        if (!alive) return;
        setShow(false);
        setChecked(true);
      });
    return () => {
      alive = false;
    };
  }, [uid, version]);

  /** Finishing and skipping are the same thing: never show it again. */
  const dismiss = useCallback(() => {
    setShow(false);
    if (uid) AsyncStorage.setItem(seenKey(uid), '1').catch(() => {});
  }, [uid]);

  return { show: checked && show, dismiss };
}
