import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { SessionProvider, useSession } from '@/session';
import { colors } from '@/ui';

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
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: colors.background },
        headerTintColor: colors.accent,
        headerBackButtonDisplayMode: 'minimal',
        // Read by VoiceOver (and Maestro) instead of the previous route's name, such as "(tabs)".
        headerBackTitle: 'Back',
        headerTitleStyle: { color: colors.text },
      }}>
      <Stack.Protected guard={session.status === 'signedIn'}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        {/* Each screen draws its own large title, so the header only carries the back button. */}
        <Stack.Screen name="recipe/new" options={{ title: '' }} />
        <Stack.Screen name="recipe/[id]/index" options={{ title: '' }} />
        <Stack.Screen name="recipe/[id]/edit" options={{ title: '' }} />
      </Stack.Protected>
      <Stack.Protected guard={session.status === 'signedOut'}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={__DEV__ && session.status === 'signedIn'}>
        <Stack.Screen name="dev/ui" options={{ title: 'UI gallery' }} />
      </Stack.Protected>
    </Stack>
  );
}
