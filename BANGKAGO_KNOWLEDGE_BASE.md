# BangkaGo Knowledge Base

> **Read this file before every prompt.** It defines the exact patterns, conventions,
> and architecture of the BangkaGo project. All code you generate must follow these
> patterns precisely.

---

## 1. PROJECT OVERVIEW

**BangkaGo** is a ride-hailing prototype for sea travel between Mactan and Olango
islands (Cebu, Philippines). Passengers book boat trips; bangkeros (boat operators)
receive the requests in real time.

This is a **functional prototype for a panel presentation** — real auth, real
database writes, real-time updates. Not a clickable mockup.

### Tech Stack

| Technology | Version | Status | Notes |
|---|---|---|---|
| React Native | 0.81.5 | Active | Core framework |
| Expo SDK | 54 (pinned) | Active | Do NOT upgrade — demo device caps at 54 |
| Expo Router | v6 (~6.0.24) | Active | File-based routing, built on React Navigation v7 |
| React Navigation | v7 (via Expo Router) | Active | Navigation layer |
| TypeScript | ~5.9.2 | Active | Strict mode |
| Supabase | ^2.112.4 | Active | Auth + Postgres + Realtime |
| OpenStreetMap | Planned | Integration needed | See Section 10 |
| Socket.IO | Set Aside | Not needed | Supabase Realtime handles all real-time |
| Python + FastAPI | Set Aside | Future use | No current use case; potential for ML/API services |

### Hard Constraints

1. **SDK 54 is frozen.** Do not upgrade. The demo device's Expo Go caps at 54.
2. **Expo Go only.** No custom native builds, no config plugins requiring dev builds.
3. **No `@react-native-firebase/*`.** Not compatible with Expo Go.
4. **No manual `router.replace` after auth.** The layout guards handle all redirects.
5. **Every screen must have loading, empty, and error states.** A blank screen reads as broken.
6. **Static SVG map is the current implementation.** OpenStreetMap is planned. See Section 10.

---

## 2. ARCHITECTURE OVERVIEW

### Layering: Service → Hook → Component

```
Component (screen/UI)
    ↓ calls
Hook (useSupabase.ts, useAuth.tsx)
    ↓ calls
Service (auth.service.ts, booking.service.ts, profile.service.ts)
    ↓ calls
Supabase Client (supabase.ts)
    ↓
Supabase (Auth + Postgres + Realtime)
```

**Rules:**
- Components never call `supabase.from()` directly — always through services.
- Services throw on error — they never return error objects.
- Hooks manage state + Realtime subscriptions — components just render.
- The mapper layer (`mappers.ts`) is the only place snake_case ↔ camelCase translation happens.

### File Organization

```
src/
  app/                 Expo Router file-based routes
    _layout.tsx        Root layout (splash gate + AuthProvider)
    index.tsx          Role-based redirect (single routing decision point)
    (auth)/            Auth flow group
      _layout.tsx        Auth guard
      welcome.tsx        Landing page
      sign-in.tsx        Sign-in form
      sign-up.tsx        Sign-up form with role selector
    (passenger)/       Passenger role group
      _layout.tsx        Passenger guard
      home.tsx           Map, service tiles, recent trips
      book.tsx           Full booking flow
      booking/[id].tsx   Live booking status + cancel
      profile.tsx        Passenger profile editing
    (bangkero)/        Bangkero role group
      _layout.tsx        Bangkero guard
      home.tsx           Availability toggle, live request list
      profile.tsx        Bangkero profile + boat editing
  components/          Shared presentational components
    PrimaryButton.tsx    Button (primary/secondary/danger variants)
    ScreenContainer.tsx  SafeAreaView wrapper
    States.tsx           Loading/Empty/Error state components
    SeaMap.tsx           Static SVG map
    StatusPill.tsx       Booking status badge
    TextField.tsx        Labeled text input
    AuthErrorScreen.tsx  Terminal auth error screen
  hooks/               Custom React hooks
    useAuth.tsx          AuthProvider context + hook
    useSupabase.ts       Data hooks with Realtime subscriptions
  services/            Supabase queries and business logic
    supabase.ts          Supabase client init
    auth.service.ts      signUp/signIn/signOut/fetchUserDoc
    booking.service.ts   Booking CRUD operations
    profile.service.ts   Profile/boat update operations
    mappers.ts           DB row → TypeScript Doc mappers
  theme/
    tokens.ts            Design tokens (colors, spacing, radii, typography)
  types/
    models.ts            All TypeScript interfaces
  utils/
    phone.ts             Philippine phone normalization (E.164 ↔ synthetic auth email)
scripts/
  supabase.js           Shared setup + demo data for scripts
  seed.js               Seed Supabase with demo data
  reset.js              Reset bookings + operator availability
```

### Import Aliases

Configured in `tsconfig.json`:
```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"],
      "@/assets/*": ["./assets/*"]
    }
  }
}
```

**Convention:**
- Cross-directory imports use `@/`: `import { colors } from '@/theme/tokens'`
- Same-directory imports use relative: `import { mapBookingRow } from './mappers'`

### State Management

- **Auth state:** React Context via `AuthProvider` wrapping the entire app.
- **Data state:** Custom hooks (`useSupabase.ts`) with `useState` + `useEffect`.
- **Local UI state:** `useState` for form values, busy flags, errors, toggles.
- **No Redux, Zustand, or other state libraries.**
- **No `useReducer`** — all state is simple enough for individual `useState` calls.

---

## 3. FRONTEND PATTERNS

### 3.1 Component Structure

Every component follows this exact structure:

```tsx
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, spacing, typography } from '../theme/tokens';

interface Props {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}

export function PrimaryButton({
  label,
  onPress,
  loading = false,
  disabled = false,
  style,
}: Props) {
  return (
    // ... component JSX
  );
}

const styles = StyleSheet.create({
  // ... styles at bottom
});
```

**Rules:**
- **Named exports** (not default exports) for all components.
- **Functional components only** — zero class components.
- **Props defined as `interface Props`** locally above the component (not in a separate file).
- **Props destructured in function signature** with defaults applied inline.
- **Styles at module bottom** as `const styles = StyleSheet.create({...})`.
- **One StyleSheet per file** — even files with multiple small components share one.
- **No `memo()` usage** — no performance optimizations needed at prototype scale.
- **No ref forwarding** — components are simple.

### 3.2 Screen Composition Pattern

Every screen follows this exact structure:

