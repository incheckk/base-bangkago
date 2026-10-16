/**
 * Parcel Padala — Phase 0 pricing service.
 *
 * Rate values mirror the parcel_rates DB seed (migration 035) and
 * PM-confirmed numbers (2026-10-15). The DB is the source of truth;
 * this constant is the offline fallback + default.
 */
// TODO(Phase 1): Replace PARCEL_RATES with a DB fetch from parcel_rates table.
// TODO(Phase 1): Add server-side fare recompute in booking.service.ts:createBooking.
import type { PortDoc } from '../types/models';

export type DeliveryType = 'accompanied' | 'piggyback' | 'batched' | 'solo';

export interface ParcelFareInput {
  fromPort: Pick<PortDoc, 'portId' | 'islandGroup'>;
  toPort: Pick<PortDoc, 'portId' | 'islandGroup'>;
  totalKg: number;
  deliveryType: DeliveryType;
}

export interface ParcelFareResult {
  fare: number;
  isCrossIsland: boolean;
  breakdown: string[];
  blockedReason: string | null;
}

/** PM-CONFIRM 2026-10-15 — mirrors migration 035 seed values. */
export const PARCEL_RATES = {
  baseFeeAccompanied: 120,
  baseFeePiggyback: 120,
  baseFeeBatched: 150,
  soloSurcharge: 150,
  includedKg: 10,
  excessRatePerKg: 10,
  minKg: 1,
  maxKg: 50,
  bangkeroApprovalMinutes: 15,
} as const;

/** Zone = island group. Cross-island <=> groups differ (locked decision). */
export function getParcelZone(port: Pick<PortDoc, 'islandGroup'>): 'mactan' | 'olango' {
  return port.islandGroup;
}

/** Phase 0: every port pair is allowed; only weight gates. Returns reason or null. */
export function isParcelAllowed(input: ParcelFareInput): string | null {
  if (!Number.isFinite(input.totalKg) || input.totalKg < PARCEL_RATES.minKg) {
    return `Minimum weight is ${PARCEL_RATES.minKg} kg.`;
  }
  if (input.totalKg > PARCEL_RATES.maxKg) {
    return `Max ${PARCEL_RATES.maxKg} kg per parcel.`;
  }
  return null;
}

/** Pick base fee by delivery mode. */
function baseFeeFor(type: DeliveryType): number {
  switch (type) {
    case 'accompanied': return PARCEL_RATES.baseFeeAccompanied;
    case 'piggyback':   return PARCEL_RATES.baseFeePiggyback;
    case 'batched':     return PARCEL_RATES.baseFeeBatched;
    case 'solo':        return PARCEL_RATES.baseFeeBatched;
  }
}

/**
 * Phase 0 fare calculation.
 *   fare = baseFee[type] + excessKg × excessRatePerKg + (type === 'solo' ? soloSurcharge : 0)
 * Where excessKg = max(0, ceil(kg) − includedKg).
 */
export function calculateParcelFare(input: ParcelFareInput): ParcelFareResult {
  const isCrossIsland = input.fromPort.islandGroup !== input.toPort.islandGroup;
  const blockedReason = isParcelAllowed(input);

  if (blockedReason) {
    return { fare: 0, isCrossIsland, breakdown: [], blockedReason };
  }

  const billedKg = Math.ceil(input.totalKg);
  const excessKg = Math.max(0, billedKg - PARCEL_RATES.includedKg);
  const baseFee = baseFeeFor(input.deliveryType);
  const excessFee = excessKg * PARCEL_RATES.excessRatePerKg;
  const solo = input.deliveryType === 'solo' ? PARCEL_RATES.soloSurcharge : 0;
  const fare = baseFee + excessFee + solo;

  const breakdown: string[] = [
    `Base fee (${input.deliveryType}): ₱${baseFee}`,
    `Included weight: ${PARCEL_RATES.includedKg} kg`,
  ];
  if (excessKg > 0) {
    breakdown.push(`Excess ${excessKg} kg × ₱${PARCEL_RATES.excessRatePerKg} = ₱${excessFee}`);
  }
  if (solo > 0) {
    breakdown.push(`Solo surcharge: ₱${solo}`);
  }
  breakdown.push(`Total: ₱${fare}`);

  return { fare, isCrossIsland, breakdown, blockedReason: null };
}
