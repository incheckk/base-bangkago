import { useState, useEffect, useCallback, useRef } from 'react';
import { useRealtimeQuery } from './useRealtimeQuery';
import {
  getActiveManifest,
  getManifestPassengers,
  getManifestParcels,
  finalizeManifest as finalizeManifestService,
} from '../services/manifest.service';
import type { TripManifestDoc, ManifestPassengerDoc, ManifestParcelDoc } from '../types/models';

interface Result {
  manifest: TripManifestDoc | null;
  passengers: ManifestPassengerDoc[];
  parcels: ManifestParcelDoc[];
  loading: boolean;
  error: string | null;
  finalizeManifest: () => Promise<void>;
}

export function useTripManifest(bangkeroId: string | null, includeCompleted = false): Result {
  const [manifest, setManifest] = useState<TripManifestDoc | null>(null);
  const [passengers, setPassengers] = useState<ManifestPassengerDoc[]>([]);
  const [parcels, setParcels] = useState<ManifestParcelDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!bangkeroId) { setManifest(null); setPassengers([]); setParcels([]); setLoading(false); return; }
    const id = ++seq.current;
    try {
      const m = await getActiveManifest(bangkeroId, includeCompleted);
      if (id !== seq.current) return;
      setManifest(m);
      if (m) {
        const [pax, prc] = await Promise.all([
          getManifestPassengers(m.manifestId),
          getManifestParcels(m.manifestId),
        ]);
        if (id !== seq.current) return;
        setPassengers(pax);
        setParcels(prc);
      } else {
        setPassengers([]);
        setParcels([]);
      }
      setLoading(false);
      setError(null);
    } catch (e: any) {
      if (id !== seq.current) return;
      setError(e.message ?? 'Failed to load manifest');
      setLoading(false);
    }
  }, [bangkeroId, includeCompleted]);

  useEffect(() => { void load(); }, [load]);
  // Children are subscribed too — boarding taps and parcel hand-offs mutate
  // manifest_passengers / manifest_parcels, not just the parent row.
  useRealtimeQuery(
    load,
    bangkeroId
      ? [
          { table: 'trip_manifest', filter: `bangkero_id=eq.${bangkeroId}` },
          { table: 'manifest_passengers' },
          { table: 'manifest_parcels' },
        ]
      : [],
  );

  const doFinalizeManifest = async () => {
    if (!manifest) return;
    try {
      await finalizeManifestService(manifest.manifestId);
      setManifest((prev) => (prev ? { ...prev, status: 'finalized' } : prev));
    } catch (e: any) {
      setError(e.message ?? 'Failed to finalize manifest');
    }
  };

  return { manifest, passengers, parcels, loading, error, finalizeManifest: doFinalizeManifest };
}
