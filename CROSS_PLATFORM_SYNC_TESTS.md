# BangkaGo Cross-Platform Sync Verification Checklist

## Test Environment Setup
- **Mobile App**: Expo Go on physical device or simulator
- **Web Admin**: `npm run web` → http://localhost:3000
- **Web Coast Guard**: http://localhost:3000/BangkaGO-WEB/coastguard-dashboard/
- **Shared Backend**: Supabase project `izsgvhcgnrtxcilwbuwo`
- **Test Accounts Needed**:
  - Admin: `admin@bangkago.ph` / `admin123` (or configured credentials)
  - Bangkero: Registered operator account
  - Passenger: Registered passenger account
  - Coast Guard: Coast guard role account

---

## Phase 4.1: Mobile → Web Sync Tests

### Prerequisites
- [ ] Mobile app running in Expo Go
- [ ] Web admin dashboard open in browser (admin role)
- [ ] Both authenticated to same Supabase project
- [ ] Browser dev tools open (Console + Network tabs) for debugging

---

### Test 1: Bangkero Creation Sync
**Mobile Action**: Create new bangkero via Admin → Operators → Add Operator
**Web Verification**: 
- [ ] Navigate to `manage-bangkeros.html`
- [ ] New bangkero appears in table within 30 seconds
- [ ] Status shows "Pending" (verification_stat = 'pending')
- [ ] Name, permit number, assigned bangka match mobile entry
- [ ] Realtime update indicator (if implemented) shows sync

**Debug Checks**:
- [ ] Console shows `bangkeros` realtime event received
- [ ] Network tab shows Supabase realtime connection active

---

### Test 2: Passenger Creation Sync
**Mobile Action**: Sign up as new passenger (or Admin → All Users → Add Passenger if available)
**Web Verification**:
- [ ] Navigate to `manage-users.html`
- [ ] New passenger appears in table within 30 seconds
- [ ] Role shows "Passenger"
- [ ] Status shows "Active" (is_verified = true)
- [ ] Email, phone, name match mobile entry

**Debug Checks**:
- [ ] Console shows `users` realtime event received
- [ ] Search/filter works on new entry

---

### Test 3: Booking Creation Sync
**Mobile Action**: Passenger creates booking via Book Ride / Book Package
**Web Verification**:
- [ ] Navigate to `manage-bookings.html`
- [ ] New booking appears in table within 30 seconds
- [ ] Status shows "Open" or "Pending" (trip_stat)
- [ ] Passenger name, route, fare match mobile entry
- [ ] Booking reference (BGO-XXXXXX) visible

**Debug Checks**:
- [ ] Console shows `bookings` realtime event received
- [ ] Status filter works on new booking

---

### Test 4: Booking Acceptance Sync
**Mobile Action**: Bangkero accepts booking on their dashboard
**Web Verification**:
- [ ] Navigate to `manage-bookings.html`
- [ ] Booking status changes to "Accepted" within 10 seconds
- [ ] Bangkero name and vessel assigned appear
- [ ] Accepted timestamp populated

**Debug Checks**:
- [ ] Realtime update near-instant (< 5s)
- [ ] Status badge color changes to primary (Accepted)

---

### Test 5: Downpayment Approval Sync
**Mobile Action**: Admin approves downpayment in Downpayments screen
**Web Verification**:
- [ ] Navigate to `manage-payments.html`
- [ ] Downpayment status changes to "Approved" within 10 seconds
- [ ] Related booking status flips from "Pending" → "Open"
- [ ] Review timestamp populated

**Debug Checks**:
- [ ] Console shows `downpayments` and `bookings` realtime events
- [ ] Booking appears in bangkero's queue (if applicable)

---

## Phase 4.2: Web → Mobile Sync Tests

### Prerequisites
- [ ] Web admin dashboard open (admin role)
- [ ] Mobile app open on relevant screens
- [ ] Both authenticated

---

### Test 6: Port Creation Sync
**Web Action**: Admin → Manage Routes → Create Port (or Manage Ports → Add Port)
**Mobile Verification**:
- [ ] Open mobile Admin → Manage Ports
- [ ] New port appears in list within 30 seconds
- [ ] Port name, location, coordinates match web entry
- [ ] Queue radius and active status correct

---

### Test 7: Route Creation Sync
**Web Action**: Admin → Manage Routes → Create Route (start/end port, fare, distance, time)
**Mobile Verification**:
- [ ] Open mobile Admin → Manage Routes
- [ ] New route appears in list within 30 seconds
- [ ] Start/end ports, base fare, distance, time match
- [ ] Route ID format correct (start__end)

---

### Test 8: User Suspension Sync
**Web Action**: Admin → Manage Users → Click "Suspend" on a user → Confirm
**Mobile Verification**:
- [ ] Open mobile Admin → All Users
- [ ] User status shows "Suspended" within 30 seconds
- [ ] User cannot sign in (test if possible)
- [ ] Role unchanged, only is_verified = false

---

### Test 9: Bangkero Approval Sync
**Web Action**: Admin → Manage Bangkeros → Review docs → Click "Approve"
**Mobile Verification**:
- [ ] Open mobile Admin → Operators
- [ ] Bangkero status changes to "Verified" within 10 seconds
- [ ] Bangkero can now go online (is_available toggle works)
- [ ] Verification badge shows green/checkmark

---

### Test 10: Alert Creation Sync
**Web Action**: Admin → Manage Alerts → Create Alert (message, severity, optional vessel/port)
**Mobile Verification**:
- [ ] Open mobile Admin → Alerts (or Coast Guard → Alerts)
- [ ] New alert appears in feed within 10 seconds
- [ ] Severity badge color matches (Critical=red, High=red, Medium=yellow, Low=blue)
- [ ] Message text matches
- [ ] If vessel/port linked, shows in context

