import { useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { AppState } from 'react-native';

import { reportPosition } from '../services/tracking.service';

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

          try {
            // Logs the fix AND syncs this boat's port-queue presence (008).
            await reportPosition(
              bangkaId,
              pos.coords.latitude,
              pos.coords.longitude,
              pos.coords.speed ?? undefined
            );
          } catch (e) {
            // Silent fail for position logging
          }
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
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active' && !watchRef.current) void startTracking();
    });
    return () => sub.remove();
  });

  return { location, errorMsg, isTracking, startTracking, stopTracking };
}
