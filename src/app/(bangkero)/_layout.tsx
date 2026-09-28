import { Redirect, Stack } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { AuthErrorScreen } from '@/components/AuthErrorScreen';
import { ScreenContainer } from '@/components/ScreenContainer';
import { LoadingState } from '@/components/States';
import { useAuth } from '@/hooks/useAuth';
import { useLocationTracking } from '@/hooks/useLocationTracking';
import { getBangkaIdForBangkero } from '@/services/tracking.service';
import { colors } from '@/theme/tokens';

/** Guard: bangkeros only. Mirrors the passenger guard so the two can't drift. */
export default function BangkeroLayout() {
  const { user, profile, profileLoading, error } = useAuth();

  // GPS presence runs for the WHOLE bangkero area, not just home: the
  // boat must keep reporting while the operator sits on booking-status
  // or departure, or its port-queue row goes stale after 3 minutes and
  // dispatch skips it. Foreground only (see LAUNCH_DEFERRED_FEATURES B1).
  const uid = user?.id ?? null;
  const [bangkaId, setBangkaId] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!uid) return () => { alive = false; };
    getBangkaIdForBangkero(uid)
      .then((id) => { if (alive) setBangkaId(id); })
      .catch(() => {});
    return () => { alive = false; };
  }, [uid]);

  const { startTracking } = useLocationTracking(bangkaId);
  const startedRef = useRef(false);
  useEffect(() => {
    if (!bangkaId || startedRef.current) return;
    startedRef.current = true;
    void startTracking();
  }, [bangkaId, startTracking]);

  if (!user) return <Redirect href="/(auth)/welcome" />;

  if (error) return <AuthErrorScreen message={error} />;

  if (profileLoading) {
    return (
      <ScreenContainer>
        <LoadingState label="Loading your profile…" />
      </ScreenContainer>
    );
  }

  // No profile doc — hand back to "/", which owns the recovery path.
  if (!profile) return <Redirect href="/" />;

  if (profile.role === 'admin') return <Redirect href="/(admin)/home" />;
  if (profile.role !== 'bangkero') return <Redirect href="/(passenger)/home" />;

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
