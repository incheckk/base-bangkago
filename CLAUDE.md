# BangkaGo — Capstone

You are my senior React Native engineer for my capstone project: a ride-hailing
platform for sea travel (Mactan / Olango, Cebu) where passengers book boat trips
and bangkeros (boat operators) receive the requests.

The capstone study is in `docs/`, and `BANGKAGO_KNOWLEDGE_BASE.md` carries the
ERD the schema follows. Read both for context; the SCOPE section below states
what is actually built.

**BUILDING TOWARD THE FINAL PRODUCT.** Real auth, real database writes,
real-time updates. The schema now covers the full ERD from the capstone study —
25 tables — rather than the five-table demo slice this file originally described.

---

## RULES

- Ask before assuming.
- **Push back if I ask for something outside the scope fence.** Remind me it's
  out of scope and ask if I'm intentionally expanding it.
- Give a one-line justification for each design decision, phrased for a panel.
- Short explanations. Working code over tutorials.
- One screen or feature per response. Full typed `.tsx` files, exact file paths.
- Loading, empty, and error states on **every** screen.
- End each response with what to test and what's next.

---

## SCOPE

The original five-table scope fence is **superseded**. Migration
`002_create_all_tables.sql` builds the full ERD, so payments, ratings, parcels,
vessel tracking, weather, wallets, manifests, and demand predictions all have
tables and are fair game.

**Working end to end today — don't regress it:**
- Register / login / logout (Supabase Auth), passenger + bangkero roles
- Passenger picks pickup + destination port, requests a booking
- Available bangkeros receive the request in real time
- Bangkero accepts or declines; first accept wins and assigns the booking
- Assigned bangkero marks the trip completed
- Passenger cancels their own open booking

**Tables exist but have little or no UI yet** — check before assuming a feature
is missing versus merely unwired: `payments`, `ratings`, `parcels` +
`parcel_items`, `vessel_tracking`, `safety_alerts`, `weather_data`, `wallets` +
`wallet_transactions`, `notifications`, `trip_manifest` + `manifest_passengers`
+ `manifest_parcels`, `island_packages`, `boat_rentals`, `route_stops`,
`demand_predictions`, `passenger_details`, `bangkero_verification`.

**Still deliberately out:** Google / social auth, offline sync, real SMS OTP.

Ask before building on a table that has no UI — having a column is not the same
as having agreed on the behavior.

---

## STACK — HARD CONSTRAINTS

- React Native + Expo **SDK 54**, **must run in Expo Go** (no custom native builds,
  no `@react-native-firebase/*`, no config plugins requiring a dev build).
  Pinned to 54 because the demo device's Expo Go caps at 54 — SDK 57 requires
  iOS 16.4+. Do not "upgrade" this; it will break the demo phone.
- **Expo Router v6**, file-based routing, router root is `src/app/`
- TypeScript (`.tsx`)
- **Supabase** JS SDK: **Auth + Postgres** via `@supabase/supabase-js`
- Real-time updates via Supabase Realtime, never push notifications
- Map is **static `react-native-svg`** — no `react-native-maps`, no tiles, no
  API key, no location permission. Cannot fail on venue wifi.

---

## KEY DECISIONS (already made — don't relitigate)

