# BangkaGo Database Schema (ERD)

> **Source of truth for the database.** This file documents all 25 tables
> following the Entity Relationship Diagram. The typo "BANKEROS" has been
> corrected to "BANGKEROS" throughout.

---

## Table Overview

| # | Table | Purpose | Key Relationships |
|---|---|---|---|
| 1 | `users` | User accounts (passengers, bangkeros, admins) | PK → Supabase Auth |
| 2 | `bangkeros` | Bangkero verification & profile | FK → users |
| 3 | `bangkero_verification` | Admin verification workflow | FK → bangkeros |
| 4 | `bangkas` | Boat/vessel records | FK → bangkeros |
| 5 | `vessel_tracking` | GPS tracking of bangkas | FK → bangkas |
| 6 | `safety_alerts` | Safety alerts per bangka/port | FK → bangkas, ports |
| 7 | `boat_rentals` | Boat rental bookings | FK → users, bangkas |
| 8 | `wallets` | Bangkero wallet balance | FK → bangkeros |
| 9 | `wallet_transactions` | Wallet transaction log | FK → wallets, bookings |
| 10 | `notifications` | In-app notifications | FK → users |
| 11 | `ratings` | Post-booking ratings | FK → bookings, users, bangkeros |
| 12 | `bookings` | Trip bookings | FK → users, bangkas, routes |
| 13 | `passenger_details` | Per-passenger info | FK → bookings |
| 14 | `payments` | Payment records | FK → bookings |
| 15 | `island_packages` | Tour/package products | Standalone |
| 16 | `parcels` | Parcel/cargo orders | FK → users, bookings |
| 17 | `parcel_items` | Line items within parcels | FK → parcels |
| 18 | `ports` | Port/terminal locations | Standalone |
| 19 | `routes` | Route definitions | FK → ports (start/end) |
| 20 | `route_stops` | Intermediate stops | FK → routes, ports |
| 21 | `weather_data` | Weather observations | FK → ports |
| 22 | `demand_predictions` | ML demand forecasting | FK → weather_data, routes |
| 23 | `trip_manifest` | Formal trip manifest | FK → bangkas, bangkeros, ports |
| 24 | `manifest_passengers` | Passenger manifest entries | FK → trip_manifest, bookings |
| 25 | `manifest_parcels` | Parcel manifest entries | FK → trip_manifest, parcels |

---

## Table Definitions

### 1. USERS
User accounts linked to Supabase Auth.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, FK → auth.users | Matches Supabase Auth user ID |
| `first_name` | TEXT | NOT NULL | |
| `middle_name` | TEXT | | |
| `last_name` | TEXT | NOT NULL | |
| `email` | TEXT | | Synthetic auth email |
| `phone_number` | TEXT | NOT NULL | E.164 format |
| `password_hash` | TEXT | | Managed by Supabase Auth |
| `user_role` | TEXT | NOT NULL | 'passenger', 'bangkero', 'admin' |
| `profile_photo` | TEXT | | URL or base64 |
| `is_verified` | BOOLEAN | NOT NULL DEFAULT false | |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |

### 2. BANGKEROS
Bangkero profile with verification documents.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, FK → users | Same as user ID |
| `gov_issued_id` | TEXT | | Government ID URL |
| `boat_registration_cert` | TEXT | | Boat registration URL |
| `coastal_permit` | TEXT | | Coastal permit URL |
| `brgy_clearance` | TEXT | | Barangay clearance URL |
| `verification_stat` | TEXT | NOT NULL DEFAULT 'pending' | 'pending', 'verified', 'rejected' |
| `permit_number` | TEXT | | Official permit number |
| `display_name` | TEXT | NOT NULL | Public-facing name |
| `is_available` | BOOLEAN | NOT NULL DEFAULT false | Online status toggle |
| `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |

### 3. BANGKERO_VERIFICATION
Admin verification workflow for bangkeros.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `status` | TEXT | NOT NULL DEFAULT 'pending' | 'pending', 'approved', 'rejected' |
| `remarks` | TEXT | | Admin notes |
| `bangkero_id` | UUID | NOT NULL, FK → bangkeros | |
| `admin_id` | UUID | FK → users | Admin who processed |

### 4. BANGKAS
Boat/vessel records. A bangkero can own multiple bangkas.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `bangka_name` | TEXT | NOT NULL | |
| `bangka_type` | TEXT | | e.g., 'pump boat', 'banca' |
| `permit_number` | TEXT | | |
| `bangka_photo` | TEXT | | URL |
| `capacity` | INTEGER | NOT NULL | Max passengers |
| `max_load_kg` | DECIMAL(10,2) | | Max cargo weight |
| `bangkero_id` | UUID | NOT NULL, FK → bangkeros | |

### 5. VESSEL_TRACKING
GPS tracking of bangkas at sea.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `latitude` | DECIMAL(10,7) | NOT NULL | |
| `longitude` | DECIMAL(10,7) | NOT NULL | |
| `speed` | DECIMAL(5,2) | | knots |
| `recorded_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |
| `bangka_id` | UUID | NOT NULL, FK → bangkas | |

