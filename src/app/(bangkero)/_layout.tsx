import { Redirect, Stack } from 'expo-router';

import { AuthErrorScreen } from '@/components/AuthErrorScreen';
import { ScreenContainer } from '@/components/ScreenContainer';
import { LoadingState } from '@/components/States';
import { useAuth } from '@/hooks/useAuth';
import { colors } from '@/theme/tokens';

/** Guard: bangkeros only. Mirrors the passenger guard so the two can't drift. */
export default function BangkeroLayout() {
  const { user, profile, profileLoading, error } = useAuth();

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
