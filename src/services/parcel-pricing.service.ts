/**
 * Parcel Padala — Phase 0 placeholder pricing.
 *
 * All rate values below are PLACEHOLDERS gated on the PM rate decision.
 * Every numeric rate carries a `// PM-CONFIRM` comment. Change the numbers
 * on those lines only — do not restructure the shapes (033 + fare
 * recompute will consume them as-is).
 */
// TODO(Phase 1): Replace PLACEHOLDER_RATES with DB lookup from parcel_rates table.
// TODO(Phase 1): Add server-side fare recompute in booking.service.ts:createBooking.
import type { PortDoc } from '../types/models';

export type DeliveryType = 'standard' | 'express';
export type DeliverySpeed = 'same-day' | 'next-day';

export interface ParcelFareInput {
  fromPort: Pick<PortDoc, 'portId' | 'islandGroup'>;
  toPort: Pick<PortDoc, 'portId' | 'islandGroup'>;
  totalKg: number;
}

export interface ParcelFareResult {
  fare: number;
  isCrossIsland: boolean;
  breakdown: string[];
  blockedReason: string | null;
}

/** PLACEHOLDER rates — PM has not confirmed. One-line editable. */
export const PLACEHOLDER_RATES = {
  basePer10KgSlab: 0, // PM-CONFIRM: placeholder — ₱ per 10-kg slab
  crossIslandSurcharge: 0, // PM-CONFIRM: placeholder — flat ₱ added when zones differ
  maxKg: 50, // PM-CONFIRM: placeholder — per-item cap enforced in book-delivery
} as const;

/** Zone = island group. Cross-island <=> groups differ (locked decision). */
export function getParcelZone(port: Pick<PortDoc, 'islandGroup'>): 'mactan' | 'olango' {
  return port.islandGroup;
}

/** Phase 0: every port pair is allowed; only weight gates. Returns reason or null. */
export function isParcelAllowed(input: ParcelFareInput): string | null {
  if (!Number.isFinite(input.totalKg) || input.totalKg <= 0) return 'Enter a valid weight.';
  if (input.totalKg > PLACEHOLDER_RATES.maxKg) return `Max ${PLACEHOLDER_RATES.maxKg} kg per item in Phase 0.`;
  return null;
}

/**
 * Phase 0 fare: mirrors the legacy book-delivery shape
 * (base × slabs + surcharge) so the fare-card breakdown renders,
 * but routes through the placeholder table for the PM swap.
 */
export function calculateParcelFare(input: ParcelFareInput): ParcelFareResult {
  const isCrossIsland = input.fromPort.islandGroup !== input.toPort.islandGroup;
  const blockedReason = isParcelAllowed(input);
  if (blockedReason) {
    return { fare: 0, isCrossIsland, breakdown: [], blockedReason };
  }
  const slabs = Math.max(1, Math.ceil(input.totalKg / 10));
  const slabFare = PLACEHOLDER_RATES.basePer10KgSlab * slabs;
  const surcharge = isCrossIsland ? PLACEHOLDER_RATES.crossIslandSurcharge : 0;
  const fare = Math.round(slabFare + surcharge);
  const breakdown = [
    `₱${PLACEHOLDER_RATES.basePer10KgSlab} × ${slabs} slab${slabs === 1 ? '' : 's'}`,
    ...(isCrossIsland ? [`Cross-island +₱${PLACEHOLDER_RATES.crossIslandSurcharge}`] : []),
  ];
  return { fare, isCrossIsland, breakdown, blockedReason: null };
}
