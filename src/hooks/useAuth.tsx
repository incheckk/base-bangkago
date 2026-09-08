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
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setInitializing(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session: Session | null) => {
      setUser(session?.user ?? null);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) { setProfile(null); setProfileLoading(false); return; }
    setProfileLoading(true);
    setError(null);

    fetchUserDoc(user.id)
      .then((doc) => {
        setProfile(doc);
        setProfileLoading(false);
      })
      .catch((e) => {
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
