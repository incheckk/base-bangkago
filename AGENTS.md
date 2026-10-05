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

- **2026-10-05 — Expo SDK 54 → 57 upgrade (branch `chore/expo-sdk-57`,
  commit 3ec0972).** Dependencies upgraded, `react-native-maps` removed
  (unused), `StyleSheet.absoluteFillObject` → `absoluteFill` (removed in
  RN 0.86), eslint react-hooks v7 compiler rules demoted to `warn`, stale
  SDK-54 mentions patched across docs. Gates green: expo-doctor 21/21,
  tsc clean, lint 0 errors, Android bundle exports. **Pending: on-device
  smoke test in Expo Go, then merge.**
- **2026-10-05 — Migration 021 written (pending run).**
  `migrations/021_final_ports_routes.sql` replaces the 5-port / 12-route /
  ₱70 seed with 9 ports / 40 routes / ₱100 flat / 30 min: wipes demo trip
  data, repoints island-package stops, hard-deletes old network, inserts
  the new one. Matching updates: `scripts/supabase.js` + `seed.js`,
  `quick-ride.tsx` presets, `ml/config` (pandanon dropped — 9 ports /
  40 routes, verified identical to the seed), CLAUDE.md / KB / this file.
  **Pending: run 021 in the SQL editor, then `npm run seed`, then smoke
  test booking flow.** Never re-run 017 (blanket ₱70 update) afterwards.
- **2026-10-05 — Android Expo Go crash fixed.** `expo-notifications` v57
  throws at module evaluation on Android Expo Go (push removed since
  SDK 53), which killed `notification.service` → `booking.service` →
  25 routes ("missing default export") and crashed the passenger Stack
  (`ErrorBoundary of undefined`). Fix: `scheduleLocalNotification` now
  returns early via `isRunningInExpoGo()` — Metro logs caught module-eval
  errors to LogBox, so Expo Go must never load `expo-notifications` at
  all (lazy `import()` only runs in dev/production builds); deleted the
  dead `usePushNotifications.ts` hook. **Android is the priority platform —
  bangkeros and the demo phone are Android (CLAUDE.md DEMO
  RELIABILITY); always verify on Android first.**
- **Next: on-device Expo Go smoke test** (SDK 57 + new ports/routes),
  then merge `chore/expo-sdk-57` to main.
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

**Demo switches to remove (C7)** — Admin → developer-options bypasses
(`dispatch_bypass`, `gates_bypass`) + `dev_flags` table, the two
`set_*_bypass` RPCs, and `trg_bangkero_online_gate` exist only for the
classroom demo. Strip before launch.

**Not built yet, needed at launch**
- B1 — background GPS (Expo Go = foreground only; port queues and
  dispatch fail with the screen off). Needs a dev build.
- B2 — push notifications (offer/hold alerts are realtime chips only).
- B9 — real GCash gateway; today payments are marked paid on board with
  an optional manual reference, escrow is settled out of band.
- B12 — fourth Coastguard/LGU role (view-only screens).
- B5 — passenger en-route boat tracking (screen placeholder exists).

**Environment (D5, D2)** — upload a real GCash QR (Admin → GCash QR)
before any downpayment demo; `docs` storage bucket is public — switch to
private + signed URLs at launch.

**Unwired screens (F)** — exist and compile, but nothing links to them:
(admin) manage-ports, manage-routes, pending-operators, reports;
(passenger) booked, find-bangkero, parcel-details. Wire or delete.

**Product rules to revisit (A)** — strict queue-only can stall requests
forever; 3-min hold / 5-min dwell / 3-min freshness are demo numbers;
island-hop bookings have no companion list; `bangkas.hourly_rate`
defaults to ₱500.