```tsx
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { useAuth } from '@/hooks/useAuth';
import { useSomeData } from '@/hooks/useSupabase';
import { friendlyError, someAction } from '@/services/some.service';
import { colors, radii, spacing, typography } from '@/theme/tokens';

export default function SomeScreen() {
  // 1. Hooks
  const { user, profile } = useAuth();
  const data = useSomeData(user?.id ?? null);

  // 2. Local state
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 3. Async actions
  async function handleAction() {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      await someAction(user.id);
    } catch (e) {
      setError(friendlyError(e));
    }
    setBusy(false);
  }

  // 4. Early returns for loading/error/empty
  if (data.loading) {
    return (
      <ScreenContainer>
        <LoadingState label="Loading something…" />
      </ScreenContainer>
    );
  }
  if (data.error) {
    return (
      <ScreenContainer>
        <ErrorState message={data.error} />
      </ScreenContainer>
    );
  }
  if (data.data.length === 0) {
    return (
      <ScreenContainer>
        <EmptyState
          icon="🔍"
          title="Nothing here"
          message="Do something to see data."
        />
      </ScreenContainer>
    );
  }

  // 5. Main JSX
  return (
    <ScreenContainer padded={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Screen content */}
      </ScrollView>
    </ScreenContainer>
  );
}

// Sub-components defined as local functions below the main export
function SubComponent({ item }: { item: SomeType }) {
  return (
    <View>
      <Text>{item.name}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: spacing.xxl },
});
```

**Rules:**
- Default export for the main screen (required by Expo Router).
- Sub-components defined as plain functions below the main export, never exported.
- Sub-component props defined inline (not via separate interface).
- Loading/error/empty states returned early before main JSX.
- Error banner pattern (see 3.5) for form-level errors.

### 3.3 Sub-Component Pattern

```tsx
// Inside a screen file, below the main export
function RequestBody({ booking }: { booking: BookingDoc }) {
  return (
    <>
      <View style={styles.requestTop}>
        <Text style={styles.requestRef}>{booking.ref}</Text>
        <StatusPill status={booking.status} />
      </View>
      <Text style={styles.requestRoute}>
        {booking.fromPierName} → {booking.toPierName}
      </Text>
    </>
  );
}
```

**Rules:**
- Defined as plain functions, not exported.
- Props inline in function signature.
- Uses styles from the parent screen's StyleSheet.
- Never in a separate file.

### 3.4 Loading/Empty/Error State Pattern

```tsx
// Full-screen states (returned early)
if (loading) {
  return (
    <ScreenContainer>
      <LoadingState label="Loading piers…" />
    </ScreenContainer>
  );
}
if (error) {
  return (
    <ScreenContainer>
      <ErrorState message={error} />
    </ScreenContainer>
  );
}
if (data.length === 0) {
  return (
    <ScreenContainer>
      <EmptyState
        icon="⚓"
        title="No trips yet"
        message="Book a boat ride and it will show up here."
      />
    </ScreenContainer>
  );
}

// Inline states (wrapped in a container to prevent layout jump)
{loading && (
  <View style={styles.stateBox}>
    <LoadingState label="Loading your trips…" />
  </View>
)}
```

**Rules:**
- `LoadingState` always has a descriptive `label` prop.
- `EmptyState` always has `icon` (emoji), `title`, and `message`.
- `ErrorState` always has `message`. Optional `onRetry` callback.
- Inline states wrapped in `<View style={{ minHeight: 160 }}>` to prevent layout jump.
- Every screen must have all three states — no exceptions.

### 3.5 Error Banner Pattern

```tsx
{!!formError && (
  <View style={styles.banner}>
    <Text style={styles.bannerText}>{formError}</Text>
  </View>
)}
```

Styles (identical in every screen):
```tsx
banner: {
  backgroundColor: 'rgba(224,82,82,0.12)',
  borderColor: colors.danger,
  borderWidth: 1,
  borderRadius: radii.md,
  padding: spacing.md,
  marginBottom: spacing.lg,
},
bannerText: {
  color: colors.danger,
  fontSize: 13,
  lineHeight: 18,
},
```

**Rules:**
- `rgba(224,82,82,0.12)` background — 12% opacity danger red.
- `colors.danger` border and text.
- `radii.md` border radius, `spacing.md` padding.
- Set via `setError(friendlyError(e))` in catch block.
- Success banner uses `rgba(52,214,176,0.12)` with `colors.primary`.

### 3.6 Navigation Pattern

```tsx
import { router, useLocalSearchParams } from 'expo-router';

// Forward navigation (stack push)
router.push('/(passenger)/book');

// Replace current screen (e.g., after sign-up)
router.replace('/(passenger)/home');

// Back
router.back();

// Dynamic route params
const { id } = useLocalSearchParams<{ id: string }>();
```

**Rules:**
- **Never add `router.replace` after auth actions** — the guard handles it.
- `router.push()` for forward navigation.
- `router.replace()` for replacing current screen (only within same flow).
- `router.back()` for going back.
- No `useNavigation()` or `useRouter()` — all via `router` import.
- No navigation headers — `headerShown: false` on every Stack. All screens provide their own header UI.

### 3.7 Guard Pattern

Every route group has a `_layout.tsx` that acts as an auth guard. The pattern is identical:

```tsx
import { Redirect, Stack } from 'expo-router';
import { AuthProvider, useAuth } from '../../hooks/useAuth';
import { AuthErrorScreen } from '../../components/AuthErrorScreen';
import { LoadingState } from '../../components/States';
import { colors } from '../../theme/tokens';

function Guard() {
  const { user, profile, profileLoading, error } = useAuth();

  // 1. If user has error -> show error screen (with sign-out)
  if (user && error) {
    return <AuthErrorScreen message={error} />;
  }

  // 2. If user exists and has profile -> redirect to correct role home
  if (user && profile) {
    if (profile.role === 'passenger') {
      return <Redirect href="/(passenger)/home" />;
    }
    return <Redirect href="/(bangkero)/home" />;
  }

  // 3. If profile is still loading -> show spinner
  if (profileLoading) {
    return <LoadingState label="Loading profile…" />;
  }

  // 4. Otherwise -> show auth screens (welcome, sign-in, sign-up)
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
        animation: 'slide_from_right',
      }}
    />
  );
}

export default function AuthLayout() {
  return (
    <AuthProvider>
      <Guard />
    </AuthProvider>
  );
}
```

**Rules:**
- Every guard must render `AuthErrorScreen` on profile error — any guard that doesn't becomes a dead end with no sign-out.
- `Redirect` from `expo-router` for programmatic navigation.
- Role-based redirect: passenger → `/(passenger)/home`, bangkero → `/(bangkero)/home`.
- No screen manually navigates after auth — the guard handles it once `user && profile` are present.