### 6. SAFETY_ALERTS
Safety alerts tied to a bangka or port.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `message` | TEXT | NOT NULL | |
| `severity` | TEXT | NOT NULL DEFAULT 'low' | 'low', 'medium', 'high', 'critical' |
| `is_resolved` | BOOLEAN | NOT NULL DEFAULT false | |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |
| `bangka_id` | UUID | FK → bangkas | |
| `port_id` | TEXT | FK → ports | |

### 7. BOAT_RENTALS
Boat rental bookings.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `event_name` | TEXT | | e.g., 'Island tour' |
| `rental_date` | DATE | NOT NULL | |
| `hours` | DECIMAL(5,2) | NOT NULL | |
| `total_price` | DECIMAL(10,2) | NOT NULL | |
| `status` | TEXT | NOT NULL DEFAULT 'pending' | 'pending', 'confirmed', 'completed', 'cancelled' |
| `user_id` | UUID | NOT NULL, FK → users | |
| `bangka_id` | UUID | NOT NULL, FK → bangkas | |
| `payment_id` | UUID | FK → payments | |

### 8. WALLETS
Bangkero wallet with balance.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `balance` | DECIMAL(12,2) | NOT NULL DEFAULT 0 | |
| `bangkero_id` | UUID | NOT NULL, FK → bangkeros | |

### 9. WALLET_TRANSACTIONS
Transaction log for wallets.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `type` | TEXT | NOT NULL | 'credit', 'debit', 'withdrawal', 'top_up' |
| `amount` | DECIMAL(12,2) | NOT NULL | |
| `wallet_id` | UUID | NOT NULL, FK → wallets | |
| `booking_id` | UUID | FK → bookings | |

### 10. NOTIFICATIONS
In-app notifications per user.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `title` | TEXT | NOT NULL | |
| `message` | TEXT | NOT NULL | |
| `is_read` | BOOLEAN | NOT NULL DEFAULT false | |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |
| `user_id` | UUID | NOT NULL, FK → users | |

### 11. RATINGS
Post-booking ratings.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `score` | INTEGER | NOT NULL | 1-5 |
| `comment` | TEXT | | |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |
| `booking_id` | UUID | NOT NULL, FK → bookings | |
| `user_id` | UUID | NOT NULL, FK → users | |
| `bangkero_id` | UUID | NOT NULL, FK → bangkeros | |

### 12. BOOKINGS
Trip bookings (core table).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | Auto-generated by trigger |
| `ref` | TEXT | NOT NULL | BGO-XXXXXX format |
| `service_type` | TEXT | NOT NULL DEFAULT 'passenger' | 'passenger', 'cargo', 'rental' |
| `num_of_passenger` | INTEGER | NOT NULL DEFAULT 1 | |
| `trip_stat` | TEXT | NOT NULL DEFAULT 'open' | 'open', 'accepted', 'completed', 'cancelled' |
| `cancel_reason` | TEXT | | |
| `depart_time` | TIMESTAMPTZ | | |
| `arrival_time` | TIMESTAMPTZ | | |
| `total_price` | DECIMAL(10,2) | NOT NULL | |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |
| `user_id` | UUID | NOT NULL, FK → users | Passenger |
| `bangka_id` | UUID | FK → bangkas | Set on accept |
| `route_id` | TEXT | NOT NULL, FK → routes | |
| `package_id` | UUID | FK → island_packages | |
| `passenger_name` | TEXT | | Denormalized |
| `passenger_phone` | TEXT | | Denormalized |
| `from_port_name` | TEXT | | Denormalized |
| `to_port_name` | TEXT | | Denormalized |
| `operator_id` | UUID | FK → bangkeros | Set on accept |
| `operator_name` | TEXT | | Denormalized |
| `operator_boat_name` | TEXT | | Denormalized |
| `rejected_by` | UUID[] | DEFAULT '{}' | Array of bangkero UIDs |
| `accepted_at` | TIMESTAMPTZ | | |
| `completed_at` | TIMESTAMPTZ | | |
| `cancelled_at` | TIMESTAMPTZ | | |

