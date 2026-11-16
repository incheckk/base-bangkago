import type { BookingDoc } from '../types/models';
import { manilaDayStartMs, manilaTodayIso } from './date';

/**
 * Earnings = completed trips' fares, bucketed by the Manila day the trip
 * completed. The fare is collected on board, so completion is the earn
 * event; a `payments` row is never guaranteed.
 *
 * One helper for Home and the Earnings screen so the two can never disagree.
 * A released escrow payout is that same fare arriving later — it belongs in
 * the history list, not in these totals.
 */
export interface EarningsSummary {
  today: number;
  week: number;
  month: number;
  allTime: number;
}

export function summarizeEarnings(trips: BookingDoc[]): EarningsSummary {
  const todayIso = manilaTodayIso();
  const todayStart = manilaDayStartMs(todayIso);
  const weekStart = todayStart - 6 * 86400000;
  const monthStart = manilaDayStartMs(`${todayIso.slice(0, 7)}-01`);

  const out: EarningsSummary = { today: 0, week: 0, month: 0, allTime: 0 };
  for (const t of trips) {
    if (t.status !== 'completed' || !t.completedAt) continue;
    const ms = new Date(t.completedAt).getTime();
    if (Number.isNaN(ms)) continue;
    out.allTime += t.totalPrice;
    if (ms >= monthStart) out.month += t.totalPrice;
    if (ms >= weekStart) out.week += t.totalPrice;
    if (ms >= todayStart) out.today += t.totalPrice;
  }
  return out;
}

/** Completed trips, newest completion first — the earnings history feed. */
export function completedTrips(trips: BookingDoc[]): BookingDoc[] {
  return trips
    .filter((t) => t.status === 'completed' && t.completedAt)
    .sort((a, b) => Date.parse(b.completedAt as string) - Date.parse(a.completedAt as string));
}
