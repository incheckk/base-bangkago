import { useEffect } from 'react';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../hooks/useAuth';
import { colors } from '../theme/tokens';

// Hold the native splash until we know whether a session exists.
SplashScreen.preventAutoHideAsync().catch(() => {});

function RootStack() {
  const { initializing } = useAuth();

  useEffect(() => {
    if (!initializing) SplashScreen.hideAsync().catch(() => {});
  }, [initializing]);

  // Render nothing while restoring the session — prevents a welcome-screen flash.
  if (initializing) return null;

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

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="light" />
        <RootStack />
      </AuthProvider>
    </SafeAreaProvider>
  );
}