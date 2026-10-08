import type {
  BangkaDoc,
  BangkeroDoc,
  BookingDoc,
  PortDoc,
  PortQueueDoc,
  RouteDoc,
  UserDoc,
} from '../types/models';

export function mapUserRow(row: any): UserDoc {
  return {
    uid: row.id,
    firstName: row.first_name,
    middleName: row.middle_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone_number,
    role: row.user_role,
    profilePhoto: row.profile_photo,
    isVerified: row.is_verified,
    createdAt: row.created_at,
  };
}

export function mapBangkeroRow(row: any): BangkeroDoc {
  return {
    uid: row.id,
    govIssuedId: row.gov_issued_id,
    boatRegistrationCert: row.boat_registration_cert,
    coastalPermit: row.coastal_permit,
    brgyClearance: row.brgy_clearance,
    verificationStat: row.verification_stat,
    permitNumber: row.permit_number,
    displayName: row.display_name,
    isAvailable: row.is_available,
    // ?? 0 keeps this working before migration 007 adds the column
    ratingPenalty: row.rating_penalty ?? 0,
    // ?? null keeps this working before migration 011 adds the column
    gcashQrUrl: row.gcash_qr_url ?? null,
    updatedAt: row.updated_at,
  };
}

export function mapBangkaRow(row: any): BangkaDoc {
  return {
    bangkaId: row.id,
    bangkaName: row.bangka_name,
    bangkaType: row.bangka_type,
    permitNumber: row.permit_number,
    bangkaPhoto: row.bangka_photo,
    capacity: row.capacity,
    maxLoadKg: row.max_load_kg,
    bangkeroId: row.bangkero_id,
    // Pre-016 rows have no column at all — the demo default until set.
    hourlyRate: Number(row.hourly_rate ?? 500),
  };
}

export function mapPortRow(row: any): PortDoc {
  return {
    portId: row.id,
    portName: row.port_name,
    location: row.location,
    latitude: row.latitude,
    longitude: row.longitude,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    // ?? 300 keeps this working before migration 008 adds the column
    geofenceRadiusM: row.geofence_radius_m ?? 300,
  };
}

export function mapPortQueueRow(row: any): PortQueueDoc {
  return {
    queueId: row.id,
    portId: row.port_id,
    bangkeroId: row.bangkero_id,
    enteredAt: row.entered_at,
    leftAt: row.left_at ?? null,
    // Present only when the query joined bangkeros(*)
    displayName: row.bangkeros?.display_name ?? null,
    isAvailable: row.bangkeros?.is_available ?? null,
  };
}

export function mapRouteRow(row: any): RouteDoc {
  return {
    routeId: row.id,
    distanceKm: row.distance_km,
    baseFare: row.base_fare,
    estimatedMinutes: row.estimated_minutes,
    isActive: row.is_active,
    startPortId: row.start_port_id,
    endPortId: row.end_port_id,
  };
}

export function mapBookingRow(row: any): BookingDoc {
  return {
    bookingId: row.id,
    ref: row.ref,
    serviceType: row.service_type,
    numOfPassenger: row.num_of_passenger,
    status: row.trip_stat,
    cancelReason: row.cancel_reason,
    departTime: row.depart_time,
    arrivalTime: row.arrival_time,
    totalPrice: row.total_price,
    createdAt: row.created_at,
    userId: row.user_id,
    bangkaId: row.bangka_id,
    routeId: row.route_id,
    packageId: row.package_id,
    passengerName: row.passenger_name,
    passengerPhone: row.passenger_phone,
    fromPortName: row.from_port_name,
    toPortName: row.to_port_name,
    operatorId: row.operator_id,
    operatorName: row.operator_name,
    operatorBoatName: row.operator_boat_name,
    rejectedBy: row.rejected_by ?? [],
    // ?? null keeps this working before migration 008 adds the columns
    heldBy: row.held_by ?? null,
    holdExpiresAt: row.hold_expires_at ?? null,
    acceptedAt: row.accepted_at,
    onboardedAt: row.onboarded_at ?? null,
    // ?? null keeps this working before migration 022 adds the column
    disputedAt: row.disputed_at ?? null,
    noShowAt: row.no_show_at ?? null,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    scheduledDate: row.scheduled_date ?? null,
    scheduledTime: row.scheduled_time ?? null,
  };
}
