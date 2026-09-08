/**
 * BangkaGo TypeScript type definitions.
 * Maps to the ERD schema (migrations/002_create_all_tables.sql).
 * BANKEROS → BANGKEROS typo fix applied.
 */

export type UserRole = 'passenger' | 'bangkero' | 'admin';

/**
 * Booking/trip statuses:
 * open      — requested, visible to every available bangkero
 * accepted  — one bangkero took it; first accept wins
 * completed — trip finished, set by the assigned bangkero
 * cancelled — passenger withdrew while still open
 */
export type BookingStatus = 'open' | 'accepted' | 'completed' | 'cancelled';

export type ServiceType = 'passenger' | 'cargo' | 'rental';

export type VerificationStatus = 'pending' | 'verified' | 'rejected';

export type BangkaType = 'pump_boat' | 'banca' | 'speed_boat' | 'other';

export type PaymentMethod = 'cash' | 'gcash' | 'maya' | 'bank_transfer';

export type PaymentStatus = 'pending' | 'completed' | 'failed' | 'refunded';

export type PassengerType = 'regular' | 'senior' | 'student' | 'child';

export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical';

export type WalletTransactionType = 'credit' | 'debit' | 'withdrawal' | 'top_up';

export type RentalStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled';

export type ParcelStatus = 'pending' | 'in_transit' | 'delivered' | 'returned';

export type ManifestStatus = 'draft' | 'finalized' | 'cancelled';

// =============================================================
// Core Doc types (used by hooks and services)
// =============================================================

export interface UserDoc {
  uid: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  email: string | null;
  phone: string; // E.164, e.g. +639171234567
  role: UserRole;
  profilePhoto: string | null;
  isVerified: boolean;
  createdAt: string; // ISO 8601
}

export interface BangkeroDoc {
  uid: string;
  govIssuedId: string | null;
  boatRegistrationCert: string | null;
  coastalPermit: string | null;
  brgyClearance: string | null;
  verificationStat: VerificationStatus;
  permitNumber: string | null;
  displayName: string;
  isAvailable: boolean;
  updatedAt: string; // ISO 8601
}

export interface BangkaDoc {
  bangkaId: string;
  bangkaName: string;
  bangkaType: string | null;
  permitNumber: string | null;
  bangkaPhoto: string | null;
  capacity: number;
  maxLoadKg: number | null;
  bangkeroId: string;
}

export interface PortDoc {
  portId: string;
  portName: string;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  sortOrder: number;
  isActive: boolean;
}

export interface RouteDoc {
  routeId: string; // `${startPortId}__${endPortId}`
  distanceKm: number | null;
  baseFare: number;
  estimatedMinutes: number;
  isActive: boolean;
  startPortId: string;
  endPortId: string;
}

export interface BookingDoc {
  bookingId: string;
  ref: string; // BGO-A7F2K9
  serviceType: ServiceType;
  numOfPassenger: number;
  status: BookingStatus;
  cancelReason: string | null;
  departTime: string | null;
  arrivalTime: string | null;
  totalPrice: number;
  createdAt: string; // ISO 8601
  userId: string; // Passenger
  bangkaId: string | null;
  routeId: string;
  packageId: string | null;
  // Denormalized fields (kept for prototype simplicity)
  passengerName: string | null;
  passengerPhone: string | null;
  fromPortName: string | null;
  toPortName: string | null;
  operatorId: string | null;
  operatorName: string | null;
  operatorBoatName: string | null;
  rejectedBy: string[];
  acceptedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
}

export interface PassengerDetailDoc {
  passengerId: string;
  firstName: string;
  lastName: string;
  age: number | null;
  sex: string | null;
  contactNumber: string | null;
  passengerType: PassengerType;
  declaredWeightKg: number | null;
  bookingId: string;
}

export interface PaymentDoc {
  paymentId: string;
  amount: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  referenceNum: string | null;
  createdAt: string;
  bookingId: string;
}

export interface IslandPackageDoc {
  packageId: string;
  packageName: string;
  description: string | null;
  price: number;
  maxCapacity: number;
  durationHours: number;
}

export interface ParcelDoc {
  parcelId: string;
  receiverName: string;
  receiverContact: string | null;
  totalPrice: number;
  status: ParcelStatus;
  createdAt: string;
  userId: string;
  bookingId: string;
}

export interface ParcelItemDoc {
  itemId: string;
  itemName: string;
  quantity: number;
  kilogram: number;
  parcelId: string;
}

export interface NotificationDoc {
  notificationId: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  userId: string;
}

export interface RatingDoc {
  ratingId: string;
  score: number;
  comment: string | null;
  createdAt: string;
  bookingId: string;
  userId: string;
  bangkeroId: string;
}

export interface WalletDoc {
  walletId: string;
  balance: number;
  bangkeroId: string;
}

export interface WalletTransactionDoc {
  transactionId: string;
  type: WalletTransactionType;
  amount: number;
  walletId: string;
  bookingId: string | null;
}

export interface VesselTrackingDoc {
  trackId: string;
  latitude: number;
  longitude: number;
  speed: number | null;
  recordedAt: string;
  bangkaId: string;
}

export interface SafetyAlertDoc {
  alertId: string;
  message: string;
  severity: AlertSeverity;
  isResolved: boolean;
  createdAt: string;
  bangkaId: string | null;
  portId: string | null;
}

export interface BoatRentalDoc {
  rentalId: string;
  eventName: string | null;
  rentalDate: string;
  hours: number;
  totalPrice: number;
  status: RentalStatus;
  userId: string;
  bangkaId: string;
  paymentId: string | null;
}

export interface RouteStopDoc {
  stopId: string;
  stopOrder: number;
  routeId: string;
  portId: string;
}

export interface WeatherDataDoc {
  weatherId: string;
  windSpeed: number | null;
  waveHeight: number | null;
  weatherCondition: string | null;
  isSafe: boolean;
  recordedAt: string;
  portId: string;
}

export interface DemandPredictionDoc {
  predictionId: string;
  predictionDate: string;
  dayOfWeek: string | null;
  hourOfDay: number | null;
  isWeekend: boolean;
  isHoliday: boolean;
  previousDemand: number | null;
  avgDemandLast7Days: number | null;
  avgDemandLast30Days: number | null;
  predictedPassengers: number | null;
  confidenceScore: number | null;
  weatherId: string | null;
  routeId: string | null;
}

export interface TripManifestDoc {
  manifestId: string;
  actualDepartureTime: string | null;
  actualArrivalTime: string | null;
  totalPassengersOnBoard: number;
  totalParcelsOnBoard: number;
  status: ManifestStatus;
  generatedAt: string;
  bangkaId: string;
  bangkeroId: string;
  departurePortId: string;
  arrivalPortId: string;
}

export interface ManifestPassengerDoc {
  manifestPassengerId: string;
  passengerName: string;
  actualWeightKg: number | null;
  boardedAt: string | null;
  manifestId: string;
  bookingId: string;
  passengerId: string | null;
}

export interface ManifestParcelDoc {
  manifestParcelId: string;
  parcelDescription: string;
  weightKg: number | null;
  loadedAt: string | null;
  manifestId: string;
  parcelId: string;
}

export interface BangkeroVerificationDoc {
  verificationId: string;
  status: 'pending' | 'approved' | 'rejected';
  remarks: string | null;
  bangkeroId: string;
  adminId: string | null;
}
