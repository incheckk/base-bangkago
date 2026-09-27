import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { supabase } from '../services/supabase';
import { useChannelId } from './useChannelId';

export interface RealtimeSubscription {
  table: string;
  event?: 'INSERT' | 'UPDATE' | 'DELETE' | '*';
  filter?: string;
}

/** Focus and AppState events can land together — collapse them. */
const REFRESH_GAP_MS = 2000;

/** Keeps the newest `refetch` reachable from stable callbacks. */
function useStableRefetch(refetch: () => void) {
  const ref = useRef(refetch);
  useEffect(() => {
    ref.current = refetch;
  });
  return ref;
}

/**
 * The safety net under every subscription: refetch when the screen regains
 * focus and when the app returns to the foreground. Realtime can be
 * unpublished, dropped by the network, or silently errored — data is still
 * correct the moment the user looks at it. First focus is skipped: the hook's
 * own mount fetch already covered it.
 */
function useRefreshOnFocusAndForeground(refetchRef: React.MutableRefObject<() => void>) {
  const lastAtRef = useRef(Date.now());
  const firstFocusRef = useRef(true);

  const request = useCallback(() => {
    const now = Date.now();
    if (now - lastAtRef.current < REFRESH_GAP_MS) return;
    lastAtRef.current = now;
    refetchRef.current();
  }, [refetchRef]);

  useFocusEffect(
    useCallback(() => {
      if (firstFocusRef.current) {
        firstFocusRef.current = false;
        return;
      }
      request();
    }, [request]),
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') request();
    });
    return () => sub.remove();
  }, [request]);
}

/**
 * One realtime channel for a hook: re-runs `refetch` on any change to the
 * given tables, plus on screen focus and app foreground.
 *
 * Replaces the copy-pasted `supabase.channel(...).on(...).subscribe()` blocks.
 * Topics are unique per subscription *run* (a reused topic returns the old
 * channel and throws when re-adding callbacks), subscribe errors are logged
 * instead of swallowed, and a failed subscription still refetches so the
 * screen is never silently frozen.
 *
 * ```ts
 * const load = useCallback(async () => { … }, [portId]);
 * useEffect(() => { load(); }, [load]);
 * useRealtimeQuery(load, [{ table: 'weather_data', filter: `port_id=eq.${portId}` }]);
 * ```
 */
export function useRealtimeQuery(refetch: () => void, subscriptions: RealtimeSubscription[]): void {
  const channelId = useChannelId();
  const refetchRef = useStableRefetch(refetch);
  useRefreshOnFocusAndForeground(refetchRef);

  // Subscriptions are usually built inline — key on their content so a stable
  // array never re-subscribes and a changed filter always does.
  const key = JSON.stringify(subscriptions);
  const runRef = useRef(0);

  useEffect(() => {
    const specs = JSON.parse(key) as RealtimeSubscription[];
    if (specs.length === 0) return; // no params yet (e.g. signed-out) — focus/foreground still refresh
    const run = ++runRef.current;
    const tables = Array.from(new Set(specs.map((s) => s.table))).join('-');
    const topic = `live-${tables}-${channelId}-${run}`;
    const onChanged = () => refetchRef.current();

    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      let builder = supabase.channel(topic);
      for (const spec of specs) {
        builder = builder.on(
          'postgres_changes',
          {
            event: spec.event ?? '*',
            schema: 'public',
            table: spec.table,
            filter: spec.filter,
          },
          onChanged,
        );
      }
      channel = builder.subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          if (__DEV__) console.warn(`[realtime] ${topic} → ${status}`, err?.message ?? '');
          refetchRef.current();
        }
      });
    } catch (e) {
      if (__DEV__) console.warn(`[realtime] ${topic} failed`, (e as Error)?.message);
      refetchRef.current();
    }

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [key, channelId, refetchRef]);
}

/**
 * Focus + foreground refetch for screens that read through one-off
 * `useEffect` queries instead of a realtime hook.
 */
export function useRefetchOnFocus(refetch: () => void): void {
  const refetchRef = useStableRefetch(refetch);
  useRefreshOnFocusAndForeground(refetchRef);
}