| Decision | Rationale (panel-ready) |
|---|---|
| Phone number as identifier, not email | Bangkeros are phone-first; many don't use email. |
| Auth via synthetic email under the hood | `+639171234567` → `bangkago+639171234567@gmail.com` + password. Supabase rejects made-up domains like `@bangkago.app`, so gmail plus-addressing carries the phone number instead. OTP is fragile live — SMS can fail, timeout, or arrive late. |
| AsyncStorage session persistence | `persistSession: true` + `storage: AsyncStorage`. Session survives app reload; no re-typing credentials on stage. No `Platform.OS` branching needed — AsyncStorage has a working web shim under Expo. |
| Static SVG map | Deterministic, offline-safe, no API key, no permission prompt. |
| Fixed port list for pickup + destination | Ports are fixed infrastructure; a dropdown is more accurate than a dropped pin and makes bookings queryable by route. |
| Flat fare per port-pair | Fare is a single row lookup by deterministic route id (`startPortId__endPortId`), not a query. |
| Broadcast to all available bangkeros | No distance ranking — every available operator sees the request and accepts manually. Automatic matching stays out of scope. |
| First accept wins | The accepting bangkero is written onto the booking; it leaves every other operator's list. No locking or transaction — a second accept simply finds the booking no longer `open`. |
| Reject is per-operator, not a status | A decline appends the operator uid to `rejectedBy[]` and hides the request from that bangkero only. One operator declining must not kill a request the other could take. |
| `bangkeros` split from `users` | Availability lookup must not expose private contact details. |
| `bangkas` split from `bangkeros` | One operator can register more than one boat; capacity and permits belong to the vessel, not the person. |
| Bookings denormalize names | Operator request list is one query, zero follow-up reads — that's what makes it feel instant. |
| Booking ref = `BGO-` + 6 chars of doc ID | Sequential counters need a transaction; adds a live failure point for cosmetic gain. |
| Status enum is `open \| accepted \| completed \| cancelled` | Every state has something that can set it: passenger cancels while open, bangkero accepts then completes. No orphan states. |
| Passenger may cancel only while `open` | Once a bangkero has committed, cancelling is a coordination problem, not a button. |
| Boat name + capacity edited from Profile only | Keeps registration short; capacity is display-only in this build. |

---

## DATA MODEL

Source of truth is `migrations/002_create_all_tables.sql` (schema) and
`003_add_rls_policies.sql` (35 policies). Run both in the Supabase SQL editor.
**002 drops and recreates everything** — never re-run it against data you care
about.

**Naming changed from the prototype. Old names are gone:**

| Old (do not use) | Actual table |
|---|---|
| `piers` | `ports` |
| `operators` | `bangkeros` |
| `profiles` | `users` |

Core tables and their real columns:

- `users` — id, first_name, middle_name, last_name, email, **phone_number**,
  password_hash, **user_role**, profile_photo, is_verified, created_at
- `ports` — id, **port_name**, location, latitude, longitude, sort_order, is_active
- `routes` — id (`startPortId__endPortId`), **start_port_id**, **end_port_id**,
  base_fare, estimated_minutes, distance_km, is_active
- `bangkeros` — id, display_name, is_available, permit_number, gov_issued_id,
  boat_registration_cert, coastal_permit, brgy_clearance, verification_stat, updated_at
- `bangkas` — id, bangka_name, bangka_type, capacity, max_load_kg,
  permit_number, bangka_photo, bangkero_id
- `bookings` — id, ref, service_type, num_of_passenger, **trip_stat** (the status
  column — *not* `status`), cancel_reason, depart_time, arrival_time,
  **total_price**, created_at, user_id, bangka_id, route_id, package_id,
  passenger_name, passenger_phone, from_port_name, to_port_name,
  operator_id, operator_name, operator_boat_name, rejected_by,
  accepted_at, completed_at, cancelled_at

Gotchas that will cost you an hour each:
- The booking status column is **`trip_stat`**, not `status`.
- Ports carry real **latitude/longitude**, not the old normalized `mapX`/`mapY`.
  `SeaMap` needs a projection from lat/lng to its 0–1 viewBox space.
- `ref` is generated by the **`set_booking_ref` trigger** — never set it on insert.
- Fare lives on `routes.base_fare`; `bookings.total_price` is fare × passengers.

**Row-Level Security policies:** `ports` + `routes` are client-read-only (seeded via
service role key). Booking `create` requires role passenger + own uid + status `open`.
No deletes anywhere. Booking `update` permits exactly four transitions:

| Who | Transition | Guard |
|---|---|---|
| Passenger (own booking) | `open` → `cancelled` | sets `cancelledAt` only |
| Bangkero (verified role) | `open` → `accepted` | must set own uid as `operatorId`; booking must still be `open` |
| Bangkero (assigned only) | `accepted` → `completed` | `operatorId` must equal caller uid |
| Bangkero (any available) | `open` → `open` | may only append own uid to `rejectedBy` |

The last one is the subtle rule: a reject is a write to a booking the operator
does not own, so it must be narrowed to appending exactly one uid — the caller's
— and changing nothing else.

**Composite indexes: none required.** Every booking query filters on a single
field (`passengerId`, `status`, or `operatorId`) and sorts newest-first in
memory via `byNewest` in `useSupabase.ts`. Pairing a `where` with an `orderBy`
on `created_at` is what forces a composite index, and a missing index is a hard
query failure that only appears at runtime and takes minutes to build — three
ways to lose a live demo. At prototype volume the in-memory sort is free.

