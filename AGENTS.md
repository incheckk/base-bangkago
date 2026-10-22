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

- **2026-10-22 — Wording-only suspension rename (no migration, no
  behaviour change; gates: tsc clean, lint 0 errors / 133 warnings, the
  four edited page scripts parse).**
  Manage Bangkeros and Manage Bangka no longer say Delete/Deleted/Restore:
  the row action is **Suspend** (`admin_delete_bangkero` /
  `admin_delete_bangka`, unchanged) the lower card is **Suspended
  Bangkeros / Suspended Bangkas**, and its action is **Reactivate**. Copy
  now states what the RPCs actually do (record + trip history kept, boat off
  dispatch and the rental catalog, port queue closed, app sign-in blocked,
  in-use vessels refuse). `manage-bangka`'s modal ids renamed
  `deactivateModal/deactivateForm/openDeactivateModal` → `suspend*` so they
  stop colliding with the separate Status → Deactivate action, which still
  means `is_active = false`. Manage Users labels a suspended bangkero as
  **Suspended** (badge red; filter option "Suspended (bangkero)" keeps the
  `deleted` value because that row is reactivated from Manage Bangkeros,
  not from the Status modal), `suspend-user.html` matches, and
  `fetchUserDoc` now says "suspended" instead of "deleted" for
  `bangkeros.is_deleted`. Left as is: the 048/049 RPC error strings still
  say "already in Deleted Bangkeros" (double-click only; changing them
  needs a migration) and the internal `listDeleted` / `softDelete` /
  `delete` service names.
- **2026-10-21 — Bookings & payments truthfulness batch: guarded admin
  booking cancel, escrow state transitions, combined date-range payment
  report (migration 066 PENDING — USER MUST RUN, after 065; gates: tsc
  clean, lint 0 errors / 133 warnings, all three inline scripts parse,
  expo-doctor unchanged — only the three known SDK-57 patch drifts).**
  - **Migration 066 `066_admin_booking_cancel.sql`:** guarded
    `admin_cancel_booking(booking_id, reason)` RPC. Manage Bookings' old
    Status/Cancel buttons called a service with no admin UPDATE path, so
    they updated 0 rows and still reported success. 066 is admin-only,
    locks the row, allows pending/open/accepted only, refuses departed or
    boarded trips, refuses while a pending/approved downpayment exists
    (refund it first), stamps `cancelled_at`/`cancel_reason`, clears the
    hold, and notifies the passenger. `bookings.js` replaces
    `updateStatus` with `cancel`.
  - **Manage Bookings:** status filter/badges now use the DB vocabulary
    (pending / open / accepted / completed / cancelled) instead of
    "Confirmed"; customer falls back to the joined `users` name/phone;
    trip date is pinned to Asia/Manila and falls back to
    departure/created time; the free-form status modal is gone — only a
    guarded Cancel action remains (disabled, with the reason, for
    departed, boarded, completed, already-cancelled, or escrow-held
    rows); details show the real record id, lifecycle timestamps,
    downpayment state and cancel reason; manifest trip date uses the same
    helper.
  - **Downpayments:** rows are keyed by downpayment id (not the filtered
    index); the review modal shows the real downpayment status, target
    trip/rental status, reviewed timestamp and a "refund due" warning
    when a cancelled trip still holds pending/approved escrow. Approve is
    disabled for a cancelled target; Refund is available for pending and
    approved rows. Approve/refund services now do conditional status
    updates (`.eq('status','pending')` / `.in('status',[pending,
    approved])`) and restore the row if the 020 gate RPC fails, so a
    double-click or two admins cannot double-review. Manage Payments
    deep-links a row here with `?id=`.
  - **Manage Payments:** now a real combined fare + GCash escrow
    transaction list (was a mocked array): booking/rental ref, payer,
    method, target status, Manila date, detail modal, and a status filter
    that distinguishes fare Paid / Pending / Unpaid (completed trip) /
    Void (cancelled trip) / Failed / Refunded from escrow rows. "Generate
    Report" is a real date-range report with count/gross/paid/pending/
    unpaid/void/escrow/refunded totals and a jsPDF table, replacing the
    fake single-row receipt. The raw DB status stays in the detail modal.
  - **Mobile parity:** `src/services/downpayment.service.ts` gets the
    same conditional approve/refund guard and rollback, so the app and
    web cannot double-review or overwrite a concurrent decision.
  - **Next:** run 062 → 063 → 064 → 065 → 066, then with an admin login:
    cancel an open booking and confirm the passenger notification; try
    cancelling one with a pending downpayment (must refuse), refund the
    downpayment on Downpayments, then cancel; approve a pending
    downpayment twice (second must say already reviewed); refund an
    approved row; filter Manage Payments to Void/Unpaid and generate a
    report for a date range containing both fares and downpayments.