### 13. PASSENGER_DETAILS
Per-passenger information within a booking.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `first_name` | TEXT | NOT NULL | |
| `last_name` | TEXT | NOT NULL | |
| `age` | INTEGER | | |
| `sex` | TEXT | | 'male', 'female', 'other' |
| `contact_number` | TEXT | | |
| `passenger_type` | TEXT | NOT NULL DEFAULT 'regular' | 'regular', 'senior', 'student', 'child' |
| `declared_weight_kg` | DECIMAL(6,2) | | |
| `booking_id` | UUID | NOT NULL, FK → bookings | |

### 14. PAYMENTS
Payment records per booking.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `amount` | DECIMAL(10,2) | NOT NULL | |
| `payment_method` | TEXT | NOT NULL DEFAULT 'cash' | 'cash', 'gcash', 'maya', 'bank_transfer' |
| `payment_status` | TEXT | NOT NULL DEFAULT 'pending' | 'pending', 'completed', 'failed', 'refunded' |
| `reference_num` | TEXT | | |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |
| `booking_id` | UUID | NOT NULL, FK → bookings | |

### 15. ISLAND_PACKAGES
Tour/package products.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `package_name` | TEXT | NOT NULL | |
| `description` | TEXT | | |
| `price` | DECIMAL(10,2) | NOT NULL | |
| `max_capacity` | INTEGER | NOT NULL | |
| `duration_hours` | DECIMAL(5,2) | NOT NULL | |

### 16. PARCELS
Parcel/cargo delivery orders.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `receiver_name` | TEXT | NOT NULL | |
| `receiver_contact` | TEXT | | |
| `total_price` | DECIMAL(10,2) | NOT NULL | |
| `status` | TEXT | NOT NULL DEFAULT 'pending' | 'pending', 'in_transit', 'delivered', 'returned' |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |
| `user_id` | UUID | NOT NULL, FK → users | |
| `booking_id` | UUID | NOT NULL, FK → bookings | |

### 17. PARCEL_ITEMS
Line items within a parcel.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `item_name` | TEXT | NOT NULL | |
| `quantity` | INTEGER | NOT NULL DEFAULT 1 | |
| `kilogram` | DECIMAL(8,2) | NOT NULL | |
| `parcel_id` | UUID | NOT NULL, FK → parcels | |

### 18. PORTS
Port/terminal locations.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | TEXT | PK | e.g., 'mactan-pier-1' |
| `port_name` | TEXT | NOT NULL | Display name |
| `location` | TEXT | | Address/area |
| `longitude` | DECIMAL(10,7) | | GPS coordinate |
| `latitude` | DECIMAL(10,7) | | GPS coordinate |
| `sort_order` | INTEGER | NOT NULL DEFAULT 0 | Display ordering |
| `is_active` | BOOLEAN | NOT NULL DEFAULT true | |

### 19. ROUTES
Route definitions between ports.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | TEXT | PK | Format: ${start}__${end} |
| `distance_km` | DECIMAL(8,2) | | |
| `base_fare` | DECIMAL(10,2) | NOT NULL | |
| `estimated_minutes` | INTEGER | NOT NULL | |
| `is_active` | BOOLEAN | NOT NULL DEFAULT true | |
| `start_port_id` | TEXT | NOT NULL, FK → ports | |
| `end_port_id` | TEXT | NOT NULL, FK → ports | |

### 20. ROUTE_STOPS
Intermediate stops on multi-leg routes.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `stop_order` | INTEGER | NOT NULL | |
| `route_id` | TEXT | NOT NULL, FK → routes | |
| `port_id` | TEXT | NOT NULL, FK → ports | |

