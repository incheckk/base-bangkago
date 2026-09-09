import { useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { logPosition } from '../services/tracking.service';

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

  const startTracking = async () => {
    if (!bangkaId) return;

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
          await logPosition(
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

  return { location, errorMsg, isTracking, startTracking, stopTracking };
}
