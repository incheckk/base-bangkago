import { useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { AppState } from 'react-native';

import {
  enqueueFix,
  flushOutbox,
  reportPosition,
  type TrackFix,
} from '../services/tracking.service';

interface LocationState {
  latitude: number;
  longitude: number;
  speed: number | null;
  timestamp: number;
}

export function useLocationTracking(bangkaId: string | null) {
  const [location, setLocation] = useState<LocationState | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isTracking, setIsTracking] = useState(false);
  const watchRef = useRef<Location.LocationSubscription | null>(null);
  // Guards the async window between "ask for permission" and
  // "subscription exists" — two calls in that gap would leak a watcher.
  const startingRef = useRef(false);
  // The AppState listener below is registered once and must see the
  // boat currently being watched, not the id from the first render.
  const bangkaRef = useRef<string | null>(null);
  useEffect(() => {
    bangkaRef.current = bangkaId;
  }, [bangkaId]);

  /**
   * Try to drain the outbox. Offline at sea is the normal case: the
   * failure path keeps the queue and the next tick/AppState change
   * retries. A missing 056 RPC falls back to the legacy single-point
   * report so tracking still works on an un-migrated database.
   */
  const deliver = async (bangkaId: string, fix: TrackFix) => {
    try {
      await flushOutbox(bangkaId);
    } catch (e) {
      if ((e as { missingFunction?: boolean }).missingFunction) {
        try {
          await reportPosition(bangkaId, fix.lat, fix.lng, fix.speed ?? undefined);
        } catch {
          // offline — the fix stays in the outbox for the next flush
        }
      }
      // network failure — the fixes stay queued, nothing is lost
    }
  };

  const startTracking = async () => {
    if (!bangkaId) return;
    if (watchRef.current || startingRef.current) return;
    startingRef.current = true;
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setErrorMsg('Location permission denied');
        return;
      }

      setIsTracking(true);
      setErrorMsg(null);

      watchRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 10000,
          distanceInterval: 50,
        },
        async (pos) => {
          const state: LocationState = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            speed: pos.coords.speed,
            timestamp: pos.timestamp,
          };
          setLocation(state);

          // Local write FIRST — the fix survives a dead connection and a
          // killed app. Then try to sync the whole backlog (056).
          const fix: TrackFix = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            speed: pos.coords.speed ?? null,
            recordedAt: new Date(pos.timestamp).toISOString(),
          };
          try {
            await enqueueFix(bangkaId, fix);
          } catch {
            return; // storage failed — nothing to flush, try next tick
          }
          await deliver(bangkaId, fix);
        }
      );
    } finally {
      startingRef.current = false;
    }
  };

  const stopTracking = () => {
    watchRef.current?.remove();
    watchRef.current = null;
    setIsTracking(false);
  };

  useEffect(() => {
    return () => {
      watchRef.current?.remove();
    };
  }, []);

  // Coming back to the foreground with no watcher running covers the
  // two real-world paths: permission was just granted in Settings, or
  // the OS dropped the watch. Denied requests return silently while a
  // watcher is already up, so this never spams the permission dialog.
  // Every return to the foreground also retries the offline outbox —
  // signal often comes back with the app, not with a new GPS tick.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      const id = bangkaRef.current;
      if (id) void flushOutbox(id).catch(() => {});
      if (!watchRef.current) void startTracking();
    });
    return () => sub.remove();
  });

  return { location, errorMsg, isTracking, startTracking, stopTracking };
}
