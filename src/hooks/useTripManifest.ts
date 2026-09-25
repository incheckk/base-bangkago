import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { useChannelId } from './useChannelId';
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
  const channelId = useChannelId();

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

    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase.channel(`manifest-changes-${channelId}`);
      channel
        .on('postgres_changes', { event: '*', schema: 'public', table: 'trip_manifest', filter: `bangkero_id=eq.${bangkeroId}` }, load)
        .subscribe();
    } catch {
      // realtime unavailable — the screen keeps working without live updates
    }

    return () => { cancelled = true; if (channel) supabase.removeChannel(channel); };
  }, [bangkeroId, channelId]);

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