### 3.8 Form Screen Pattern

```tsx
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';
import { TextField } from '@/components/TextField';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useAuth } from '@/hooks/useAuth';
import { friendlyAuthError, signOut } from '@/services/auth.service';
import { colors, spacing } from '@/theme/tokens';
import { useEffect, useState } from 'react';

export default function ProfileScreen() {
  const { user, profile } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Seed form state from profile
  useEffect(() => {
    if (profile) {
      setFirstName(profile.firstName);
      setLastName(profile.lastName);
    }
  }, [profile]);

  // Auto-dismiss success banner
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(t);
  }, [saved]);

  // Dirty tracking
  const dirty =
    !!profile &&
    (firstName.trim() !== profile.firstName || lastName.trim() !== profile.lastName);

  async function save() {
    if (!user || !profile) return;
    setSaving(true);
    setError(null);
    try {
      await updateName({ uid: user.id, firstName, lastName, isBangkero: true });
      setSaved(true);
    } catch (e) {
      setError(friendlyAuthError(e));
    }
    setSaving(false);
  }

  async function handleSignOut() {
    try {
      await signOut();
    } catch (e) {
      setError(friendlyAuthError(e));
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView keyboardShouldPersistTaps="handled">
        <TextField
          label="First name"
          value={firstName}
          onChangeText={setFirstName}
          autoCapitalize="words"
          editable={!saving}
          maxLength={40}
        />

        {/* Error banner */}
        {!!error && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>{error}</Text>
          </View>
        )}

        {/* Success banner */}
        {saved && !error && (
          <View style={styles.ok}>
            <Text style={styles.okText}>Saved</Text>
          </View>
        )}

        <PrimaryButton
          label="Save changes"
          onPress={save}
          loading={saving}
          disabled={!dirty}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
```

**Rules:**
- `KeyboardAvoidingView` with `behavior: Platform.OS === 'ios' ? 'padding' : undefined`.
- `ScrollView` with `keyboardShouldPersistTaps="handled"`.
- Form state seeded from profile via `useEffect`.
- `dirty` flag computed inline comparing form state to profile.
- "Save changes" button disabled when `!dirty`.
- All inputs disabled via `editable={!saving}` while submitting.
- Success banner auto-dismisses after 2500ms via `setTimeout`.

---

## 4. BACKEND PATTERNS

### 4.1 Supabase Client Init

```ts
// src/services/supabase.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import 'react-native-url-polyfill/auto';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
```

**Rules:**
- Single client instance exported.
- `!` non-null assertion on env vars — crash at init if missing.
- `AsyncStorage` for session persistence across app reloads.
- `detectSessionInUrl: false` — no OAuth redirect flow.

### 4.2 Auth Flow (Synthetic Email)

```ts
// src/services/auth.service.ts
import type { AuthError } from '@supabase/supabase-js';
import type { OperatorDoc, UserDoc, UserRole } from '../types/models';
import { normalizePhone, phoneToAuthEmail } from '../utils/phone';
import { supabase } from './supabase';

export interface SignUpParams {
  phone: string;
  password: string;
  firstName: string;
  lastName: string;
  role: UserRole;
}

export async function signUp({
  phone, password, firstName, lastName, role,
}: SignUpParams): Promise<UserDoc> {
  // 1. Normalize phone to E.164
  const e164 = normalizePhone(phone);
  if (!e164) throw new Error('Enter a valid Philippine mobile number.');

  // 2. Create auth account with synthetic email
  const { data, error } = await supabase.auth.signUp({
    email: phoneToAuthEmail(e164), // +639171234567 -> 639171234567@bangkago.app
    password,
  });
  if (error) throw error;
  if (!data.user) throw new Error('Sign up did not return a user.');

  const uid = data.user.id;

  // 3. Insert profiles row
  const { error: profileError } = await supabase.from('profiles').insert({
    id: uid,
    phone: e164,
    first_name: firstName.trim(),
    last_name: lastName.trim(),
    role,
  });
  if (profileError) throw profileError;

  // 4. Insert operators row for bangkeros
  if (role === 'bangkero') {
    const { error: operatorError } = await supabase.from('operators').insert({
      id: uid,
      display_name: `${firstName.trim()} ${lastName.trim()}`,
      boat_name: null,
      capacity: null,
      is_available: false, // off by default — operator toggles themselves on
    });
    if (operatorError) throw operatorError;
  }

  return { uid, phone: e164, firstName: firstName.trim(), lastName: lastName.trim(), role, createdAt: new Date().toISOString() };
}

export async function signIn(phone: string, password: string): Promise<void> {
  const e164 = normalizePhone(phone);
  if (!e164) throw new Error('Enter a valid Philippine mobile number.');
  const { error } = await supabase.auth.signInWithPassword({
    email: phoneToAuthEmail(e164),
    password,
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function fetchUserDoc(uid: string): Promise<UserDoc | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, phone, first_name, last_name, role, created_at')
    .eq('id', uid)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    uid: data.id,
    phone: data.phone,
    firstName: data.first_name,
    lastName: data.last_name,
    role: data.role,
    createdAt: data.created_at,
  };
}
```

**Rules:**
- Phone is normalized to E.164 before any operation.
- Auth uses synthetic email: `phone_no_plus@bangkago.app`.
- `signUp` creates auth account, then profiles row, then operators row (for bangkeros).
- Boat name and capacity stay null at registration — set from Profile screen.
- `fetchUserDoc` is the only place that does inline mapping (UserDoc is simple).

### 4.3 Service Function Pattern (Throw on Error)

