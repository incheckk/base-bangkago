import type { Session, User } from '@supabase/supabase-js';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { fetchUserDoc } from '../services/auth.service';
import { supabase } from '../services/supabase';
import type { UserDoc } from '../types/models';

const PROFILE_TIMEOUT_MS = 10_000;
const NULL_RETRIES = 3;
const NULL_RETRY_DELAY_MS = 500;

interface AuthState {
  user: User | null;
  profile: UserDoc | null;
  initializing: boolean;
  profileLoading: boolean;
  error: string | null;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null, profile: null, initializing: true, profileLoading: false, error: null,
  refreshProfile: async () => {},
});

/** Boot tracing — the post-signup hang was invisible without this. */
function log(...args: unknown[]) {
  if (__DEV__) console.log('[auth]', ...args);
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Bounded profile read — never spins forever.
 *
 * - A `null` row is retried briefly: sign-up creates the session first and
 *   inserts the users/ row moments later, so the very first read can miss it.
 * - A read that takes longer than PROFILE_TIMEOUT_MS rejects, which lands the
 *   guards on AuthErrorScreen (Sign out works) instead of an eternal spinner.
 */
async function fetchProfileBounded(uid: string): Promise<UserDoc | null> {
  for (let attempt = 1; attempt <= NULL_RETRIES; attempt++) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const doc = await Promise.race([
        fetchUserDoc(uid),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Loading your profile timed out. Check your connection and try again.')),
            PROFILE_TIMEOUT_MS,
          );
        }),
      ]);
      if (doc) return doc;
    } finally {
      clearTimeout(timer);
    }
    log('profile missing, retry', attempt, uid);
    if (attempt < NULL_RETRIES) await delay(NULL_RETRY_DELAY_MS);
  }
  return null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserDoc | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // refreshProfile can be called before React has committed the SIGNED_IN
  // event, so it reads the user through this ref (or the session directly).
  const userRef = useRef<User | null>(null);
  userRef.current = user;

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      log('restored session', session?.user?.id ?? 'none');
      setUser(session?.user ?? null);
      setInitializing(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session: Session | null) => {
      log('event', event, session?.user?.id ?? 'none');
      setUser(session?.user ?? null);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) { setProfile(null); setProfileLoading(false); return; }
    let cancelled = false;
    setProfileLoading(true);
    setError(null);

    fetchProfileBounded(user.id)
      .then((doc) => {
        if (cancelled) return;
        setProfile(doc);
        setProfileLoading(false);
        log('profile loaded', doc ? `role=${doc.role}` : 'missing');
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.message ?? 'Failed to load your profile.');
        setProfileLoading(false);
        log('profile error', e?.message);
      });

    return () => { cancelled = true; };
  }, [user]);

  /**
   * Re-reads the profile on demand. Called by sign-up once the users/ row has
   * been inserted — without it the guard never fires and the app sits on a
   * spinner until restart. `silent` skips the loading/error state so realtime
   * and foreground revalidations don't flash a spinner over live UI.
   */
  const revalidate = useCallback(async (silent: boolean) => {
    let uid = userRef.current?.id ?? null;
    if (!uid) {
      const { data } = await supabase.auth.getSession();
      uid = data.session?.user?.id ?? null;
    }
    if (!uid) return;

    if (!silent) {
      setProfileLoading(true);
      setError(null);
    }
    try {
      const doc = await fetchProfileBounded(uid);
      setProfile((prev) =>
        prev && doc && JSON.stringify(prev) === JSON.stringify(doc) ? prev : doc
      );
      log(silent ? 'silent profile revalidate' : 'refreshProfile', doc ? `role=${doc.role}` : 'missing');
    } catch (e) {
      const message = (e as Error)?.message ?? 'Failed to load your profile.';
      if (!silent) setError(message);
      log('refreshProfile error', message);
    } finally {
      if (!silent) setProfileLoading(false);
    }
  }, []);

  const refreshProfile = useCallback(() => revalidate(false), [revalidate]);

  // Latest revalidate for the channel/AppState callbacks below.
  const revalidateRef = useRef<() => void>(() => {});
  revalidateRef.current = () => { void revalidate(true); };

  /**
   * Live profile: name, role and suspension changes land on the users/ row —
   * subscribe to it so headers, role guards and suspended state update while
   * the screen is open. Foreground revalidation covers missed events.
   */
  useEffect(() => {
    const uid = user?.id;
    if (!uid) return;

    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase.channel(`profile-${uid}`);
      channel
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'users', filter: `id=eq.${uid}` },
          () => revalidateRef.current(),
        )
        .subscribe((status, err) => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            if (__DEV__) console.warn('[auth] profile channel →', status, err?.message ?? '');
            revalidateRef.current();
          }
        });
    } catch (e) {
      if (__DEV__) console.warn('[auth] profile channel failed', (e as Error)?.message);
    }

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') revalidateRef.current();
    });

    return () => {
      if (channel) supabase.removeChannel(channel);
      sub.remove();
    };
  }, [user?.id]);

  const value = useMemo(
    () => ({ user, profile, initializing, profileLoading, error, refreshProfile }),
    [user, profile, initializing, profileLoading, error, refreshProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
