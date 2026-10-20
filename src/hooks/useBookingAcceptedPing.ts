import { useEffect, useRef } from 'react';

import { useChannelId } from './useChannelId';
import { supabase } from '../services/supabase';
import { alertPing } from '../utils/feedback';

/**
 * Sound + vibration the moment a bangkero accepts this passenger's trip, and
 * on every notification the bangkero sends ("Boat is ready"). Mounted in the
 * passenger layout so it fires on whatever screen they are waiting on — local
 * notifications are a no-op in Expo Go on Android, and a silent accept is the
 * whole demo falling flat.
 */
export function useBookingAcceptedPing(uid: string | null) {
  const channelId = useChannelId();
  /** One ping per booking, even if several UPDATE events land. */
  const pingedRef = useRef<Set<string>>(new Set());
  /** Notifications can arrive in bursts — one ping per couple of seconds. */
  const lastNotifPingRef = useRef(0);

  useEffect(() => {
    if (!uid) return;
    const channel = supabase
      .channel(`accepted-ping-${uid}-${channelId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'bookings', filter: `user_id=eq.${uid}` },
        (payload) => {
          const next = payload.new as { id?: string; trip_stat?: string };
          const prev = payload.old as { trip_stat?: string } | null;
          if (next.trip_stat !== 'accepted') return;
          if (prev?.trip_stat === 'accepted') return;
          if (next.id && pingedRef.current.has(next.id)) return;
          if (next.id) pingedRef.current.add(next.id);
          alertPing();
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${uid}` },
        () => {
          const now = Date.now();
          if (now - lastNotifPingRef.current < 2000) return;
          lastNotifPingRef.current = now;
          alertPing();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [uid, channelId]);
}