```ts
// src/services/booking.service.ts
import type { OperatorDoc, PierDoc, RouteDoc, UserDoc } from '../types/models';
import { friendlyAuthError } from './auth.service';
import { mapRouteRow } from './mappers';
import { supabase } from './supabase';

export const friendlyError = friendlyAuthError;

export const routeIdFor = (fromPierId: string, toPierId: string) =>
  `${fromPierId}__${toPierId}`;

export async function fetchRoute(
  fromPierId: string,
  toPierId: string
): Promise<RouteDoc | null> {
  const { data, error } = await supabase
    .from('routes')
    .select('*')
    .eq('id', routeIdFor(fromPierId, toPierId))
    .maybeSingle();

  if (error) throw error;
  return data ? mapRouteRow(data) : null;
}

interface CreateArgs {
  passenger: UserDoc;
  fromPier: PierDoc;
  toPier: PierDoc;
  passengerCount: number;
}

export async function createBooking({
  passenger, fromPier, toPier, passengerCount,
}: CreateArgs): Promise<string> {
  if (fromPier.pierId === toPier.pierId) {
    throw new Error('Pick two different piers.');
  }

  const route = await fetchRoute(fromPier.pierId, toPier.pierId);
  if (!route) throw new Error('No route runs between those two piers.');
  if (!route.isActive) throw new Error('That route is not running right now.');

  const { data, error } = await supabase
    .from('bookings')
    .insert({
      passenger_id: passenger.uid,
      passenger_name: `${passenger.firstName} ${passenger.lastName}`,
      passenger_phone: passenger.phone,
      from_pier_id: fromPier.pierId,
      from_pier_name: fromPier.name,
      to_pier_id: toPier.pierId,
      to_pier_name: toPier.name,
      passenger_count: passengerCount,
      fare: route.fare,
      estimated_minutes: route.estimatedMinutes,
      payment_method: 'cash',
      status: 'open',
    })
    .select('id')
    .single();

  if (error) throw error;
  return data.id;
}

export async function cancelBooking(bookingId: string): Promise<void> {
  const { error } = await supabase
    .from('bookings')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
    .eq('id', bookingId);
  if (error) throw error;
}

export async function acceptBooking(
  bookingId: string,
  operator: Pick<OperatorDoc, 'uid' | 'displayName' | 'boatName'>
): Promise<void> {
  const { error } = await supabase
    .from('bookings')
    .update({
      status: 'accepted',
      operator_id: operator.uid,
      operator_name: operator.displayName,
      operator_boat_name: operator.boatName,
      accepted_at: new Date().toISOString(),
    })
    .eq('id', bookingId);
  if (error) throw error;
}

export async function rejectBooking(bookingId: string, operatorUid: string): Promise<void> {
  const { error } = await supabase.rpc('append_rejected_by', {
    booking_id: bookingId,
    operator_uid: operatorUid,
  });
  if (error) throw error;
}

export async function completeBooking(bookingId: string): Promise<void> {
  const { error } = await supabase
    .from('bookings')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', bookingId);
  if (error) throw error;
}

export async function setAvailability(
  operatorUid: string,
  isAvailable: boolean
): Promise<void> {
  const { error } = await supabase
    .from('operators')
    .update({ is_available: isAvailable, updated_at: new Date().toISOString() })
    .eq('id', operatorUid);
  if (error) throw error;
}
```

**Rules:**
- All service functions **throw on error** — they never return error objects.
- `friendlyAuthError` is the single error translator, re-exported as `friendlyError`.
- `createBooking` does NOT set `id` or `ref` — the `set_booking_ref` Postgres trigger handles that.
- `rejectBooking` uses RPC (not direct update) for atomic array append.
- `acceptBooking` relies on RLS for race condition handling — no app-level locking.

### 4.4 friendlyAuthError Pattern

```ts
// src/services/auth.service.ts
export function friendlyAuthError(e: unknown): string {
  const err = e as AuthError | Error | undefined;
  const message = err?.message ?? '';

  if (message.includes('Invalid login credentials')) {
    return 'That mobile number or password is incorrect.';
  }
  if (message.includes('User already registered')) {
    return 'That mobile number is already registered. Try signing in.';
  }
  if (message.includes('Password should be at least')) {
    return 'Password must be at least 6 characters.';
  }
  if (message.includes('Unable to validate email') || message.includes('invalid format')) {
    return 'Enter a valid Philippine mobile number.';
  }
  if (message.includes('Email not confirmed')) {
    return 'This account needs confirmation. Contact support.';
  }
  if (message.toLowerCase().includes('rate limit') || message.includes('Too many requests')) {
    return 'Too many attempts. Wait a moment and try again.';
  }
  if (message.includes('Network') || message.includes('fetch')) {
    return 'No connection to the server. Check your network and try again.';
  }
  if (message.includes('disabled') || message.includes('banned')) {
    return 'This account has been disabled.';
  }
  if (message.toLowerCase().includes('permission') || message.toLowerCase().includes('policy')) {
    return 'You do not have permission to do that.';
  }
  if (message) return `Something went wrong (${message}).`;
  return 'Something went wrong. Please try again.';
}
```

**Rules:**
- Match on `error.message` text, not error codes (Supabase `AuthError` has no stable code enum).
- Re-exported as `friendlyError` by other services for local import convenience.
- Every possible Supabase error message should have a user-friendly mapping.

### 4.5 Mapper Pattern (snake_case → camelCase)

```ts
// src/services/mappers.ts
import type { BookingDoc, OperatorDoc, PierDoc, RouteDoc } from '../types/models';

export function mapPierRow(row: any): PierDoc {
  return {
    pierId: row.id,
    name: row.name,
    island: row.island,
    mapX: row.map_x,
    mapY: row.map_y,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  };
}

export function mapRouteRow(row: any): RouteDoc {
  return {
    routeId: row.id,
    fromPierId: row.from_pier_id,
    toPierId: row.to_pier_id,
    fare: row.fare,
    estimatedMinutes: row.estimated_minutes,
    isActive: row.is_active,
  };
}

export function mapOperatorRow(row: any): OperatorDoc {
  return {
    uid: row.id,          // Note: id maps to uid
    displayName: row.display_name,
    boatName: row.boat_name,
    capacity: row.capacity,
    isAvailable: row.is_available,
    updatedAt: row.updated_at,
  };
}

export function mapBookingRow(row: any): BookingDoc {
  return {
    bookingId: row.id,
    ref: row.ref,
    passengerId: row.passenger_id,
    passengerName: row.passenger_name,
    passengerPhone: row.passenger_phone,
    fromPierId: row.from_pier_id,
    fromPierName: row.from_pier_name,
    toPierId: row.to_pier_id,
    toPierName: row.to_pier_name,
    passengerCount: row.passenger_count,
    fare: row.fare,
    estimatedMinutes: row.estimated_minutes,
    paymentMethod: row.payment_method,
    status: row.status,
    operatorId: row.operator_id,
    operatorName: row.operator_name,
    operatorBoatName: row.operator_boat_name,
    rejectedBy: row.rejected_by ?? [],  // Null safety on array
    createdAt: row.created_at,
    acceptedAt: row.accepted_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
  };
}
```

**Rules:**
- Mappers are the **single place** where snake_case ↔ camelCase translation happens.
- Accept `any` (Supabase row) — type narrowing done by caller.
- `rejectedBy` defaults to `[]` if null from DB.
- `id` maps to `uid` for operators, `pierId` for piers, `routeId` for routes, `bookingId` for bookings.

