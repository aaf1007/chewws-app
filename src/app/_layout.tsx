import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { SessionProvider, useSession } from '@/session';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <SessionProvider>
      <RootNavigator />
    </SessionProvider>
  );
}

function RootNavigator() {
  const session = useSession();

  useEffect(() => {
    if (session.status !== 'loading') SplashScreen.hideAsync();
  }, [session.status]);

  if (session.status === 'loading') return null;

  return (
    <Stack>
      <Stack.Protected guard={session.status === 'signedIn'}>
        <Stack.Screen name="index" options={{ title: 'Library' }} />
      </Stack.Protected>
      <Stack.Protected guard={session.status === 'signedOut'}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}
