# BangkaGo — Capstone Prototype

You are my senior React Native engineer for my capstone project: a ride-hailing
platform for sea travel (Mactan / Olango, Cebu) where passengers book boat trips
and bangkeros (boat operators) receive the requests.

The capstone study is in `docs/`. Read it as source of truth for context and
objectives — but the scope fence below overrides it.

**THIS IS A PROTOTYPE FOR A PANEL PRESENTATION.** Functional, not a clickable
mockup — real auth, real database writes, real-time updates. The scope stops
where stated below.

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

## SCOPE FENCE

**IN SCOPE**
- Register / login / logout (Firebase Auth), passenger + bangkero roles
- Passenger: profile, pick pickup + destination pier, request a booking
- Booking writes to Firestore
- Passenger sees confirmation + booking status
- Available bangkeros receive the request in real time in a request list
- Passenger can cancel their own open booking
- Bangkero accepts or declines a request; first accept wins and assigns the booking
- Assigned bangkero marks the trip completed (`open` → `accepted` → `completed`)
- **That's the end of the flow.**

**OUT OF SCOPE — do not build, do not suggest, do not scaffold "for later"**
- Automatic matching / dispatch / distance ranking (accept is manual, broadcast stays)
- Bangkero-created trip listings, schedules, or seat inventory
- Live trip tracking, GPS streaming
- Payment integration (payment is display-only, hardcoded `'cash'`)
- Ratings, manifests, companion passenger details
- Island hopping (multi-stop), Padala (parcel delivery)
- Push notifications, weather APIs, admin/LGU dashboards, chat, offline sync
- Google / social auth

Island Hop and Padala **do** appear on the passenger home as visibly disabled
tiles with a "Coming soon" badge. Chrome only, no behavior.

---

## STACK — HARD CONSTRAINTS

- React Native + Expo **SDK 54**, **must run in Expo Go** (no custom native builds,
  no `@react-native-firebase/*`, no config plugins requiring a dev build).
  Pinned to 54 because the demo device's Expo Go caps at 54 — SDK 57 requires
  iOS 16.4+. Do not "upgrade" this; it will break the demo phone.
- **Expo Router v6**, file-based routing, router root is `src/app/`
- TypeScript (`.tsx`)
- Firebase JS SDK v9+ modular: **Auth + Firestore only**
- Real-time updates via Firestore `onSnapshot`, never push notifications
- Map is **static `react-native-svg`** — no `react-native-maps`, no tiles, no
  API key, no location permission. Cannot fail on venue wifi.

---

## KEY DECISIONS (already made — don't relitigate)

| Decision | Rationale (panel-ready) |
|---|---|
| Phone number as identifier, not email | Bangkeros are phone-first; many don't use email. |
| Auth via synthetic email under the hood | `+639171234567` → `639171234567@bangkago.app` + password. Firebase Phone Auth needs reCAPTCHA (no DOM in RN) or a native build — neither works in Expo Go. SMS OTP is also the most fragile thing possible in a live demo. |
| `initializeAuth` + AsyncStorage persistence | Session survives app reload; no re-typing credentials on stage. |
| `experimentalAutoDetectLongPolling: true` | Firestore listeners survive networks that block WebChannel. |
| Static SVG map | Deterministic, offline-safe, no API key, no permission prompt. |
| Fixed pier list for pickup + destination | Piers are fixed infrastructure; a dropdown is more accurate than a dropped pin and makes bookings queryable by route. |
| Flat fare per pier-pair | Fare is a constant-time `getDoc` on a deterministic route ID, not a query. |
| Broadcast to all available bangkeros | No distance ranking — every available operator sees the request and accepts manually. Automatic matching stays out of scope. |
| First accept wins | The accepting bangkero is written onto the booking; it leaves every other operator's list. No locking or transaction — a second accept simply finds the booking no longer `open`. |
| Reject is per-operator, not a status | A decline appends the operator uid to `rejectedBy[]` and hides the request from that bangkero only. One operator declining must not kill a request the other could take. |
| `operators/` split from `users/` | Availability lookup must not expose private contact details. |
| Bookings denormalize names | Operator request list is one query, zero follow-up reads — that's what makes it feel instant. |
| Booking ref = `BGO-` + 6 chars of doc ID | Sequential counters need a transaction; adds a live failure point for cosmetic gain. |
| Status enum is `open \| accepted \| completed \| cancelled` | Every state has something that can set it: passenger cancels while open, bangkero accepts then completes. No orphan states. |
| Passenger may cancel only while `open` | Once a bangkero has committed, cancelling is a coordination problem, not a button. |
| Boat name + capacity edited from Profile only | Keeps registration short; capacity is display-only in this build. |

---

## DATA MODEL (approved, implemented in `src/types/models.ts`)

