// src/services/supabase.ts
//
// AsyncStorage has a
// working web shim under Expo, so the same client config works on native
// and web without a separate persistence path.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import 'react-native-url-polyfill/auto'; // RN's URL implementation is incomplete; supabase-js needs this.

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

const FETCH_TIMEOUT_MS = 15_000;

/**
 * React Native's fetch has no timeout, so a stalled connection used to hang
 * screens on their spinner forever (the "blank screen after Create account"
 * bug). On timeout we abort and answer with a Supabase-shaped 504 so callers
 * take their normal `{ error }` path — loading=false plus a message — instead
 * of a promise that never settles.
 */
const timedFetch: typeof fetch = async (input, init) => {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, FETCH_TIMEOUT_MS);

  const upstream = init?.signal;
  if (upstream) {
    if (upstream.aborted) controller.abort();
    else upstream.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (e) {
    if (timedOut) {
      return new Response(
        JSON.stringify({
          message: `Request timed out after ${FETCH_TIMEOUT_MS / 1000} seconds.`,
          code: '504',
          details: null,
          hint: null,
        }),
        { status: 504, headers: { 'Content-Type': 'application/json' } },
      );
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: timedFetch },
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false, // no OAuth redirect flow in this app
  },
});