If booking volume ever makes the client-side sort untenable, add appropriate
indexes in the Supabase dashboard.

---

## CURRENT STATE

**Foundation — done:**
- `src/theme/tokens.ts` — colors, spacing, radii, typography
- `src/types/models.ts` — four-status booking lifecycle, operator + rejectedBy fields
- `src/utils/phone.ts` — normalizePhone, phoneToAuthEmail, formatPhone
  (verified against 16 cases; **no committed test suite** — no test runner installed)
- `src/services/supabase.ts` — supabase client init, env-based config
- `src/services/auth.service.ts` — signUp / signIn / signOut / fetchUserDoc,
  `friendlyAuthError` translates error messages back to phone vocabulary
- `src/services/booking.service.ts` — create / cancel / accept / reject / complete
- `src/hooks/useAuth.tsx` — AuthProvider + live profile subscription.
  Emits `[timing]` logs under `__DEV__`; strip before final submission.
- `src/hooks/useSupabase.ts` — usePiers, useAvailableOperatorCount,
  useRecentBookings, useOpenRequests, useOperator, useBooking

**Components — done:**
ScreenContainer, PrimaryButton, TextField, States (Loading/Empty/Error),
StatusPill, SeaMap, AuthErrorScreen

**Screens — done:**
- `_layout.tsx` (splash gate), `index.tsx` (role redirect)
- `(auth)/` — `_layout` guard, welcome, sign-in (with `__DEV__` quick-login),
  sign-up (role segmented control)
- `(passenger)/` — `_layout` guard, home (map, boats badge, service tiles,
  recent trips), book (full booking flow), booking/[id] (live status + cancel)
- `(bangkero)/` — `_layout` guard, home (availability toggle, live request list,
  Accept / Decline)

**Infrastructure — done:**
- `migrations/002_create_all_tables.sql` (full ERD), `003_add_rls_policies.sql`
  (35 policies). Both already applied to the hosted project.
- `scripts/seed.js`, `scripts/reset.js`, `scripts/supabase.js` — `npm run seed` /
  `npm run reset`. Seeded and verified: 5 ports, 12 routes, 3 accounts, 4 bookings.
- `.env` (gitignored), `.env.example` committed with **placeholders only**

**⚠️ Security debt:** the real `SUPABASE_SERVICE_ROLE_KEY` was committed in
`.env.example` and is in git history. It bypasses every RLS policy. Rotate it
(Dashboard → Project Settings → API Keys → service_role → Rotate) and update
`.env`. Until rotated, treat the database as compromised.

**Demo accounts** — password `demo1234`, auth emails are gmail plus-addressed
(`bangkago+639171234567@gmail.com`) because Supabase rejects the `@bangkago.app`
synthetic domain:
- `0917 123 4567` Juan Dela Cruz — passenger
- `0918 123 4567` Mang Lito — bangkero · MBCA Sto. Niño · 8 pax
- `0919 123 4567` Pedro V. — bangkero · MBCA Bantay Dagat · 10 pax

The `users` table also holds manual test signups (jan wan, wency wer, john
floyd) — not duplicates, just accounts made by hand.

**Still stubs:** none. Remaining work is 3.11 (bangkero marks trip completed is
already wired into `(bangkero)/home.tsx`; the separate assigned-trip screen is
optional) and stripping the `__DEV__` `[timing]` logs from `useAuth.tsx`.

**Environment notes:**
- Expo template leftovers deleted in full. `src/` is only BangkaGo code.
- Supabase project: Auth enabled, RLS policies configured.
  Confirm which policies are live — a permissive policy may be deployed
  as an emergency unblock. If that is still active, nothing is enforced server-side.
- No composite indexes needed. If you ever add an `orderBy` to a booking query
  that already has a `where` on a different field, you have just reintroduced
  that requirement — sort with `byNewest` instead.
- No screen navigates after auth — the `(auth)` guard redirects once
  `user && profile` are both present. Don't add manual `router.replace` calls;
  they race the guard.
- All four guards (`index`, `(auth)`, `(passenger)`, `(bangkero)`) render
  `AuthErrorScreen` on profile error. Every one needs it: any that doesn't
  becomes a dead end with no sign-out.

---

## REMAINING PHASES

