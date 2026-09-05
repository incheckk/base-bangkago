export type UserRole = 'passenger' | 'bangkero';

/**
 * open      — requested, visible to every available bangkero
 * accepted  — one bangkero took it; first accept wins
 * completed — trip finished, set by the assigned bangkero
 * cancelled — passenger withdrew while still open
 *
 * There is no 'rejected'. A reject is per-operator (see rejectedBy) so a decline
 * by one bangkero leaves the request live for the others.
 */
export type BookingStatus = 'open' | 'accepted' | 'completed' | 'cancelled';

export interface UserDoc {
  uid: string;
  phone: string; // E.164, e.g. +639171234567
  firstName: string;
  lastName: string;
  role: UserRole;
  createdAt: string; // ISO 8601
}

export interface OperatorDoc {
  uid: string;
  displayName: string;
  boatName: string | null;
  capacity: number | null;
  isAvailable: boolean;
  updatedAt: string; // ISO 8601
}

export interface PierDoc {
  pierId: string;
  name: string;
  island: string;
  mapX: number; // 0–1, normalized to the SVG chart
  mapY: number;
  sortOrder: number;
  isActive: boolean;
}

export interface RouteDoc {
  routeId: string; // `${fromPierId}__${toPierId}`
  fromPierId: string;
  toPierId: string;
  fare: number;
  estimatedMinutes: number;
  isActive: boolean;
}

export interface BookingDoc {
  bookingId: string;
  ref: string; // BGO-A7F2K9
  passengerId: string;
  passengerName: string;
  passengerPhone: string;
  fromPierId: string;
  fromPierName: string;
  toPierId: string;
  toPierName: string;
  passengerCount: number;
  fare: number;
  estimatedMinutes: number;
  paymentMethod: 'cash';
  status: BookingStatus;

  operatorId: string | null;
  operatorName: string | null;
  operatorBoatName: string | null;

  rejectedBy: string[];

  createdAt: string; // ISO 8601
  acceptedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
}