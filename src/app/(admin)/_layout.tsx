import { Redirect, Stack } from 'expo-router';

import { AuthErrorScreen } from '@/components/AuthErrorScreen';
import { ScreenContainer } from '@/components/ScreenContainer';
import { LoadingState } from '@/components/States';
import { useAuth } from '@/hooks/useAuth';
import { colors } from '@/theme/tokens';

/** Guard: admins only. */
export default function AdminLayout() {
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

  if (profile.role !== 'admin') return <Redirect href="/(passenger)/home" />;

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
