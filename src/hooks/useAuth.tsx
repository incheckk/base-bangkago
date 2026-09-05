import type { Session, User } from '@supabase/supabase-js';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { fetchUserDoc } from '../services/auth.service';
import { supabase } from '../services/supabase';
import type { UserDoc } from '../types/models';

interface AuthState {
  user: User | null;
  profile: UserDoc | null;
  initializing: boolean;
  profileLoading: boolean;
  error: string | null;
}

const AuthContext = createContext<AuthState>({
  user: null, profile: null, initializing: true, profileLoading: false, error: null,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserDoc | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t0 = Date.now();

    // Resolves once with whatever session is already on disk (or none) —
    // this is the equivalent of Firebase's first onAuthStateChanged fire.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (__DEV__) {
        console.log(`[timing] session resolved +${Date.now() - t0}ms (user: ${session ? 'yes' : 'none'})`);
      }
      setUser(session?.user ?? null);
      setInitializing(false);
    });

    // Fires on every subsequent sign-in / sign-out / token refresh.
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session: Session | null) => {
      setUser(session?.user ?? null);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) { setProfile(null); setProfileLoading(false); return; }
    setProfileLoading(true);
    setError(null);

    // Firestore's onSnapshot gave live profile updates for free. Supabase
    // needs an explicit Realtime channel for that, which isn't set up yet —
    // this fetches once on sign-in, which covers every current use case
    // since nothing else in the app edits another user's profile mid-session.
    const t0 = Date.now();
    fetchUserDoc(user.id)
      .then((doc) => {
        if (__DEV__) console.log(`[timing] profile fetched +${Date.now() - t0}ms (exists: ${!!doc})`);
        setProfile(doc);
        setProfileLoading(false);
      })
      .catch((e) => {
        if (__DEV__) console.log(`[timing] profile FAILED +${Date.now() - t0}ms`);
        setError(e.message);
        setProfileLoading(false);
      });
  }, [user]);

  const value = useMemo(
    () => ({ user, profile, initializing, profileLoading, error }),
    [user, profile, initializing, profileLoading, error]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);