- **2026-10-21 — Admin dashboard truthfulness batch: real account suspension,
  derived vessel status, Manage Ports & Routes (migration 065 PENDING — USER
  MUST RUN, after 064; gates: tsc clean, lint 0 errors / 133 warnings;
  expo-doctor reports only three patch-level SDK-57 version drifts, unrelated
  to this batch).**
  - **Migration 065 `065_user_suspension.sql`:** `users.is_suspended BOOLEAN
    NOT NULL DEFAULT false` + `users_guard_suspension` BEFORE UPDATE trigger
    (only admins, or a null-uid SQL-editor/service-role session, may flip it —
    `users_update_own` would otherwise let a suspended user clear their own
    flag). No demo reset; nobody is blocked until an admin suspends them.
    Enforced in the app (`fetchUserDoc` throws; silent revalidation now
    surfaces `deleted|suspended`, so a live session dies on the next realtime
    tick) and on the web (`role()` returns `'suspended'`; the portal signs out
    and explains). Safe to run late: both select `*`, so before 065 the flag
    reads absent; only Suspend errors.
  - **Manage Users:** the status filter/modal now read the enforced flag and
    show Active / Suspended / **Deleted** (a soft-deleted bangkero can never
    sign in even with `is_suspended = false`). The old page read
    `is_verified`, which is false on every app sign-up, so every real user
    looked Suspended and suspending did nothing. Joined is date-only pinned to
    Asia/Manila. Status/role writes are keyed by uid, not the filtered-row
    index. The Suspend deep-link page reads the same rules. Names are
    HTML-escaped.
  - **Manage Bangka:** rebuilt on the real tables (045/047/048/049):
    Capacity and Max Load read/write `bangkas.capacity` / `max_load_kg`;
    Status is derived, not stored — Unverified (no verified, non-deleted
    owner) → Unavailable (`is_active = false`) → On Trip / On Rental (today's
    accepted bookings by `operator_id`, or a live today rental) → Offline
    (owner `is_available = false`) → Available. Current Use shows
    `BGO-… · n pax · Port → Port` or `Rental · nh`. New Edit action fixes
    capacity/max load/fare/owner (photo preserved). Delete calls
    `admin_delete_bangka`, Restore calls `admin_restore_bangka`, and
    Deactivate now keeps the owner (the old code nulled `bangkero_id`) while
    clearing `rental_listed`. Guards: the service refuses unverified/deleted
    owners and a second boat per bangkero (the app reads their boat with
    `maybeSingle`), and deletion is blocked while the owner holds any accepted
    trip — 049 only checks `bookings.bangka_id`, which accepted trips never
    set. Actions are id-keyed and rows are escaped.
  - **Manage Routes → Manage Ports & Routes (label only; URL and
    `data-page` unchanged):** new ports table with add/edit/delete (slug id
    generated from the name and frozen after creation, coordinates, island
    group/name, queue radius 50–5000 m, active) validated against the DB
    CHECKs; Delete explains FK refusals (queues, manifests, schedules, demand)
    and suggests deactivating. Routes gain a Base Fare column and id-keyed
    actions; estimated minutes are required 1–600; stop management prefills
    the next order, rejects duplicate ports/orders and reorders by writing the
    whole order list; route delete relies on `route_stops`' existing cascade
    instead of deleting stops first. Sidebar + both layout-loader topbars
    renamed.
  - **Served-vs-duplicate fix (found on smoke):** the dashboard services are
    loaded from `web/assets/js/services/` (`../../assets/js/services/...`),
    but this batch had edited the stale duplicate copies under
    `web/BangkaGO-WEB/assets/js/services/` — so `manage-users` and
    `suspend-user` threw `setSuspended is not a function`, and Manage Bangka /
    Manage Ports ran on old services. The new `users.js`, `bangkas.js` and
    `portsRoutes.js` now live in the served tree (`users.js` keeps its
    phone-first search, `bangkeros.js` needed no change — the served copy is
    already newer than the duplicate) and the dead duplicate services folder
    is deleted. G6 was a symptom of that duplicate:
    `manage-bangkeros.html` is fine, the served `bangkeros.js` exports
    `listDeleted`/`softDelete`/`restore`. The mobile
    `(admin)/manage-ports.tsx` still creates ports with an empty id
    (tracker G7).
  - **Next:** run 062 → 063 → 064 → 065 → 066 (see the entry above),
    then: suspend a passenger (app
    lands on the suspended screen; portal refuses sign-in), reactivate; try
    deleting a vessel mid-trip (must refuse); deactivate/activate; add a port
    and edit its coordinates; delete a route with trip history (clean
    "set inactive" message).

