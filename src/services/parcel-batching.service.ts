/**
 * Parcel Padala — Batched mode service (Phase 1, Mode 3a).
 *
 * Batched delivery: parcel waits up to 1 hour for other parcels
 * going to the same destination on the same crossing. If ≥ 2 parcels
 * join, they sail together at ₱150 base. If solo at deadline, sender
 * either waits another hour OR pays ₱150 solo surcharge.
 *
 * Max wait: 3 cycles (3 hours). After that, solo fee auto-applies.
 */
import { supabase } from './supabase';
import { routeIdFor } from './booking.service';
import { PARCEL_RATES } from './parcel-pricing.service';
import type { ParcelDoc } from '../types/models';

export const BATCH_WINDOW_MINUTES = 60;
export const BATCH_MAX_CYCLES = 3;
export const BATCH_THRESHOLD = 2;

/**
 * Local YYYYMMDD key for the crossing day. Batching route keys are
 * day-scoped so stale queues from a previous day can never be counted.
 */
function ymd(date: Date): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Compute a route key for batching. Format: {from}__{to}-HHMM-YYYYMMDD
 * where HHMM is the target crossing time and YYYYMMDD its sailing day.
 */
export function computeBatchingRouteKey(params: {
  fromPortId: string;
  toPortId: string;
  crossingHour: number;
  crossingMinute: number;
  date?: string;
}): string {
  const hh = String(params.crossingHour).padStart(2, '0');
  const mm = String(params.crossingMinute).padStart(2, '0');
  return `${params.fromPortId}__${params.toPortId}-${hh}${mm}-${params.date ?? ymd(new Date())}`;
}

/**
 * Compute the next crossing time (as Date) for a route.
 * Crossings: 08:00, 12:00, 16:00 (from migration 041).
 * A parcel must be booked >= 1 hour before to make a crossing.
 */
export async function computeNextCrossing(
  fromPortId: string,
  toPortId: string,
  now: Date = new Date()
): Promise<Date | null> {
  const routeId = routeIdFor(fromPortId, toPortId);

  const { data, error } = await supabase
    .from('crossing_times')
    .select('departure_time')
    .eq('route_id', routeId)
    .eq('is_active', true)
    .order('departure_time', { ascending: true });

  if (error || !data || data.length === 0) return null;

  // Find the next crossing at least 1 hour from now
  const oneHourAhead = new Date(now.getTime() + BATCH_WINDOW_MINUTES * 60_000);
  const today = now.toISOString().slice(0, 10);

  for (const row of data) {
    const [hh, mm] = row.departure_time.split(':').map(Number);
    const candidate = new Date(`${today}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`);
    if (candidate >= oneHourAhead) return candidate;
  }

  // All today's crossings passed — use first crossing tomorrow
  const [hh, mm] = data[0].departure_time.split(':').map(Number);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);
  return new Date(`${tomorrowStr}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`);
}

/**
 * Put a parcel into the batching queue.
 * Sets batching_status='pending_batch', starts window, computes key.
 */
export async function assignToBatch(params: {
  parcelId: string;
  fromPortId: string;
  toPortId: string;
}): Promise<{ routeKey: string; deadlineAt: string; scheduledDepartureAt: string } | null> {
  const now = new Date();
  const crossing = await computeNextCrossing(params.fromPortId, params.toPortId, now);
  if (!crossing) return null;

  const deadlineAt = new Date(now.getTime() + BATCH_WINDOW_MINUTES * 60_000);
  const ETA_MINUTES = 30; // matches routes.estimated_minutes baseline
  const eta = new Date(crossing.getTime() + ETA_MINUTES * 60_000);
  const routeKey = computeBatchingRouteKey({
    fromPortId: params.fromPortId,
    toPortId: params.toPortId,
    crossingHour: crossing.getHours(),
    crossingMinute: crossing.getMinutes(),
    date: ymd(crossing),
  });

  const { error } = await supabase
    .from('parcels')
    .update({
      batching_status: 'pending_batch',
      batching_started_at: now.toISOString(),
      batching_deadline_at: deadlineAt.toISOString(),
      batching_route_key: routeKey,
      batching_cycle_count: 0,
      scheduled_departure_at: crossing.toISOString(),
      estimated_arrival_at: eta.toISOString(),
    })
    .eq('id', params.parcelId);

  if (error) return null;

  // Option B (045): link the parcel's own stub as its carrier so
  // carrier-based RLS can resolve it. Best-effort — a missing column is
  // skipped (pre-045 schema).
  const { data: own } = await supabase
    .from('parcels')
    .select('booking_id')
    .eq('id', params.parcelId)
    .maybeSingle();
  if (own?.booking_id) {
    const { error: carrierErr } = await supabase
      .from('parcels')
      .update({ carrier_booking_id: own.booking_id })
      .eq('id', params.parcelId);
    if (carrierErr && __DEV__) {
      console.warn('[parcel] carrier_booking_id update skipped:', carrierErr.message);
    }
  }

  return {
    routeKey,
    deadlineAt: deadlineAt.toISOString(),
    scheduledDepartureAt: crossing.toISOString(),
  };
}

