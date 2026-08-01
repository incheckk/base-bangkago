import { Redirect } from 'expo-router';

import { AuthErrorScreen } from '@/components/AuthErrorScreen';
import { ScreenContainer } from '@/components/ScreenContainer';
import { ErrorState, LoadingState } from '@/components/States';
import { useAuth } from '@/hooks/useAuth';
import { signOut } from '@/services/auth.service';

/**
 * The only job of "/" is to answer "who is this?" and hand off. Routing on the
 * profile doc (not just the auth token) is what keeps a bangkero out of the
 * passenger stack.
 */
export default function Index() {
  const { user, profile, profileLoading, error } = useAuth();

  // _layout.tsx already held the splash until auth settled, so no session means no session.
  if (!user) return <Redirect href="/(auth)/welcome" />;

  if (error) return <AuthErrorScreen message={error} />;

  if (profileLoading) {
    return (
      <ScreenContainer>
        <LoadingState label="Loading your profile…" />
      </ScreenContainer>
    );
  }

  // Signed in but no users/ doc — a signup that half-landed. Without this the
  // app sits on a spinner forever; the only way out is to drop the session.
  if (!profile) {
    return (
      <ScreenContainer>
        <ErrorState
          message="Your account is missing its profile. Sign out and register again."
          onRetry={() => { void signOut(); }}
        />
      </ScreenContainer>
    );
  }

  return <Redirect href={profile.role === 'bangkero' ? '/(bangkero)/home' : '/(passenger)/home'} />;
}