- **2026-10-21 — Demo-readiness batch: booking rules v3, accept desk rebuild,
  Open-Meteo weather on all six surfaces, input validation, map legibility
  (gates green: tsc clean, lint 0 errors / 133 warnings, expo-doctor 21/21).**
  - **Migrations 062 + 063 + 064 PENDING — USER MUST RUN, in that order,
    after 061.** 064 `admin_parcel_items_read.sql`: admin SELECT on
    `parcel_items` (038 covered `parcels` + `passenger_details` only), so
    the admin trip manifest can list what cargo is aboard; without it the
    item rows read empty and the card just shows the parcel header.
    062 `booking_rules_v3.sql`: drops 027's one-trip-per-bangkero-per-day
    trigger (multiple same-route accepts until the boat is full are the
    point; route + capacity stay enforced by 008 inside
    `accept_booking_hold`), drops 023's one-active-booking-per-passenger
    index, and adds `enforce_passenger_booking_slot()` +
    `trg_bookings_passenger_slot` — one active SAME-DAY booking per
    passenger, advances clash only on the same date AND slot; occupying
    statuses pending/open/accepted. 063 `port_coordinates.sql`: nine real
    Google-Maps coordinates and two renames (`st-vicente` → "Santa Rosa
    Port, Olango Island", `hilotongan` → "Gilutongan Island") — IDs are
    untouched, so routes/packages follow. Both are no-demo-reset. Until
    062 runs, a second same-day accept still raises 027's error.
  - **Accept desk rebuilt (`BangkeroTripSheet`):** accepting no longer jumps
    into the QR scanner. It opens a sheet that keeps the request list
    behind it: boat-load bar (pax/capacity), SOLO and GROUP sections, the
    just-accepted row highlighted, plus Notify passengers / Scan boarding
    QR / Sail. Sail asks first — "Boat not full (x/y). Sail anyway?" when
    capacity is known. Advance bookings show sailing date + slot and no
    scan. The same sheet opens from ACTIVE TRIPS ("Boat load ›") to review
    the whole load.
  - **Notifications that actually ring:** `expo-haptics` + `expo-audio`
    (+ `expo-asset`) and a bundled `assets/sounds/ping.wav` behind
    `alertPing()`. Bangkero home pings on a newly arrived request; the
    passenger layout pings when a booking flips to accepted and on every
    notification insert (so "Boat is ready" rings too). Local
    notifications remain a no-op in Expo Go on Android.
  - **Accept/close rules:** same-day accepts are blocked while a trip is at
    sea (advance accepts stay open); home shows an "ON TRIP · SAILING NOW"
    banner as the way back; en-route absorbs hardware back
    (`useLockBack`, no header back, `gestureEnabled: false`) so departure
    can never be re-entered. Arrived's Complete Trip now asks for
    confirmation, and the `force_complete_trip` fallback only runs with
    `arrival_bypass` on. Old bug: any completion failure silently
    force-completed trips with nobody boarded.
  - **Booking status:** `advanceLocked` was inverted (locked AFTER the
    slot arrived); the boarding scanner is hidden for future-dated trips.
  - **Passenger booking rule mirror:** `getActiveBooking(uid, {scheduledDate,
    scheduledTime})` — one active same-day booking (date NULL or today),
    advances only clash on the same date + slot; book-ride checks with the
    chosen schedule.
  - **Validation everywhere:** `src/utils/validation.ts` (`nameError`
    2+ letters, `addressError`, `textError`) now guards sign-up, the
    companion form (incl. address), both profile saves, padala receiver /
    contact / item names / quantity, and the report-issue email. Password
    fields no longer flip `editable` while submitting and the secure-text
    toggle ignores Android's spurious empty change — that was the "password
    clears / starts over" bug.
  - **Map:** OpenStreetMap tiles are no longer inverted to near-black, and
    the recentre / + / − stack is gone. `showControls`/`controlsOffset` were
    removed from `OSMMap`/`MapContainer`.
  - **Passenger UI:** burger lives on home only (`showDrawer` default false);
    book-ride highlights the departure row and opens its picker when a
    destination is tapped first, same-island ports are hidden from the
    destination list, the footer quotes ₱/passenger and the total no longer
    collapses to "₱…"; fares-info grew a port search with routes grouped by
    origin; contact-bangkero is always tappable (falls back to an
    explanation); profile's redundant email line is gone.
  - **Labels:** one shared `bookingTypeLabel()` (SOLO / GROUP · n pax /
    PADALA · mode / BOAT RENTAL + ISLAND HOPPING + ADVANCE date · slot /
    TODAY · slot) on passenger My Bookings, bangkero My Trips and both
    request cards. Departure trip details read live accepted pax/parcel
    counts before the manifest is finalized.
  - **Weather (Open-Meteo, free for non-commercial use, no key, no billing —
    the CC BY credit line must stay):** `getLiveWeather` (forecast +
    marine wave height, 15-min AsyncStorage/localStorage cache, stale
    fallback) behind `WeatherCard` on passenger home, bangkero home, admin
    home and coastguard home; `web/BangkaGO-WEB/assets/js/sea-weather.js`
    fills the admin dashboard strip and the coastguard dashboard's Weather
    KPI.
  - **Admin console:** profile lost the synthetic `bangkago+<phone>@gmail.com`
    line (it is the auth address, not an inbox); the drawer no longer carries
    a Profile row (`menuFor` skips admin as it already skips bangkero — the
    admin home header icon still opens Profile + Sign Out); "Active Trips" is
    now "Trips" (menu, admin home MANAGE, screen header, profile menu) since
    the list shows completed/open/accepted too; and every trip card opens
    `/(admin)/booking/{id}`, which gained a MANIFEST card — booker + phone,
    `passenger_details` companions (age/sex/contact/address, boarded/no-show)
    and the booking's parcel with receiver, mode, weight and `parcel_items`
    lines (064).
  - **Next:** Expo Go smoke of the accept loop (accept → sheet → accept a
    second → Notify → Sail), a second same-day booking must raise, an
    advance booking must still accept while sailing, and the web
    dashboards' weather strip over venue wifi.

- **2026-10-20 — FrontPage contact messages table (migration 061, PENDING;
  gates green: tsc clean, lint 0 errors / 131 warnings, expo-doctor 21/21).**
  - **Migration 061 (PENDING — current USER MUST RUN, after 060):**
    `migrations/061_frontpage_submissions.sql` — the table the FrontPage
    "Send Message" (Contact Us) and "Join Us" forms insert into as anon,
    and that Admin → Report & Compliance → User Feedback reads back
    (`submission_type = 'contact'`). It had been referenced in code since
    the web merge but no file existed under any number: 050 was already
    taken by parcel_modes_option_b, and the slot first used here (057)
    was subsequently claimed by the parcel-polishing batch — the file is
    now 061, and the stale `050_…` error string in
    report-compliance.html says 061. Append-only from the client
    (INSERT policy with full validation, no UPDATE/DELETE policies),
    admin-only SELECT via the `users.user_role = 'admin'` EXISTS
    pattern; `partner_role` is limited to the three options the form
    actually offers (Passenger / Bangkero / Bangka Operator) — keep it in
    sync with `joinRole` in `web/FrontPage/index.html`. No demo reset.

- **2026-10-20 — Core sailing batch: en-route screen, offline GPS outbox,
  stuck-departure monitor, DEV skip-sailing, passenger surfacing
  (gates green: tsc clean, lint 0 errors / 130 warnings, expo-doctor 21/21).**
  - **Migration 056 (PENDING — current USER MUST RUN, after 055):**
    `sync_track_points(p_bangka_id, p_points jsonb)` — the offline
    outbox's flush target: client timestamps validated (range + 5-min
    future / 24-h past skew), batch 1–500, boat ownership proven
    server-side (008's `report_boat_position` picks the boat with
    `ORDER BY id LIMIT 1` and stamps `now()` — unsafe to replay), then
    port-queue presence synced from the NEWEST point only using 008's
    enter/leave logic. Adds `vessel_tracking (bangka_id, recorded_at
    DESC)` index. Also `cancel_own_booking` RAISEs once
    `depart_time IS NOT NULL` — closes the post-departure cancel hole
    (`'accepted'` persists through sailing, so trip_stat never blocked
    it). No demo reset.
  - **Offline GPS outbox** (`tracking.service` + `useLocationTracking`):
    every fix is written to AsyncStorage FIRST (FIFO, 720 ≈ 2 h @ 10 s,
    drops oldest), then flushed in ≤500-point batches; flush retries on
    every tick and on AppState-active; a DB without 056 falls back to
    the legacy single-point `report_boat_position`, so tracking never
    breaks pre-migration. Chip states: `● RECORDING` /
    `OFFLINE · N points saved`.
  - **NEW `(bangkero)/en-route.tsx`** — the sailing phase that lived
    nowhere before: `departure.tsx` "Ready to Depart" now pushes here
    (it used to push `arrived`, whose mount-stamp made every trip
    teleport departure→arrival in 0 seconds). Screen shows the route
    line + own boat marker (newest of server fix vs local queue wins),
    progress % / remaining distance (`haversineM`), ETA = `depart_time`
    + route estimate × (1 − progress), RECORDING/OFFLINE chip, SOS, and
    **I have arrived** → stamps `stampManifestArrival` then
    `arrived.tsx` (its idempotent mount-stamp remains the offline retry
    path; Complete Trip keeps its existing retry banner).
  - **Stuck-departure monitor** (same screen): 60 s position samples,
    after 4 min with <100 m displacement and <0.5 m/s → prompt
    "Your boat has not moved in 4 minutes. Is there a problem?"
    [we're fine / we need help → SOS]; **no answer in 60 s → auto
    `safety_alerts` insert (severity high)**, re-prompt every 5 min.
    Escalation is suppressed while `arrival_bypass` is on so rehearsals
    don't fill the admin's alerts page (the prompt itself still shows —
    demoable). Offline escalation is swallowed → LAUNCH_DEFERRED B13.
  - **DEV · Skip sailing →** chip on en-route, rendered only while
    `dev_flags.arrival_bypass` is on (reuses the existing switch — no
    new flag, no new migration): runs the exact Arrived handler, so a
    rehearsal goes depart → sail → skip → close-out with one tap. Flip
    it in Admin → Developer Options before the demo.
  - **Passenger surfacing:** trip-en-route rail keys step 1 off
    `depart_time` (was `onboarded_at` — "On the way" used to light up
    while the boat was still moored), status line shows
    "On the way · ETA ~h:mm", a 1 s clock ticker drives "boat last seen
    Xm ago" (warning past 5 min), and the map now draws the
    departure→arrival route line (`from/to` were never passed).
    booking/[id] caches a booking snapshot in AsyncStorage and replays
    it under an offline banner when the fetch fails.
  - `sailing.tsx` is a different, pre-existing screen (per-sailing
    manifest detail from the trips list) — kept as is; the new tracker
    is `en-route.tsx` to match the passenger's `trip-en-route`.
  - Foreground-only at sea stands (B1): the demo story is
    airplane-mode sync, not screen-off tracking.
  - **USER MUST RUN (current): `migrations/056_offline_track_sync.sql`**
    in the SQL editor, after 055. Until then the outbox keeps queueing
    to its 720 cap and reports fall back to the legacy single-point
    path (no data loss, no crash).
  - **Next:** Expo Go smoke — depart → sail (airplane mode: chip counts
    up, flushes on reconnect) → 4-min stuck prompt → DEV skip → arrived →
    close-out; passenger rail + staleness + offline snapshot; cancel a
    departed booking (must raise).
- **2026-10-16 — Web hardening batch: admin audit trail + rating-adjust
  knob (migration 038, APPLIED same day), auto-logout fixed, live OSM
  fleet maps, real manifest + PDF, phone-first users, perf pass
  (gates green: tsc clean, lint 0 errors / 124 warnings, expo-doctor
  21/21, `npm run web` smoke 34 URLs 200).**
  - **Migration 038 (PENDING):** `audit_log` table (SECURITY DEFINER
    trigger fn + triggers on 11 tables — users, bangkeros,
    bangkero_verification, dev_flags, downpayments, bookings,
    boat_rentals, ports, routes, safety_alerts, bangkas; actor id+role
    snapshot, changed columns old→new; bangkero rating/verification
    columns audited regardless of actor so passenger penalties are
    blamed too), realtime publication, admin-only RLS (coastguards
    cannot read audits), `admin_set_bangkero_rating(bangkero, penalty,
    recovery)` RPC (admin-guarded, validated 0–5, returns
    `bangkero_effective_rating()`, self-auditing), plus admin SELECT
    policies on `passenger_details` AND `parcels` — without them the web
    manifest reads 0 rows. SQL-editor writes (no JWT) are not audited —
    accepted limit, see LAUNCH_DEFERRED A6.
  - **Auto-logout root cause fixed:** `role()` (web/supabase-client.js)
    now returns `'unverified'` for can't-verify vs `null` for
    truly-signed-out (3 retries w/ backoff); layout-loader guard retries
    4× and shows a connection banner + auto-retry instead of bouncing a
    signed-in admin to bangkaGo-access.html on a wifi blip; parallel
    config+UMD load. All 9 pages' "Authentication required. Redirecting…"
    catch blocks replaced with connection-error messages.
  - **Vendored, zero CDN:** bootstrap 5.3.3, bootstrap-icons (woff2),
    Leaflet 1.9.4, jsPDF + autoTable, Sora/DM Sans under
    `web/assets/vendor/` (venue-wifi reasoning, same as supabase UMD);
    all 32 pages swapped.
  - **Maps:** `web/assets/js/fleet-map.js` (lazy-loads vendored Leaflet,
    divIcon dots colored by signal, debounced updates) wired to admin
    monitor-fleet, coastguard monitor-fleet and coastguard index —
    `map.jpg` replaced by live `vessel_tracking` data; route pills' ETA
    math stays an age-based estimate (LAUNCH_DEFERRED A7).
  - **Ratings + audit pages:** ratings.html gets the admin adjust knob
    (target slider 0–5★ back-solving the penalty, penalty 0–5/0.1,
    recovery 0–5, live before→after preview, MANDATORY confirm on every
    change) calling `admin_set_bangkero_rating`; single ratings fetch
    (was double). NEW `audit-log.html` + `services/audit.js` (actor/table
    filters, old→new diff, detail modal, live) — sidebar entry added,
    "View Manifest" sidebar entry removed (file kept).
  - **Manage Bookings:** View Manifest now reads THIS booking's real
    booker + `passenger_details` companions (incl. 028 address) +
    parcels/items — not a guessed trip_manifest row; jsPDF A4 export
    (lazy-loaded); trip-date from/to filter; status-modal X can no longer
    submit (was falsely reporting success) and closing with unsaved
    edits asks for confirmation; realtime keeps active filters.
  - **Users/bangkeros:** manage-users phone-first (column, search,
    modals — email was always N/A), LGU removed from role
    dropdowns/badges/alert-recipient allowlist (branding text untouched);
    manage-bangkeros "Applicant"→"Bangkero Name", "Assigned Bangka"→
    "Bangka Name", real doc thumbnails with icon fallback, short IDs
    with full-on-hover; manage-bangka "View"→"Details".
  - **Data-integrity fix found on the way:** filtered-table row actions
    on manage-users/alerts/payments/bookings indexed the UNFILTERED
    array — Status/Resolve/Cancel could hit a different row during a
    search. All keyed by id now.
  - **Perf:** `enrichBangkeros` 2 queries total (was 2/row), bounded
    vessel fetches (1000 global / 500 per-boat, newest-first),
    realtime queue-until-ready + 400ms debounce, `innerHTML +=` →
    `map/join` on every table render, all load spinners paired with
    `showLoading(false)` (boat-rentals' script block was duplicated 7× —
    deduplicated 523→196 lines).
  - **app.json:** `ios.icon` removed — it pointed at the Expo template's
    `assets/expo.icon` directory (expo-symbol art, not BangkaGo); iOS
    falls back to the real `./assets/images/icon.png`. This is what
    restored expo-doctor to 21/21 (doctor is unpinned; latest tightened
    the `.icon`-directory check). The unreferenced `assets/expo.icon/`
    dir is kept for now — deletable.
  - **MIGRATIONS APPLIED 2026-10-16 (user, SQL editor, in order):**
    `036` → `037` → `038_admin_audit_and_rating_adjust.sql`. 036 and 037
    each carried a ⚠ DEMO RESET (036 wiped ALL ratings + penalties; 037
    reset every bangkero to `incomplete` and nulled their 4 doc paths —
    files stayed in storage, gcash_qr_url untouched). Web audit /
    manifest / ratings all read live DB values now.
- **2026-10-16 — Rating rule v2, bangkero `incomplete` status, booking-form
  fixes, admin escrow steps, two new web pages (migrations 036 + 037,
  applied same day — see the batch above).**
  - **Ratings (036 + TS):** effective rating now comes from one SQL RPC
    `bangkero_effective_rating` — smoothing with a four-5★ prior
    (`(sum+20)/(count+4)`), − penalty, + recovery stars; floor 3.0 → 1.0
    (gates_ok/bangkero_rating_ok recreated in 036, same name so
    assign_next_hold/accept_booking_hold pick it up with no body patch);
    while ≤1.0★ a clock runs and after 2 days the bangkero regains +1★
    (`rating_low_since`/`rating_recovery_stars` columns, tick runs inside
    the VOLATILE RPC); `ratings_insert_own` RLS tightened to the booking
    owner + owner check in rate-trip; `getEffectiveRating` is now a thin
    RPC call (local mirror deleted), `MIN_ACCEPT_RATING = 1.0`, copy
    updated (auth friendlyError, home chip/banner, ratings screen).
    `dev_flags.gates_bypass` still lifts everything — unchanged.
  - **Bangkero documents (037 + TS):** new status `'incomplete'`
    (CHECK widened, DEFAULT moved off 'pending'); signup writes it;
    documentsRoute falls through to verify-boat so the upload screen can
    never be skipped; admin document-review queue drops its `?? data[0]`
    fallback (incomplete rows are unreviewable); operators filter chip +
    STATUS_STYLE entries, profile badge "Upload documents", bangkero-home
    "Upload documents" banner; web manage-bangkeros badge "Not submitted".
  - **Mobile fixes:** Start Trip no longer permanently disabled on
    same-day trips (advanceLocked now keys on `scheduledDate > todayIso()`
    only — SchedulePicker clears slots for today); the "Downpayment not
    recorded" fallback row now shows only for advance bookings
    (`isAdvanceDate`); CompanionForm row ✕ → ✏️ edit (prefilled modal,
    Save changes) with a Remove passenger button inside the modal.
  - **Escrow UX:** numbered "How to confirm this downpayment" steps card
    on mobile Admin → Downpayments (+ reminder in the decision modal);
    GCash reference-number input REMOVED from payment.tsx and
    rental-form.tsx (receipt image only, `referenceNum: ''` — admin reads
    the Ref No. off the image; OCR deferred, researched: OCR.space free
    25k/mo, see LAUNCH_DEFERRED B9a).
  - **Web (new pages):** `admin-dashboard/downpayments.html` (escrow
    review: steps card, receipt viewer, Approve/Refund) and
    `admin-dashboard/ratings.html` + `assets/js/services/ratings.js`
    (per-bangkero avg/count/penalty/recovery/effective, Locked pill ≤1.0★,
    per-rating detail modal); sidebar entries (Operations → Downpayments,
    Analytics → Ratings) + topbarMeta keys in the LIVE loader.
    `payments.js` approve/reject rewritten to the REAL flow (row update +
    `review_advance_escrow` RPC + best-effort notifications — the old
    `approve_downpayment`/`reject_downpayment` RPCs never existed).
  - **MIGRATIONS APPLIED 2026-10-16:** `migrations/036_rating_rule_v2.sql`
    then `migrations/037_bangkero_documents_incomplete.sql` (both contain a
    ⚠ DEMO RESET: 036 wiped ALL ratings + penalties; 037 reset every
    bangkero to `incomplete` and nulled their 4 doc paths — files stay in
    storage, gcash_qr_url untouched).
  - **Stored, not built (user decision):** admin Approve guard on
    missing files → LAUNCH_DEFERRED C9.
- **2026-10-10 — Static web merged into `web/` + Supabase login wired.**
  - Source: `insik\BASE-WEB\BangkaGO-WEB` (incheckk/BangkaGO-WEB, PR #11)
    copied as-is into `web/` — layout preserved (relative links span
    `bangkaGo-access.html` → `BangkaGO-WEB/{admin,coastguard}-dashboard/`,
    topbars → `../../bangkaGo-access.html`, landing = `web/FrontPage/`).
  - Wired: `web/config.js` (EXPO_PUBLIC_* URL + anon key, NEVER the
    service-role key), `web/supabase-client.js` (supabase-js 2.112.4 UMD
    from CDN, same version as the app; mirrors `phone.ts` so login takes
    a PH mobile number), real `signInWithPassword` in `bangkaGo-access.html`
    (demo admin/admin123 bypass REMOVED by decision), role guard at the top
    of each dashboard's `layout-loader.js`, topbar Logout now signs out of
    Supabase.
  - Not wired yet (LAUNCH_DEFERRED `[G]`): dashboard page data is still
    mocked HTML arrays; guard is client-side only (RLS is the boundary).
  - Run the web: `npm run web` → http://localhost:3000 (HTTP required —
    partials load via fetch). Landing `/FrontPage/`, portal
    `/bangkaGo-access.html`. Mobile app untouched; gates unaffected.
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