### 4.6 RPC Pattern (Atomic Multi-Table Updates)

```ts
// Reject booking — atomic array append via Postgres function
export async function rejectBooking(bookingId: string, operatorUid: string): Promise<void> {
  const { error } = await supabase.rpc('append_rejected_by', {
    booking_id: bookingId,
    operator_uid: operatorUid,
  });
  if (error) throw error;
}

// Rename bangkero — atomic two-table update via Postgres function
export async function updateName({ uid, firstName, lastName, isBangkero }: NameArgs): Promise<void> {
  const first = firstName.trim();
  const last = lastName.trim();
  if (!first || !last) throw new Error('First and last name are required.');

  const { error } = await supabase.rpc('update_display_name', {
    p_uid: uid,
    p_first_name: first,
    p_last_name: last,
    p_is_bangkero: isBangkero,
  });
  if (error) throw error;
}
```

**When to use RPC:**
- Multi-table updates that must be atomic (`update_display_name` updates both `profiles` and `operators`).
- Array mutations that must be concurrent-safe (`append_rejected_by` avoids read-modify-write race).
- Any operation where a client-side transaction would be needed.

---

## 5. DATA HOOKS PATTERN

### 5.1 Result Interface

```ts
interface Result<T> {
  data: T;
  loading: boolean;
  error: string | null;
}
```

Every data hook returns `Result<T>`. This is the universal return type.

### 5.2 Complete Hook Template

```ts
// src/hooks/useSupabase.ts
import { useEffect, useState } from 'react';
import { mapSomeRow } from '../services/mappers';
import { supabase } from '../services/supabase';
import type { SomeDoc } from '../types/models';

interface Result<T> {
  data: T;
  loading: boolean;
  error: string | null;
}

export function useSomeData(param: string | null): Result<SomeDoc[]> {
  const [data, setData] = useState<SomeDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // 1. Early return if param is null
    if (!param) { setData([]); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);

    // 2. Async fetch function
    const load = async () => {
      const { data: rows, error: err } = await supabase
        .from('some_table')
        .select('*')
        .eq('some_column', param);
      if (cancelled) return;
      if (err) { setError(err.message); setLoading(false); return; }
      setData((rows ?? []).map(mapSomeRow));
      setLoading(false);
      setError(null);
    };

    // 3. Initial fetch
    load();

    // 4. Realtime subscription
    const channel = supabase
      .channel('some-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'some_table', filter: `some_column=eq.${param}` },
        load
      )
      .subscribe();

    // 5. Cleanup
    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [param]);

  return { data, loading, error };
}
```

### 5.3 Single Item Hook Variant

```ts
export function useOneItem(itemId: string | null): Result<SomeDoc | null> {
  const [data, setData] = useState<SomeDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!itemId) { setData(null); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);

    const load = async () => {
      const { data: row, error: err } = await supabase
        .from('some_table')
        .select('*')
        .eq('id', itemId)
        .maybeSingle();
      if (cancelled) return;
      if (err) { setError(err.message); setLoading(false); return; }
      setData(row ? mapSomeRow(row) : null);
      setLoading(false);
      setError(null);
    };

    load();

    const channel = supabase
      .channel(`some-${itemId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'some_table', filter: `id=eq.${itemId}` },
        load
      )
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [itemId]);

  return { data, loading, error };
}
```

### 5.4 Count Hook Variant

```ts
export function useCount(): Result<number> {
  const [data, setData] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const { count, error: err } = await supabase
        .from('some_table')
        .select('*', { count: 'exact', head: true })
        .eq('some_column', true);
      if (cancelled) return;
      if (err) { setError(err.message); setLoading(false); return; }
      setData(count ?? 0);
      setLoading(false);
      setError(null);
    };

    load();

    const channel = supabase
      .channel('some-count')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'some_table' }, load)
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, []);

  return { data, loading, error };
}
```

### 5.5 Key Hook Rules

| Rule | Why |
|---|---|
| `let cancelled = false` guard | Prevents state updates on unmounted components |
| `supabase.removeChannel(channel)` in cleanup | Prevents memory leaks from orphaned subscriptions |
| Full refetch on any change, not diff-based | Simpler to reason about, cheap at prototype volume |
| Client-side filtering for complex queries | Avoids composite index requirements |
| Unique channel names per entity | Prevents subscription conflicts |
| `head: true` for counts | Returns only the count, no rows — efficient |

### 5.6 Sorting Convention

```ts
const byNewest = (a: BookingDoc, b: BookingDoc) =>
  new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

// Usage
setData((rows ?? []).map(mapBookingRow).sort(byNewest).slice(0, max));
```

All bookings sorted client-side by `createdAt` descending. Avoids composite indexes.

---

## 6. TYPE SYSTEM

### 6.1 Union Types

```ts
type UserRole = 'passenger' | 'bangkero';
type BookingStatus = 'open' | 'accepted' | 'completed' | 'cancelled';
```

No `rejected` status — rejection is per-operator via `rejectedBy: string[]`.

### 6.2 Doc Interfaces

```ts
// src/types/models.ts

export interface UserDoc {
  uid: string;
  phone: string;           // E.164 format: +639171234567
  firstName: string;
  lastName: string;
  role: UserRole;
  createdAt: string;       // ISO 8601
}

export interface OperatorDoc {
  uid: string;
  displayName: string;
  boatName: string | null;
  capacity: number | null;
  isAvailable: boolean;
  updatedAt: string;       // ISO 8601
}

export interface PierDoc {
  pierId: string;
  name: string;
  island: string;
  mapX: number;            // 0–1 normalized to SVG viewBox
  mapY: number;            // 0–1 normalized to SVG viewBox
  sortOrder: number;
  isActive: boolean;
}

export interface RouteDoc {
  routeId: string;         // Format: `${fromPierId}__${toPierId}`
  fromPierId: string;
  toPierId: string;
  fare: number;
  estimatedMinutes: number;
  isActive: boolean;
}

