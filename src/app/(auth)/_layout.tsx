import { Redirect, Stack } from 'expo-router';

import { AuthErrorScreen } from '@/components/AuthErrorScreen';
import { useAuth } from '@/hooks/useAuth';
import { colors } from '@/theme/tokens';

/** Guard: a signed-in user with a known role never sees the auth stack again. */
export default function AuthLayout() {
  const { user, profile, error } = useAuth();

  // Signed in, but the profile read failed. Without this the sign-in screen
  // stays mounted with its spinner running on a request that already errored.
  if (user && error) return <AuthErrorScreen message={error} />;

  if (user && profile) {
    return <Redirect href={profile.role === 'bangkero' ? '/(bangkero)/home' : '/(passenger)/home'} />;
  }

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
