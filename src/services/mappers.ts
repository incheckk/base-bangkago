// src/services/mappers.ts
//
// Postgres columns are snake_case; every Doc type in models.ts stays
// camelCase to avoid rewriting every screen that reads them. These
// functions are the one place that translation happens.
import type { BookingDoc, OperatorDoc, PierDoc, RouteDoc } from '../types/models';

export function mapPierRow(row: any): PierDoc {
  return {
    pierId: row.id,
    name: row.name,
    island: row.island,
    mapX: row.map_x,
    mapY: row.map_y,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  };
}

export function mapRouteRow(row: any): RouteDoc {
  return {
    routeId: row.id,
    fromPierId: row.from_pier_id,
    toPierId: row.to_pier_id,
    fare: row.fare,
    estimatedMinutes: row.estimated_minutes,
    isActive: row.is_active,
  };
}

export function mapOperatorRow(row: any): OperatorDoc {
  return {
    uid: row.id,
    displayName: row.display_name,
    boatName: row.boat_name,
    capacity: row.capacity,
    isAvailable: row.is_available,
    updatedAt: row.updated_at,
  };
}

export function mapBookingRow(row: any): BookingDoc {
  return {
    bookingId: row.id,
    ref: row.ref,
    passengerId: row.passenger_id,
    passengerName: row.passenger_name,
    passengerPhone: row.passenger_phone,
    fromPierId: row.from_pier_id,
    fromPierName: row.from_pier_name,
    toPierId: row.to_pier_id,
    toPierName: row.to_pier_name,
    passengerCount: row.passenger_count,
    fare: row.fare,
    estimatedMinutes: row.estimated_minutes,
    paymentMethod: row.payment_method,
    status: row.status,
    operatorId: row.operator_id,
    operatorName: row.operator_name,
    operatorBoatName: row.operator_boat_name,
    rejectedBy: row.rejected_by ?? [],
    createdAt: row.created_at,
    acceptedAt: row.accepted_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
  };
}