export interface BookingDoc {
  bookingId: string;
  ref: string;             // Format: `BGO-A7F2K9`
  passengerId: string;
  passengerName: string;   // Denormalized
  passengerPhone: string;  // Denormalized
  fromPierId: string;
  fromPierName: string;    // Denormalized
  toPierId: string;
  toPierName: string;      // Denormalized
  passengerCount: number;
  fare: number;
  estimatedMinutes: number;
  paymentMethod: 'cash';   // Hardcoded
  status: BookingStatus;
  operatorId: string | null;     // Null until accepted
  operatorName: string | null;   // Null until accepted
  operatorBoatName: string | null; // Null until accepted
  rejectedBy: string[];    // UIDs of operators who declined
  createdAt: string;       // ISO 8601
  acceptedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
}
```

**Convention:** All Doc types use **camelCase** properties. All database columns use **snake_case**. The mapper layer translates between them.

---

## 7. DESIGN SYSTEM

### 7.1 Colors (Dark Nautical Theme)

```ts
// src/theme/tokens.ts
export const colors = {
  bg: '#0A1620',           // Screen background (deepest dark)
  bgElevated: '#101E28',   // Elevated surfaces (modals, map bg)
  surface: '#16262F',      // Card/panel background
  surfaceAlt: '#1B2F3A',   // Alternate/active card background
  border: '#24404D',       // Default border
  borderSubtle: '#1D3441', // Subtle/inactive border
  primary: '#34D6B0',      // Teal primary (buttons, links, active)
  primaryDark: '#1FA88A',  // Darker teal (Switch track on)
  primaryText: '#04241D',  // Dark text on primary bg
  accent: '#E8593C',       // Orange accent
  warning: '#E8A93C',      // Yellow/amber (open booking)
  danger: '#E05252',       // Red (errors, cancel, delete)
  text: '#F2F5F4',         // Primary text (near-white)
  textSecondary: '#A9BEC4', // Secondary text
  textMuted: '#5F7883',    // Muted labels, captions
  textOnDisabled: '#4A6672', // Text on disabled buttons
} as const;
```

### 7.2 Spacing

```ts
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;
```

Multiples of 4. `spacing.xl` is the standard horizontal screen padding.

### 7.3 Radii

```ts
export const radii = {
  sm: 6,     // Chips, tags
  md: 10,    // Cards, buttons, inputs
  lg: 14,    // Map containers
  pill: 999, // Fully rounded (status pills, badges)
} as const;
```

### 7.4 Typography

```ts
export const typography = {
  h1: { fontSize: 28, fontWeight: '700' as const, color: colors.text },
  h2: { fontSize: 20, fontWeight: '700' as const, color: colors.text },
  body: { fontSize: 15, fontWeight: '400' as const, color: colors.text },
  label: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: colors.textMuted,
    letterSpacing: 1,
    textTransform: 'uppercase' as const,
  },
  caption: { fontSize: 13, fontWeight: '400' as const, color: colors.textSecondary },
} as const;
```

**Usage:** Spread into StyleSheet properties: `...typography.h1`.

### 7.5 Status Colors

| Status | Color | Background |
|---|---|---|
| `open` | `colors.warning` (amber) | `rgba(232,169,60,0.14)` |
| `accepted` | `colors.primary` (teal) | `rgba(52,214,176,0.14)` |
| `completed` | `colors.primary` (teal) | `rgba(52,214,176,0.14)` |
| `cancelled` | `colors.danger` (red) | `rgba(224,82,82,0.14)` |

### 7.6 Token Rules

- **Never use raw hex in StyleSheet** — always reference tokens.
- **Inline `rgba()`** is the only exception — for translucent overlays.
- **Dynamic styles use array syntax:** `style={[styles.base, condition && styles.variant]}`.
- **Inline style overrides** passed via `style?: ViewStyle` prop on components.

---

## 8. DATABASE SCHEMA

### 8.1 Tables

#### `profiles`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID (PK) | Matches Supabase auth user ID |
| `phone` | text | E.164 format |
| `first_name` | text | |
| `last_name` | text | |
| `role` | text | `'passenger'` or `'bangkero'` |
| `created_at` | timestamp | Set at insert |

#### `operators`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID (PK) | Matches Supabase auth user ID |
| `display_name` | text | Public-facing name |
| `boat_name` | text (nullable) | Set from Profile screen |
| `capacity` | integer (nullable) | Set from Profile screen |
| `is_available` | boolean | Toggle for online status |
| `updated_at` | timestamp | Updated on every edit |

#### `piers`
| Column | Type | Notes |
|---|---|---|
| `id` | text (PK) | e.g. `'mactan-pier-1'` |
| `name` | text | Display name |
| `island` | text | Island name |
| `map_x` | float | 0–1 normalized for SVG |
| `map_y` | float | 0–1 normalized for SVG |
| `sort_order` | integer | Display ordering |
| `is_active` | boolean | |

#### `routes`
| Column | Type | Notes |
|---|---|---|
| `id` | text (generated) | Format: `{from_pier_id}__{to_pier_id}` |
| `from_pier_id` | text | |
| `to_pier_id` | text | |
| `fare` | integer | In Philippine pesos |
| `estimated_minutes` | integer | |
| `is_active` | boolean | |

#### `bookings`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID (trigger-generated) | Set by `set_booking_ref` |
| `ref` | text (trigger-generated) | Format: `BGO-XXXXXX` |
| `passenger_id` | UUID (FK) | |
| `passenger_name` | text | Denormalized |
| `passenger_phone` | text | Denormalized |
| `from_pier_id` | text | |
| `from_pier_name` | text | Denormalized |
| `to_pier_id` | text | |
| `to_pier_name` | text | Denormalized |
| `passenger_count` | integer | |
| `fare` | integer | Copied from route at create time |
| `estimated_minutes` | integer | Copied from route at create time |
| `payment_method` | text | Hardcoded `'cash'` |
| `status` | text | `'open'` / `'accepted'` / `'completed'` / `'cancelled'` |
| `operator_id` | UUID (nullable) | Set on accept |
| `operator_name` | text (nullable) | Denormalized on accept |
| `operator_boat_name` | text (nullable) | Denormalized on accept |
| `rejected_by` | UUID[] | Array of operator UIDs who declined |
| `created_at` | timestamp | |
| `accepted_at` | timestamp (nullable) | |
| `completed_at` | timestamp (nullable) | |
| `cancelled_at` | timestamp (nullable) | |

### 8.2 Postgres Functions

| Function | Purpose | Called From |
|---|---|---|
| `set_booking_ref` | Trigger: auto-generates `id` + `ref` on INSERT | Automatic |
| `append_rejected_by(booking_id, operator_uid)` | Atomic array append to `rejected_by` | `rejectBooking()` |
| `update_display_name(p_uid, p_first_name, p_last_name, p_is_bangkero)` | Atomic two-table name update | `updateName()` |

### 8.3 RLS Booking Transitions

| Who | Transition | Guard |
|---|---|---|
| Passenger (own booking) | `open` → `cancelled` | Sets `cancelled_at` only |
| Bangkero (verified role) | `open` → `accepted` | Must set own uid as `operator_id`; booking must still be `open` |
| Bangkero (assigned only) | `accepted` → `completed` | `operator_id` must equal caller uid |
| Bangkero (any available) | `open` → `open` | May only append own uid to `rejected_by` |

- `piers` + `routes`: client-read-only (seeded via service role key).
- Booking `create`: requires role = passenger + own uid + status = `'open'`.
- No deletes anywhere in production code.

### 8.4 Seed Data

| Type | Count | Details |
|---|---|---|
| Piers | 5 | Mactan Pier 1, Mactan Pier 2, Olango Port, Caohagan, Nalusuan |
| Routes | 12 | 6 pairs, both directions, ₱150–₱400, 15–55 min |
| Accounts | 3 | 1 passenger, 2 bangkeros (all password: `demo1234`) |
| Bookings | 4 | 2 completed, 2 cancelled (historical) |

---

## 9. CRITICAL RULES

1. **Never add `router.replace` after auth actions.** The layout guards handle all redirects. Manual navigation races the guard.

2. **Every screen must have loading, empty, and error states.** A blank screen reads as broken during demo.

3. **No composite indexes.** Every booking query filters on one column and sorts in memory via `byNewest`. Adding `orderBy` on a different field than `where` reintroduces the index requirement.

4. **Strip `__DEV__` `[timing]` logs** from `useAuth.tsx` before final submission.

5. **All four guards must render `AuthErrorScreen` on profile error.** Any guard that doesn't becomes a dead end with no sign-out.

6. **Bookings denormalize names at write time.** Past trips read the way they did when they happened — not silently rewritten.

7. **No deletes in production code.** Only the service-role scripts delete rows.

8. **Service functions throw; screen functions catch and set state.** No error objects flow through the UI.

9. **Mappers are the single translation point.** Screens never touch DB column names directly.

10. **Realtime hooks do full refetch, not incremental patches.** This is intentional for simplicity at prototype scale.

11. **Operators start offline.** `is_available: false` at registration. The operator toggles themselves on.

12. **Inline `rgba()` is the only place raw hex appears** in stylesheets — all other colors come from tokens.

13. **Sub-components within screens are local functions** — never exported, never in separate files.

14. **`friendlyAuthError` is the single error translation function** — re-exported as `friendlyError` by other services.

---

## 10. OPENSTREETMAP INTEGRATION

### 10.1 Current State

The current `SeaMap.tsx` is a **static SVG** with hand-fitted Bézier coastlines. It uses normalized 0–1 coordinates (`mapX`/`mapY`) on each pier, drawn into a 100×100 viewBox.

**Why static SVG was chosen:**
- Deterministic, offline-safe
- No API key needed
- No location permission needed
- Cannot fail on venue wifi (critical for live demo)

**Limitations:**
- Not a real map — just a schematic
- Coastlines are approximate Bézier curves
- No zoom, pan, or real geography

### 10.2 The Expo Go Constraint

| Library | Works in Expo Go? | Notes |
|---|---|---|
| `react-native-maps` | ❌ No | Requires native module, needs dev build |
| `@rnmapbox/maps` | ❌ No | Requires native module |
| `react-native-webview` + Leaflet | ✅ Yes | Pure JS, no native modules |
| Static SVG (current) | ✅ Yes | Already implemented |

**For Expo Go, the only viable OSM option is `react-native-webview` + Leaflet.**

If you later move to a dev build, `react-native-maps` with OSM tile URLs is the better long-term solution.

### 10.3 Option A: WebView + Leaflet (Expo Go Compatible)

```tsx
// src/components/OSMMap.tsx
import React, { useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { colors, radii } from '../theme/tokens';
import type { PierDoc } from '../types/models';

interface Props {
  piers: PierDoc[];
  fromPierId?: string | null;
  toPierId?: string | null;
  height?: number;
}

// Center of the Mactan-Olango corridor
const CENTER_LAT = 10.3157;
const CENTER_LNG = 124.0150;
const ZOOM = 11;

function buildLeafletHTML(piers: PierDoc[], fromPierId: string | null, toPierId: string | null): string {
  const pierMarkers = piers.map((p) => {
    // You need real lat/lng coordinates on your piers table.
    // For now, this is a placeholder showing the structure.
    const isActive = p.pierId === fromPierId || p.pierId === toPierId;
    const color = isActive ? '#34D6B0' : '#A9BEC4';
    const radius = isActive ? 10 : 7;
    return `
      L.circleMarker([${p.latitude}, ${p.longitude}], {
        radius: ${radius},
        fillColor: '${color}',
        color: '#0A1620',
        weight: 2,
        opacity: 1,
        fillOpacity: 0.8
      }).addTo(map).bindPopup('${p.name}');
    `;
  }).join('\n');

  // Route line between selected piers
  const from = piers.find((p) => p.pierId === fromPierId);
  const to = piers.find((p) => p.pierId === toPierId);
  const routeLine = from && to
    ? `L.polyline([[${from.latitude}, ${from.longitude}], [${to.latitude}, ${to.longitude}]], {
        color: '#34D6B0', weight: 3, dashArray: '8 6', opacity: 0.8
      }).addTo(map);`
    : '';

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
      <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
      <style>
        html, body, #map { margin: 0; padding: 0; height: 100%; width: 100%; }
        .leaflet-control-attribution { font-size: 8px !important; }
      </style>
    </head>
    <body>
      <div id="map"></div>
      <script>
        var map = L.map('map', {
          zoomControl: false,
          attributionControl: true
        }).setView([${CENTER_LAT}, ${CENTER_LNG}], ${ZOOM});

        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          maxZoom: 18
        }).addTo(map);

        ${pierMarkers}
        ${routeLine}

        // Fit map to show all piers
        var bounds = L.latLngBounds([${piers.map((p) => `[${p.latitude}, ${p.longitude}]`).join(',')}]);
        map.fitBounds(bounds, { padding: [30, 30] });
      </script>
    </body>
    </html>
  `;
}

export function OSMMap({ piers, fromPierId = null, toPierId = null, height = 200 }: Props) {
  const webViewRef = useRef<WebView>(null);
  const html = buildLeafletHTML(piers, fromPierId, toPierId);

  return (
    <View style={[styles.wrap, { height }]}>
      <WebView
        ref={webViewRef}
        source={{ html }}
        style={styles.webview}
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radii.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  webview: {
    flex: 1,
    backgroundColor: colors.bgElevated,
  },
});
```

