# BangkaGo — Agent Guide

BangkaGo is a capstone ride-hailing platform for sea travel between Mactan and
Olango, Cebu. Passengers book boat trips; bangkeros (boat operators) receive
the requests in real time. It is a demo app: **every feature must run inside
Expo Go**, on stage, on unreliable venue wifi.

## Expo HAS CHANGED — read the versioned docs

This project is pinned to **Expo SDK 57**. Read the exact versioned docs at
https://docs.expo.dev/versions/v57.0.0/ before writing any code.

Do not upgrade the SDK. The stores' Expo Go ships support for exactly one SDK
at a time (currently 57). Bumping this breaks the presentation phone.

## Authority — read before writing code

- **CLAUDE.md** — the authority for rules, scope, stack constraints, key
  decisions, data-model gotchas, and demo reliability. Follow it. Its rules
  are not repeated here.
- **BANGKAGO_KNOWLEDGE_BASE.md** — ERD, schema knowledge, system decisions.
- **LAUNCH_DEFERRED_FEATURES.txt** — full tracker of everything consciously
  deferred or known-broken. Update it whenever you defer something.
- **Current Development Status** (below) — what changed most recently, what is
  pending, what is next. Check it first; update it in the same commit as any
  push that changes status.

## Verify before you push

```bash
npx tsc --noEmit      # must be clean
npm run lint          # must be 0 errors (warnings are known debt)
npx expo-doctor       # must pass 21/21
```

The eslint `react-hooks/*` compiler rules are demoted to `warn` on purpose
(`eslint.config.js`) — the codebase predates them; the compiler degrades
gracefully. Don't mass-refactor hooks to silence warnings.

## Current Development Status

**Rule: update this section in every push that changes project status.**

- **2026-10-08 — Passenger nav cleanup + booking-flow fixes + QR/manifest
  upgrades (gates green: tsc clean, lint 0 errors / 123 warnings,
  expo-doctor 21/21).**
  - Nav: bookings + trip history merged into `bookings.tsx` (filter
    chips active/completed/cancelled/all navigate by status);
    `trips.tsx` and `wallet.tsx` DELETED; Trip History/Wallet removed
    from profile + menu.ts; home drawer no longer lists Home; "See
    all" → bookings. Typed routes regenerated (`expo start` CI).
  - Book-ride: destination chips hidden until a departure is picked
    ("Pick a departure first"); CompanionForm now has keyboard
    avoidance + tap-outside dismiss, format validation (letters-only
    name, age 1-120, `normalizePhone`), a required Address field,
    Reset button, and a confirm alert on Remove — all fields required.
  - Address plumbing: `passenger_details.address` (migration 028),
    createPassengerDetail/mapRow, JSON parse in payment + rental-form,
    shown on the bangkero sailing manifest.
  - QR verify branches on payload SHAPE (PAX* = companion, ref match
    = booker, else reject) with a refetch — a stale companion list no
    longer ticks the booker when a companion's code is scanned.
  - Date strips (SchedulePicker + rental-form) get `ScrollHintBar`
    (edge chevron only while content overflows); boarding pass is an
    accordion (one QR at a time, all collapsed); scanner accepts only
    codes whose centre lands inside the drawn 220×220 square (bounds +
    onLayout, fail-open when the platform reports no bounds).
- **2026-10-07 — Boat Rentals made reachable on bangkero + admin
  (gates green: tsc clean, lint 0 errors / 127 warnings, expo-doctor
  21/21).**
  - Bangkero: Phase 3D removed the header burger and no SideDrawer
    renders on the bangkero stack, so `menuFor('bangkero')` was dead
    code and `/(bangkero)/rentals` had no entry point — added
    "Boat Rentals" to the Profile screen MENU_ITEMS/ROUTE_MAP (the
    profile screen IS the bangkero nav hub).
  - Admin: new read-only `(admin)/boat-rentals.tsx` screen (status
    filter chips, realtime, awaiting_payment rows point to
    Downpayments) + `listAllRentals()` in rental.service.ts + admin
    menu entry above Downpayments. Admin money actions stay in
    Downpayments — no duplication.
  - Lint baseline 126 → 127: one more instance of the known
    demoted `react-hooks/set-state-in-effect` pattern (same
    `useEffect(load)` as downpayments and ~40 screens).
  - Note: `menuFor('bangkero')` still exists in menu.ts but nothing
    renders a bangkero drawer — entries must go through
    `(bangkero)/profile.tsx` MENU_ITEMS.
- **2026-10-07 — Boat rental module completed + whole-day booking
  conflicts (migration 027; gates green: tsc clean, lint 0 errors /
  126 warnings, expo-doctor 21/21).**
  - `bangkas.rental_listed` opt-in: bangkero toggles it from the
    Boat Rentals screen (description card + Switch); passenger
    catalog only lists listed boats (seed lists demo boats).
  - Admin escrow approval now notifies the **bangkero** too (the
    rental only reaches their desk at approval); the premature
    creation-time notification in rental-form was removed.
  - One committed day per bangkero, DB-enforced by triggers (027):
    an accepted booking (ride or island-hop, scheduled_date/NULL=today)
    or a live rental blocks every other ride/package/charter that day
    in `accept_booking_hold`, rental inserts, and `confirmRental`.
    RAISE message surfaces through friendlyError.
  - rental-form dehighlights blocked dates via the
    `bangka_blocked_dates` RPC (SECURITY DEFINER, dates only).
  - departure.tsx now filters accepted trips to today (mirror of
    arrived.tsx) so an advance booking can't wedge "Ready to Depart".