### 21. WEATHER_DATA
Weather observations per port.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `wind_speed` | DECIMAL(5,2) | | km/h |
| `wave_height` | DECIMAL(5,2) | | meters |
| `weather_condition` | TEXT | | e.g., 'clear', 'rainy' |
| `is_safe` | BOOLEAN | NOT NULL DEFAULT true | |
| `recorded_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |
| `port_id` | TEXT | NOT NULL, FK → ports | |

### 22. DEMAND_PREDICTIONS
ML demand forecasting.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `prediction_date` | DATE | NOT NULL | |
| `day_of_week` | TEXT | | |
| `hour_of_day` | INTEGER | | |
| `is_weekend` | BOOLEAN | NOT NULL DEFAULT false | |
| `is_holiday` | BOOLEAN | NOT NULL DEFAULT false | |
| `previous_demand` | INTEGER | | |
| `avg_demand_last_7_days` | DECIMAL(8,2) | | |
| `avg_demand_last_30_days` | DECIMAL(8,2) | | |
| `predicted_passengers` | INTEGER | | |
| `confidence_score` | DECIMAL(5,4) | | 0.0000 - 1.0000 |
| `weather_id` | UUID | FK → weather_data | |
| `route_id` | TEXT | FK → routes | |

### 23. TRIP_MANIFEST
Formal trip manifest.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `actual_departure_time` | TIMESTAMPTZ | | |
| `actual_arrival_time` | TIMESTAMPTZ | | |
| `total_passengers_on_board` | INTEGER | NOT NULL DEFAULT 0 | |
| `total_parcels_on_board` | INTEGER | NOT NULL DEFAULT 0 | |
| `status` | TEXT | NOT NULL DEFAULT 'draft' | 'draft', 'finalized', 'cancelled' |
| `generated_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |
| `bangka_id` | UUID | NOT NULL, FK → bangkas | |
| `bangkero_id` | UUID | NOT NULL, FK → bangkeros | |
| `departure_port_id` | TEXT | NOT NULL, FK → ports | |
| `arrival_port_id` | TEXT | NOT NULL, FK → ports | |

### 24. MANIFEST_PASSENGERS
Passenger manifest entries.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `passenger_name` | TEXT | NOT NULL | |
| `actual_weight_kg` | DECIMAL(6,2) | | |
| `boarded_at` | TIMESTAMPTZ | | |
| `manifest_id` | UUID | NOT NULL, FK → trip_manifest | |
| `booking_id` | UUID | NOT NULL, FK → bookings | |
| `passenger_id` | UUID | FK → passenger_details | |

### 25. MANIFEST_PARCELS
Parcel manifest entries.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `parcel_description` | TEXT | NOT NULL | |
| `weight_kg` | DECIMAL(8,2) | | |
| `loaded_at` | TIMESTAMPTZ | | |
| `manifest_id` | UUID | NOT NULL, FK → trip_manifest | |
| `parcel_id` | UUID | NOT NULL, FK → parcels | |

---

## Relationship Summary

```
users ──┬── bangkeros ──┬── bangkas ──┬── vessel_tracking
        │               │             └── safety_alerts
        │               │
        │               ├── bangkero_verification
        │               └── wallets ── wallet_transactions
        │
        ├── bookings ──┬── passenger_details
        │               ├── payments
        │               ├── ratings
        │               ├── parcels ── parcel_items
        │               └── manifest_passengers
        │
        ├── notifications
        ├── boat_rentals
        └── ratings

ports ──┬── routes ──┬── route_stops
        │            └── demand_predictions
        │
        ├── safety_alerts
        ├── weather_data ── demand_predictions
        └── trip_manifest ──┬── manifest_passengers
                            └── manifest_parcels

island_packages ── bookings
```

---

## SQL Migration

Run `migrations/002_create_all_tables.sql` in Supabase SQL Editor to create all tables.

---

## Naming Convention

| Concept | ERD | Supabase | App Code (TypeScript) |
|---|---|---|---|
| Table names | UPPER_CASE | snake_case | camelCase (in comments) |
| Column names | UPPER_SNAKE_CASE | snake_case | camelCase (via mappers) |
| Primary keys | TABLE_NAME_ID | id | uid / pierId / routeId / bookingId |
| Foreign keys | FK TABLE_NAME_ID | table_name_id | tableNameId |

---

*This file is the source of truth for the BangkaGo database schema.*
