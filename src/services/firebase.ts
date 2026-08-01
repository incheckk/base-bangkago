import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApps, initializeApp } from 'firebase/app';
import { browserLocalPersistence, initializeAuth, type Persistence } from 'firebase/auth';
// getReactNativePersistence ships only in the react-native build of @firebase/auth.
// The `firebase` package's ./auth export map has no react-native condition, so TS
// (and web/node bundles) resolve a build where this binding does not exist.
// @ts-expect-error — untyped outside the react-native build.
import { getReactNativePersistence } from 'firebase/auth';
import { initializeFirestore } from 'firebase/firestore';
import { Platform } from 'react-native';

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FB_API_KEY!,
  authDomain: process.env.EXPO_PUBLIC_FB_AUTH_DOMAIN!,
  projectId: process.env.EXPO_PUBLIC_FB_PROJECT_ID!,
  storageBucket: process.env.EXPO_PUBLIC_FB_STORAGE_BUCKET!,
  messagingSenderId: process.env.EXPO_PUBLIC_FB_MESSAGING_SENDER_ID!,
  appId: process.env.EXPO_PUBLIC_FB_APP_ID!,
};

export const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

// Native gets AsyncStorage so the session survives app reload — no re-typing
// credentials on stage. Web/SSR must not call getReactNativePersistence at all:
// it is undefined there, and calling it crashes the static web export at build time.
const persistence: Persistence =
  Platform.OS === 'web'
    ? browserLocalPersistence
    : (getReactNativePersistence(AsyncStorage) as Persistence);

// initializeAuth (not getAuth) — getAuth would not let us set persistence.
export const auth = initializeAuth(app, { persistence });

// autoDetectLongPolling — falls back from WebChannel on restrictive venue wifi.
export const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
});