- **2026-10-07 — M1-M6 build complete (all gates green: tsc clean, lint
  0 errors / 126 warnings, expo-doctor 21/21).**
  - **M1** — accept confirmation modals (book-ride accept + booking
    status), sail date/time chip label, clear-old-notifications
    (1-day cutoff, both inboxes), sailReminder banner on the booking
    screen.
  - **M2** — `utils/date.ts` (manilaTodayIso) replaces ad-hoc date
    math; fares-info copy = book up to 14 days ahead; passenger home
    "AI DEMAND TODAY" wired to real `demand_predictions` rows; ML
    pipeline ran end-to-end (RF R² 0.51, cutoff leakage-free),
    evaluate/predict/export_sql under `ml/`, migration 024.
  - **M3** — F screens cleared: manage-ports/manage-routes/reports
    wired into admin menu (PortSelect dropdowns), pending-operators +
    (passenger) booked/find-bangkero/parcel-details deleted;
    trip-en-route entry moved to the accepted-booking card; C1 no-op
    menu items removed; C2 contact-bangkero dials `tel:`.
  - **M4** — coastguard role: `UserRole 'coastguard'`, migration 025,
    `(coastguard)` group (live port queues + routes/fares, read-only),
    AdminScreenHeader role-aware, role redirects in every _layout,
    demo chip + seed account (needs 025 + reseed).
  - **M5** — shared `CompanionForm` (book-ride/package/rental-form);
    rental companions via `passenger_details.boat_rental_id` +
    migration 026 (nullable booking_id, XOR CHECK, RLS rental
    branches); party lists in my-rentals + bangkero rentals; B4
    close-out (arrived completes today's accepted bookings + flips
    manifest to 'completed', trip-summary reads includeCompleted,
    arrival_bypass demo switch = C7 switch 3, force_complete_trip
    RPC); B5 live vessel marker in trip-en-route (useVesselTracking
    via getBangkaIdForBangkero — bookings never carry bangka_id).
  - **M6** — LAUNCH_DEFERRED_FEATURES.txt rewritten (B4/B5/B12/C1/C2/
    C8/F/A4 shipped; D1→SDK 57; D2 pending list; D4 coastguard
    account) + this section.
- **USER MUST RUN:** `migrations/028_passenger_address.sql` (adds
  `passenger_details.address`). Everything else 022 → 023 → 024 →
  `ml/output/sql/insert_predictions.sql` → 025 → seed → 026 → 027 is
  applied (seed succeeded WITH `rental_listed`, which proves 027 is
  in). 028 is the only migration pending.
- **Next:** Expo Go smoke test (coastguard, companions incl. address
  on manifest, close-out, rental listing/escrow-notification/day-block,
  boat-rentals entry points, **merged bookings, QR accordion + scanner
  square, companion-scan ticks the right row**), then merge
  `chore/expo-sdk-57` to main.
- **ML pipeline trained** (feature engineering, aggregation, model
  training under `ml/`). In-app DemandBadge is still a placeholder —
  integration is deferred (B10).
- **Working end to end:** see CLAUDE.md SCOPE ("Working end to end
  today"). Don't regress it.

## Launch-critical debt — must clear before public launch

Digest of `LAUNCH_DEFERRED_FEATURES.txt` (source of truth — keep both in
sync when something is deferred).

**Security (section [E])**
- E1 — bookings RLS lets a passenger edit any column incl. `trip_stat`;
  move state transitions into guarded RPCs / revoke broad UPDATE.
- E2 — wallets and top-ups are client-writable; make them SECURITY
  DEFINER RPCs with server-side validation before real money exists.
- E3 — `trip_manifest` / `manifest_*` SELECT policies have `USING (true)`
  (PII readable by any authenticated user); tighten + re-audit all SELECTs.
- E4 — audit every SECURITY DEFINER RPC for `auth.uid()` guards,
  `search_path`, and REVOKE from PUBLIC/anon (`append_rejected_by` and
  the 002–007-era functions are known suspects).
- E6 — sign-up can leave orphan auth users when the profile insert fails.
- E7 — `passenger_details` has no UPDATE/DELETE policy; companions can
  never be corrected.
- E8 — `bookings_one_active_per_passenger` unique index still commented
  out (migrations/007:332); verify legacy rows first.

**Migration discipline**
- **Never re-run 002** (drops and recreates everything) and **never
  re-run 017** (blanket `UPDATE routes SET base_fare = 70` — resets
  every admin-edited fare). 017 is superseded by 021 (₱100).
- Migrations are applied **manually in the SQL editor, in numeric
  order**; they are not automated yet (D2).


**Not built yet, needed at launch**
- B1 — background GPS (Expo Go = foreground only; port queues and
  dispatch fail with the screen off). Needs a dev build.
- B2 — push notifications (offer/hold alerts are realtime chips only;
  sailReminder 3b local reminder is a no-op in Expo Go).
- B9 — real GCash gateway; today payments are marked paid on board with
  an optional manual reference, escrow is settled out of band.
  (B12 coastguard, B4 close-out, B5 en-route tracking: shipped M4/M5.)

**Environment (D5, D2)** — upload a real GCash QR (Admin → GCash QR)
before any downpayment demo; `docs` storage bucket is public — switch to
private + signed URLs at launch.

**Unwired screens (F)** — CLEARED (M3): manage-ports, manage-routes and
reports are wired into the admin menu; pending-operators, booked,
find-bangkero and parcel-details were deleted. If a screen ever shows up
here again, wire or delete it.

**Product rules to revisit (A)** — strict queue-only can stall requests
forever; 3-min hold / 5-min dwell / 3-min freshness are demo numbers;
`bangkas.hourly_rate` defaults to ₱500. (A4 island-hop companion list —
shipped M5.)
