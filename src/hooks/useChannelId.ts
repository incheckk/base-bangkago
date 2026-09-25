import { useState } from 'react';

let seq = 0;

/**
 * Stable-per-instance id for realtime channel topics.
 *
 * supabase.channel() returns an existing channel when the topic already exists,
 * and RealtimeChannel.on('postgres_changes', …) throws once that channel is
 * subscribed — so two hook instances sharing a topic crash the screen. Mint a
 * unique topic per instance instead.
 */
export function useChannelId(): string {
  const [id] = useState(() => `c${++seq}`);
  return id;
}