/**
 * Count parcels currently in the same batch queue (excluding self).
 */
export async function listBatchPartners(
  routeKey: string,
  excludeParcelId?: string
): Promise<ParcelDoc[]> {
  let query = supabase
    .from('parcels')
    .select('*')
    .eq('batching_route_key', routeKey)
    .eq('batching_status', 'pending_batch')
    .eq('status', 'pending');

  if (excludeParcelId) query = query.neq('id', excludeParcelId);

  const { data, error } = await query;

  if (error || !data) return [];
  return data as ParcelDoc[]; // approximate — full mapRow not needed here
}

/**
 * Resolve the outcome of a batch at its deadline (054).
 * Delegates to resolve_batch_rpc, which creates ONE shared batch
 * booking for the route and relinks every pending parcel to it.
 * Returns the batch booking id when batched, or NULL when the route is
 * below the threshold (solo path).
 */
export async function resolveBatchOutcome(
  _parcelId: string,
  routeKey: string
): Promise<{ batchedCount: number; isSolo: boolean }> {
  const { data, error } = await supabase.rpc('resolve_batch_rpc', {
    p_route_key: routeKey,
    p_min_count: BATCH_THRESHOLD,
  });

  if (error || !data) {
    if (error && __DEV__) {
      console.warn('[parcel] resolve_batch_rpc skipped:', error.message);
    }
    return { batchedCount: 0, isSolo: true };
  }

  return { batchedCount: BATCH_THRESHOLD, isSolo: false };
}

/**
 * Increment the batch cycle count and extend the deadline by 1 hour.
 * If max cycles reached, auto-apply solo fee.
 */
export async function releaseAbandonedBatch(routeKey: string): Promise<void> {
  const { error } = await supabase.rpc('release_abandoned_batch', {
    p_route_key: routeKey,
  });
  if (error && __DEV__) {
    console.warn('[parcel] release_abandoned_batch skipped:', error.message);
  }
}

export async function bumpBatchCycle(
  parcelId: string
): Promise<{ cycleCount: number; autoSolo: boolean }> {
  const { data: parcel } = await supabase
    .from('parcels')
    .select('batching_cycle_count, batching_route_key, booking_id')
    .eq('id', parcelId)
    .maybeSingle();

  const current = parcel?.batching_cycle_count ?? 0;
  const next = current + 1;
  const autoSolo = next >= BATCH_MAX_CYCLES;

  const newDeadline = new Date(Date.now() + BATCH_WINDOW_MINUTES * 60_000);
  const update: Record<string, unknown> = {
    batching_cycle_count: next,
    batching_deadline_at: newDeadline.toISOString(),
  };
  if (autoSolo) {
    update.batching_status = 'solo';
    update.solo_surcharge = PARCEL_RATES.soloSurcharge;
    // Solo parcels stay reachable through their own stub (Option B);
    // clear any batch carrier left over from an earlier resolve.
    update.carrier_booking_id = parcel?.booking_id ?? null;
  }

  await supabase.from('parcels').update(update).eq('id', parcelId);

  if (autoSolo && parcel?.batching_route_key) {
    await releaseAbandonedBatch(parcel.batching_route_key);
  }

  return { cycleCount: next, autoSolo };
}