- ~~**3.4** — Sign In, Sign Up, Role Select.~~ **DONE.** Role select folded into
  Sign Up as a segmented control rather than a third screen.
- ~~**3.5** — `SeaMap` SVG component.~~ **DONE.** Hand-fitted Bézier coastlines,
  shallow-water halos, port pins projected from latitude/longitude, dashed route line, labels
  flip inward past x > 0.62 so they never clip.
- ~~**3.6** — Passenger home.~~ **DONE.** Map header, live boats-available badge,
  3 service tiles (2 disabled), recent bookings. Bottom sheet is a **static
  card, not draggable** — fewer moving parts on stage.
- ~~**3.7** — Booking flow.~~ **DONE.** Pier pickers, passenger stepper, fare
  lookup, summary, confirm → Supabase write, live status screen + cancel.
- ~~**3.8** — Bangkero home.~~ **DONE.** Availability toggle, boat card, live
  request list via Supabase Realtime, Accept / Decline.
- ~~**3.9** — Profile screens (both roles), boat name + capacity editing.~~ **DONE.**
  Names editable for both roles; boat name + capacity for bangkeros. Phone is
  read-only — the synthetic auth email is derived from it, so editing it would
  desync auth from profile. RLS policies enforce this, not just the UI.
- **3.10** — Seed + reset scripts.
- **3.11** — Assigned-trip screen for the bangkero: accepted bookings list,
  **Mark completed**. Passenger's status screen reflects `accepted` → `completed`
  live via Supabase Realtime.

`booking.service.ts` (create / cancel / accept / reject / complete) is not
written yet — 3.7 and 3.8 both depend on it. Build it with 3.7.

---

## DEMO RELIABILITY — HARD REQUIREMENT

- **Seed script** (Supabase service role key, in .env):
  - 5 ports: Mactan Pier 1 (Punta Engaño), Mactan Pier 2 (Maribago),
    Olango Island Port (Sta. Rosa), Caohagan Island, Nalusuan Island
  - 12 routes, both directions, ₱150–₱400, 15–55 min
  - 3 accounts, all password `demo1234`:
    - `0917 123 4567` passenger — Juan Dela Cruz
    - `0918 123 4567` bangkero — Mang Lito · MBCA Sto. Niño · 8 pax
    - `0919 123 4567` bangkero — Pedro V. · MBCA Bantay Dagat · 10 pax
  - 2 pre-existing cancelled bookings on the passenger account so "Recent trips"
    isn't empty on first open
  - Two bangkeros so the demo shows one request landing on multiple operators
- **Reset script**: wipe `bookings`, set operator `isAvailable` back to true,
  leave ports/routes/accounts intact
- Every screen must look correct with empty data. A blank list reads as broken.
- **Don't make me type credentials on stage** — consider a dev-only quick-login
  row on the sign-in screen, gated behind `__DEV__`.
- Flag anything that can fail live (network, permissions, missing index) and
  give a fallback.

**Biggest live risk is not code — it's Metro.** Expo Go loads the bundle from the
dev server; venue wifi with client isolation kills it. Plan: phone hotspot with
the laptop joined to it, `--tunnel` as backup, screen recording as last resort.

---

## PHASE 0 PANEL ANSWERS (for gaps)

- **Real-time tracking / LGU dashboard** — "The real-time layer already works —
  you just watched an operator's screen update with no refresh. Tracking swaps
  booking events for GPS coordinates on the same listener."
- **Random Forest demand prediction** — "The model needs historical booking data
  to train on. This prototype is the instrument that produces that data."
- **Financial module** — "Trips now complete, so the fare is recorded against a
  finished booking. Aggregating that into earnings reports is a reporting layer,
  not new transaction logic."
- **Island hopping** — "Same booking record with an ordered stop array. We
  validated single-leg first."
- **Automatic matching / dispatch** — "Accept is manual and deliberate. The
  request broadcasts to every available operator and the first to accept takes
  it — that proves the real-time path end to end. Ranking operators by distance
  is a business rule on top of a pipeline that already works, not new technical
  risk."
- **Why can one operator decline without killing the request?** — "A decline is
  recorded per operator, not on the booking. The request stays live for everyone
  else, which is the behavior you'd want at a real pier."
- **No OTP** — "Provider configuration we'd enable in production; the account
  model is already phone-first so it doesn't need restructuring."