### 10.4 Option B: react-native-maps with OSM Tiles (Dev Build Only)

```tsx
// Requires: npx expo install react-native-maps
// Only works in a dev build, NOT in Expo Go

import React from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, UrlTile } from 'react-native-maps';

import { colors, radii } from '../theme/tokens';
import type { PierDoc } from '../types/models';

interface Props {
  piers: PierDoc[];
  fromPierId?: string | null;
  toPierId?: string | null;
  height?: number;
}

// OSM tile URL — no API key needed, but must include attribution
const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export function OSMMap({ piers, fromPierId = null, toPierId = null, height = 200 }: Props) {
  const from = piers.find((p) => p.pierId === fromPierId);
  const to = piers.find((p) => p.pierId === toPierId);

  return (
    <View style={[styles.wrap, { height }]}>
      <MapView
        style={styles.map}
        initialRegion={{
          latitude: 10.3157,
          longitude: 124.0150,
          latitudeDelta: 0.15,
          longitudeDelta: 0.15,
        }}
        scrollEnabled={false}
        zoomEnabled={false}
        pitchEnabled={false}
        rotateEnabled={false}
      >
        {/* OSM tiles — no API key needed */}
        <UrlTile
          urlTemplate={OSM_TILE_URL}
          maximumZ={18}
          attribution="© OpenStreetMap contributors"
        />

        {/* Pier markers */}
        {piers.map((p) => (
          <Marker
            key={p.pierId}
            coordinate={{ latitude: p.latitude, longitude: p.longitude }}
            title={p.name}
            pinColor={
              p.pierId === fromPierId || p.pierId === toPierId
                ? '#34D6B0'
                : '#A9BEC4'
            }
          />
        ))}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radii.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  map: {
    flex: 1,
  },
});
```