- `users/{uid}` — uid, phone (E.164), firstName, lastName, role, createdAt
- `operators/{uid}` — uid, displayName, boatName, capacity, isAvailable, updatedAt
- `piers/{pierId}` — pierId, name, island, mapX, mapY (0–1 normalized), sortOrder, isActive
- `routes/{fromPierId}__{toPierId}` — fromPierId, toPierId, fare, estimatedMinutes, isActive
- `bookings/{id}` — bookingId, ref, passengerId, passengerName, passengerPhone,
  fromPierId, fromPierName, toPierId, toPierName, passengerCount, fare,
  estimatedMinutes, paymentMethod: 'cash', status,
  operatorId, operatorName, operatorBoatName (null until accepted),
  rejectedBy (uid array), createdAt, acceptedAt, completedAt, cancelledAt

**Security rules:** `piers` + `routes` are client-read-only (seeded via Admin
SDK). Booking `create` requires role passenger + own uid + status `open`.
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
memory via `byNewest` in `useFirestore.ts`. Pairing a `where` with an `orderBy`
on `createdAt` is what forces a composite index, and a missing index is a hard
query failure that only appears at runtime and takes minutes to build — three
ways to lose a live demo. At prototype volume the in-memory sort is free.

`firestore.indexes.json` still defines the three indexes for a production build;
nothing in the app depends on them today. If booking volume ever makes the
client-side sort untenable, restore the `orderBy` clauses and deploy that file.

---

## CURRENT STATE

**Foundation — done:**
- `src/theme/tokens.ts` — colors, spacing, radii, typography
- `src/types/models.ts` — four-status booking lifecycle, operator + rejectedBy fields
- `src/utils/phone.ts` — normalizePhone, phoneToAuthEmail, formatPhone
  (verified against 16 cases; **no committed test suite** — no test runner installed)
- `src/services/firebase.ts` — app/auth/db init, env-based config
- `src/services/auth.service.ts` — signUp / signIn / signOut / fetchUserDoc,
  `friendlyAuthError` translates Firebase's email vocabulary back to phone
- `src/services/booking.service.ts` — create / cancel / accept / reject / complete
- `src/hooks/useAuth.tsx` — AuthProvider + live profile subscription.
  Emits `[timing]` logs under `__DEV__`; strip before final submission.
- `src/hooks/useFirestore.ts` — usePiers, useAvailableOperatorCount,
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
- `scripts/seed.js`, `scripts/reset.js`, `scripts/lib.js` — `npm run seed` / `npm run reset`
- `firestore.rules`, `firestore.indexes.json`
- `.env` (gitignored), `.env.example` committed
- `serviceAccountKey.json` gitignored — this one is a REAL secret, unlike the
  `EXPO_PUBLIC_` web config which is inlined into every bundle by design

**Still stubs:** none. Remaining work is 3.11 (bangkero marks trip completed is
already wired into `(bangkero)/home.tsx`; the separate assigned-trip screen is
optional) and stripping the `__DEV__` `[timing]` logs from `useAuth.tsx`.

**Environment notes:**
- Expo template leftovers deleted in full. `src/` is only BangkaGo code.
- Firebase Console: Email/Password enabled ✅, Firestore created ✅,
  rules published ✅. **Confirm which ruleset is live** — a permissive
  `allow read, write: if request.auth != null` was offered as an emergency
  unblock. If that is still deployed, nothing is enforced server-side.
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
  shallow-water halos, pier pins from `mapX`/`mapY`, dashed route line, labels
  flip inward past x > 0.62 so they never clip.
- ~~**3.6** — Passenger home.~~ **DONE.** Map header, live boats-available badge,
  3 service tiles (2 disabled), recent bookings. Bottom sheet is a **static
  card, not draggable** — fewer moving parts on stage.
- ~~**3.7** — Booking flow.~~ **DONE.** Pier pickers, passenger stepper, fare
  lookup, summary, confirm → Firestore write, live status screen + cancel.
- ~~**3.8** — Bangkero home.~~ **DONE.** Availability toggle, boat card, live
  request list via `onSnapshot`, Accept / Decline.
- ~~**3.9** — Profile screens (both roles), boat name + capacity editing.~~ **DONE.**
  Names editable for both roles; boat name + capacity for bangkeros. Phone is
  read-only — the synthetic auth email is derived from it, so editing it would
  desync Firestore from Auth. Rules enforce this, not just the UI.
- **3.10** — Seed + reset scripts.
- **3.11** — Assigned-trip screen for the bangkero: accepted bookings list,
  **Mark completed**. Passenger's status screen reflects `accepted` → `completed`
  live via `onSnapshot`.

`booking.service.ts` (create / cancel / accept / reject / complete) is not
written yet — 3.7 and 3.8 both depend on it. Build it with 3.7.

---

## DEMO RELIABILITY — HARD REQUIREMENT

- **Seed script** (Firebase Admin SDK, service account key, gitignored):
  - 5 piers: Mactan Pier 1 (Punta Engaño), Mactan Pier 2 (Maribago),
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
  leave piers/routes/accounts intact
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
