import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../services/firebase';
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
    return onAuthStateChanged(auth, (u) => {
      if (__DEV__) console.log(`[timing] auth resolved +${Date.now() - t0}ms (user: ${u ? 'yes' : 'none'})`);
      setUser(u);
      setInitializing(false);
    });
  }, []);

  useEffect(() => {
    if (!user) { setProfile(null); setProfileLoading(false); return; }
    setProfileLoading(true);

    // First Firestore read of the session — this is what gates the redirect
    // after sign-in, so it is the number to watch if login feels slow.
    const t0 = Date.now();
    return onSnapshot(
      doc(db, 'users', user.uid),
      (snap) => {
        if (__DEV__) {
          console.log(
            `[timing] profile snapshot +${Date.now() - t0}ms ` +
            `(exists: ${snap.exists()}, from cache: ${snap.metadata.fromCache})`
          );
        }
        setProfile(snap.exists() ? (snap.data() as UserDoc) : null);
        setProfileLoading(false);
        setError(null);
      },
      (e) => {
        if (__DEV__) console.log(`[timing] profile FAILED +${Date.now() - t0}ms — ${e.code}`);
        setError(e.message);
        setProfileLoading(false);
      }
    );
  }, [user]);

  const value = useMemo(
    () => ({ user, profile, initializing, profileLoading, error }),
    [user, profile, initializing, profileLoading, error]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);