---

## Phase 4.3: Realtime & Polling Verification

### Test 11: Simultaneous Open Windows
**Setup**: 
- [ ] Web admin dashboard open in Browser Tab 1
- [ ] Web admin dashboard open in Browser Tab 2 (same account)
- [ ] Mobile app open on device

**Actions**:
- [ ] Create bangkero in Tab 1 → Verify appears in Tab 2 within 5 seconds
- [ ] Update booking status in Tab 2 → Verify updates in Tab 1 within 5 seconds
- [ ] Mobile accepts booking → Verify both web tabs update within 10 seconds

---

### Test 12: 30-Second Polling Fallback
**Setup**:
- [ ] Disconnect network briefly (or block Supabase realtime in dev tools)
- [ ] Make change on mobile
- [ ] Reconnect network
- [ ] Verify web updates within 30 seconds (polling interval)

---

### Test 13: Realtime Connection Resilience
**Actions**:
- [ ] Open browser dev tools → Network → Filter "WS" (WebSocket)
- [ ] Verify realtime connection shows "101 Switching Protocols"
- [ ] Wait 2+ minutes → Verify connection stays alive (heartbeat)
- [ ] Refresh page → Verify new connection establishes

---

## Phase 4.4: Coast Guard Dashboard Sync

### Test 14: Bangkero Visibility
- [ ] Admin approves bangkero on web
- [ ] Coast Guard → View Bangkeros shows new verified bangkero
- [ ] Status, vessel assignment, availability match

### Test 15: Manifest Visibility
- [ ] Bangkero completes trip on mobile (generates manifest)
- [ ] Coast Guard → View Manifests shows new manifest
- [ ] Passenger list, parcels, route match

### Test 16: Alert Visibility
- [ ] Admin creates safety alert on web
- [ ] Coast Guard → View Active Alerts shows new alert
- [ ] Severity, location, timestamp match

### Test 17: Vessel Tracking
- [ ] Bangkero goes online and starts trip
- [ ] Coast Guard → Monitor Fleet / Search Vessel shows vessel
- [ ] Position updates every ~30s, status "Online"

---

## Phase 4.5: Edge Cases & Error Handling

### Test 18: Conflict Resolution
- [ ] Edit same bangkero on web and mobile simultaneously
- [ ] Last write wins (check timestamp)
- [ ] No data corruption

### Test 19: Offline Handling
- [ ] Disconnect mobile from network
- [ ] Attempt action (should show error/toast)
- [ ] Reconnect → Verify sync catches up

### Test 20: Large Dataset Performance
- [ ] Load pages with 100+ records
- [ ] Verify filters/search still responsive
- [ ] No memory leaks after 10 minutes

---

## Debugging Checklist

### Supabase Dashboard Checks
- [ ] Table `bangkeros` - new rows appear
- [ ] Table `users` - new rows, is_verified updates
- [ ] Table `bookings` - new rows, trip_stat updates
- [ ] Table `downpayments` - status changes
- [ ] Table `ports` - new rows
- [ ] Table `routes` - new rows
- [ ] Table `safety_alerts` - new rows, is_resolved updates
- [ ] Table `trip_manifest` - new rows on trip completion
- [ ] Table `vessel_tracking` - position updates
- [ ] Realtime publications: all tables listed above enabled

### Browser Console Checks
- [ ] No CORS errors
- [ ] No "Failed to load resource" for service scripts
- [ ] Realtime subscriptions show "SUBSCRIBED" events
- [ ] No unhandled promise rejections

### Network Tab Checks
- [ ] WebSocket connection to Supabase realtime
- [ ] REST API calls to Supabase (SELECT, INSERT, UPDATE)
- [ ] No 401/403 errors (RLS policies correct)
- [ ] Response times < 500ms for queries

---

## Sign-Off

| Test Category | Pass | Fail | Notes |
|--------------|------|------|-------|
| Mobile → Web (5 tests) | [ ] | [ ] | |
| Web → Mobile (5 tests) | [ ] | [ ] | |
| Realtime (3 tests) | [ ] | [ ] | |
| Coast Guard (4 tests) | [ ] | [ ] | |
| Edge Cases (3 tests) | [ ] | [ ] | |
| **Total** | **/20** | **/20** | |

**Tested By**: ________________
**Date**: ________________
**Environment**: ________________
**Build Version**: ________________

---

## Known Issues / Deferred
- [ ] Push notifications not working in Expo Go (known limitation)
- [ ] Background GPS not working in Expo Go (known limitation)
- [ ] PDF export in export-manifest.html requires jsPDF library
- [ ] File upload evidence in report-compliance.html stores locally only

---

## Quick Reference: Key Tables & Realtime Channels

| Feature | Tables | Realtime Channel |
|---------|--------|------------------|
| Users | `users` | `users` |
| Bangkeros | `bangkeros`, `bangkas` | `bangkeros`, `bangkas` |
| Bookings | `bookings`, `downpayments` | `bookings`, `downpayments` |
| Ports/Routes | `ports`, `routes`, `route_stops` | `ports`, `routes`, `route_stops` |
| Manifests | `trip_manifest`, `manifest_passengers`, `manifest_parcels` | `trip_manifest`, `manifest_passengers`, `manifest_parcels` |
| Vessels | `bangkas`, `vessel_tracking` | `bangkas`, `vessel_tracking` |
| Alerts | `safety_alerts` | `safety_alerts` |
| Weather | `weather_data` | `weather_data` |
| Port History | `port_queues`, `trip_manifest` | `port_queues`, `trip_manifest` |