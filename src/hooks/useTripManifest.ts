import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
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

export function useTripManifest(bangkeroId: string | null): Result {
  const [manifest, setManifest] = useState<TripManifestDoc | null>(null);
  const [passengers, setPassengers] = useState<ManifestPassengerDoc[]>([]);
  const [parcels, setParcels] = useState<ManifestParcelDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bangkeroId) { setManifest(null); setPassengers([]); setParcels([]); setLoading(false); return; }
    let cancelled = false;

    const load = async () => {
      try {
        const m = await getActiveManifest(bangkeroId);
        if (cancelled) return;
        setManifest(m);
        if (m) {
          const [pax, prc] = await Promise.all([
            getManifestPassengers(m.manifestId),
            getManifestParcels(m.manifestId),
          ]);
          if (cancelled) return;
          setPassengers(pax);
          setParcels(prc);
        }
        setLoading(false);
        setError(null);
      } catch (e: any) {
        if (cancelled) return;
        setError(e.message ?? 'Failed to load manifest');
        setLoading(false);
      }
    };

    load();

    const channel = supabase
      .channel('manifest-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trip_manifest', filter: `bangkero_id=eq.${bangkeroId}` }, load)
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [bangkeroId]);

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
