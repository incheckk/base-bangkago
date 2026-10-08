import { Redirect, Stack } from 'expo-router';

import { AuthErrorScreen } from '@/components/AuthErrorScreen';
import { ScreenContainer } from '@/components/ScreenContainer';
import { LoadingState } from '@/components/States';
import { useAuth } from '@/hooks/useAuth';
import { colors } from '@/theme/tokens';

/** Guard: coastguard/LGU only (B12). Everyone else bounces to "/" which re-routes by role. */
export default function CoastguardLayout() {
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

  if (!profile) return <Redirect href="/" />;

  if (profile.role !== 'coastguard') return <Redirect href="/" />;

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
