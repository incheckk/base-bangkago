# BangkaGo

Capstone prototype — a ride-hailing platform for sea travel between Mactan and
Olango, Cebu. Passengers book boat trips; bangkeros (boat operators) receive the
requests in real time.

Expo SDK 57 · Expo Router v6 · TypeScript · Firebase Auth + Firestore.
Runs in **Expo Go** — no custom native build.

## Setup

```bash
npm install
cp .env.example .env   # then fill in your Firebase web config
npx expo start
```

## Structure

```
src/
  app/            expo-router root
    (auth)/       welcome, sign-in, sign-up   — guard: redirects out if signed in
    (passenger)/  passenger stack             — guard: role must be 'passenger'
    (bangkero)/   bangkero stack              — guard: role must be 'bangkero'
    index.tsx     role-based redirect
  components/     ScreenContainer, PrimaryButton, TextField, States, StatusPill
  hooks/          useAuth — AuthProvider + live profile subscription
  services/       firebase (init), auth.service (signUp/signIn/signOut)
  theme/          design tokens
  types/          Firestore document models
  utils/          phone normalization (E.164 <-> synthetic auth email)
```

See `CLAUDE.md` for scope fence, data model, and remaining phases.