### 10.5 Coordinate Migration

The current `piers` table has `map_x` and `map_y` (0–1 normalized). For OSM, you need real GPS coordinates.

**Migration SQL:**
```sql
ALTER TABLE piers ADD COLUMN latitude DECIMAL(10, 7);
ALTER TABLE piers ADD COLUMN longitude DECIMAL(10, 7);

UPDATE piers SET
  latitude = CASE id
    WHEN 'mactan-pier-1' THEN 10.3068
    WHEN 'mactan-pier-2' THEN 10.2950
    WHEN 'olango-port'   THEN 10.3320
    WHEN 'caohagan'      THEN 10.2750
    WHEN 'nalusuan'      THEN 10.2850
  END,
  longitude = CASE id
    WHEN 'mactan-pier-1' THEN 124.0120
    WHEN 'mactan-pier-2' THEN 124.0050
    WHEN 'olango-port'   THEN 124.0450
    WHEN 'caohagan'      THEN 124.0650
    WHEN 'nalusuan'      THEN 124.0550
  END;

ALTER TABLE piers ALTER COLUMN latitude SET NOT NULL;
ALTER TABLE piers ALTER COLUMN longitude SET NOT NULL;
```

**Update the TypeScript interface:**
```ts
export interface PierDoc {
  pierId: string;
  name: string;
  island: string;
  mapX: number;        // Keep for static SVG fallback
  mapY: number;        // Keep for static SVG fallback
  latitude: number;    // NEW: real GPS latitude
  longitude: number;   // NEW: real GPS longitude
  sortOrder: number;
  isActive: boolean;
}
```

**Update the mapper:**
```ts
export function mapPierRow(row: any): PierDoc {
  return {
    pierId: row.id,
    name: row.name,
    island: row.island,
    mapX: row.map_x,
    mapY: row.map_y,
    latitude: row.latitude,
    longitude: row.longitude,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  };
}
```

### 10.6 Recommended Approach

| Phase | Map Solution | Why |
|---|---|---|
| **Current (Expo Go)** | Static SVG fallback + WebView + Leaflet | Works in Expo Go, no native modules |
| **Future (Dev Build)** | `react-native-maps` + OSM tiles | Better performance, native gestures, no WebView |

**Fallback strategy:** Keep `SeaMap.tsx` as a fallback. If the WebView fails (venue wifi, offline), show the static SVG instead:

```tsx
import { OSMMap } from './OSMMap';
import { SeaMap } from './SeaMap';

export function MapContainer(props: MapProps) {
  const [webviewFailed, setWebviewFailed] = useState(false);

  if (webviewFailed) {
    return <SeaMap {...props} />;
  }

  return (
    <ErrorBoundary onError={() => setWebviewFailed(true)}>
      <OSMMap {...props} />
    </ErrorBoundary>
  );
}
```

### 10.7 OSM Attribution Requirement

OpenStreetMap tiles **require** attribution. The legal requirement is:

> © OpenStreetMap contributors

This must be visible on the map. Leaflet adds it automatically via `attributionControl: true`. For `react-native-maps`, use the `attribution` prop on `UrlTile`.

---

## 11. FUTURE TECHNOLOGY NOTES

### 11.1 Python + FastAPI

**Current use case:** None — Supabase handles auth, database, and real-time.

**Potential future uses:**
- **ML demand prediction** (Random Forest model trained on historical booking data)
- **External API integrations** (weather data, fare optimization)
- **Admin/LGU dashboard API** (if a separate admin backend is built)
- **Background job processing** (email notifications, analytics aggregation)

**Integration approach:**
```
React Native App → FastAPI (Python) → Supabase (database)
```

FastAPI would sit between the app and Supabase for any logic that can't run in Postgres functions (e.g., ML inference, external API calls).

### 11.2 Socket.IO

**Status:** Set aside — Supabase Realtime handles all real-time needs.

**Why it's redundant:**
- Supabase Realtime provides `postgres_changes` subscriptions
- The app already subscribes to all relevant table changes
- Socket.IO would add a second WebSocket connection for no benefit

**When it might be needed:**
- If the app needs to communicate with a custom backend (FastAPI) that isn't Supabase
- If real-time features extend beyond database changes (e.g., chat, typing indicators)
- If the app needs to broadcast events to external clients (admin dashboard, LGU system)

### 11.3 React Navigation (Standalone)

**Status:** Active but accessed through Expo Router v6.

Expo Router v6 is built on top of React Navigation v7. You don't import React Navigation directly — Expo Router wraps it. All navigation goes through `expo-router` imports (`router`, `useLocalSearchParams`, `Stack`, `Redirect`).

**When you'd use React Navigation directly:**
- Custom transition animations not supported by Expo Router
- Deep linking configuration beyond file-based routes
- Bottom tab navigation (if added later)

---

*This file is the source of truth for BangkaGo patterns. Read it before every prompt.*
