/**
 * Batched-padala window math — pure, so it can be unit tested without
 * Supabase (tests/unit/parcel-batching.test.cjs).
 *
 * The window is the product rule: a batched parcel waits up to 1 hour for
 * other parcels on the same route, then they all sail together as one
 * umbrella booking.
 *
 * `batching_route_key` is a grouping token, not a schedule: it is
 * route + day only. It must NOT carry a crossing time — two senders in the
 * same hour can have different next crossings, and a per-crossing key is
 * exactly what kept them from merging. resolve_batch_rpc (071/077) treats
 * the key as opaque, so the removal is safe.
 */
export const BATCH_WINDOW_MINUTES = 60;
export const BATCH_MAX_CYCLES = 3;
export const BATCH_THRESHOLD = 2;

/** Local YYYYMMDD — batching keys are day-scoped so yesterday's queue
 *  can never be counted today. */
function ymd(date: Date): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}

export function computeBatchingRouteKey(params: {
  fromPortId: string;
  toPortId: string;
  date?: Date;
}): string {
  return `${params.fromPortId}__${params.toPortId}-${ymd(params.date ?? new Date())}`;
}

export interface BatchWindow {
  routeKey: string;
  deadlineAt: Date;
}

/** The 1-hour window a parcel joins. Deadline is always exactly one
 *  window from `now` — there is no path where a parcel enters a batch
 *  without a deadline. */
export function batchWindowFor(
  fromPortId: string,
  toPortId: string,
  now: Date = new Date()
): BatchWindow {
  return {
    routeKey: computeBatchingRouteKey({ fromPortId, toPortId, date: now }),
    deadlineAt: new Date(now.getTime() + BATCH_WINDOW_MINUTES * 60_000),
  };
}
