import { router, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { ShareIntentProvider, useShareIntentContext } from 'expo-share-intent';
import { useEffect } from 'react';

import { useNotifications } from '@/notifications';
import { SessionProvider, useSession, useUsernameGate } from '@/session';
import { colors } from '@/ui';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <ShareIntentProvider>
      <SessionProvider>
        <RootNavigator />
      </SessionProvider>
    </ShareIntentProvider>
  );
}

function RootNavigator() {
  const session = useSession();
  const { gate } = useUsernameGate();
  const signedIn = session.status === 'signedIn';
  // Signed in, the app opens once it knows whether a username must be chosen first (decisions 11).
  const ready = session.status === 'signedOut' || (signedIn && gate !== 'checking');
  const inApp = signedIn && gate === 'chosen';
  useNotifications(session, { canOpen: inApp });

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  // Something shared into the app from the share sheet (a link, with any text or image) opens the
  // save screen with it, once the user is signed in, the same screen `recipeapp://save?url=…` opens.
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  useEffect(() => {
    if (!inApp || !hasShareIntent) return;
    // An image shared with the link (an Instagram Reel's screenshot) comes as a file.
    const image = shareIntent.files?.find((file) => file.mimeType.startsWith('image/'));
    router.push({
      pathname: '/save',
      params: { url: shareIntent.webUrl ?? '', text: shareIntent.text ?? '', image: image?.path ?? '' },
    });
    resetShareIntent();
  }, [inApp, hasShareIntent, shareIntent, resetShareIntent]);

  if (!ready) return null;

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
      <Stack.Protected guard={signedIn && gate === 'needed'}>
        <Stack.Screen name="choose-username" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={inApp}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        {/* Each screen draws its own large title, so the header only carries the back button. */}
        <Stack.Screen name="recipe/new" options={{ title: '' }} />
        <Stack.Screen name="recipe/[id]/index" options={{ title: '' }} />
        <Stack.Screen name="recipe/[id]/edit" options={{ title: '' }} />
        <Stack.Screen name="save" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="drafts" options={{ title: '' }} />
        <Stack.Screen name="draft/[id]" options={{ title: '' }} />
        <Stack.Screen name="friends" options={{ title: '' }} />
        <Stack.Screen name="share-shopping-list" options={{ title: '' }} />
        <Stack.Screen name="cook-plan/new" options={{ title: '' }} />
        <Stack.Screen name="cook-plan/[id]/index" options={{ title: '' }} />
        <Stack.Screen name="cook-plan/[id]/invite" options={{ title: '' }} />
        <Stack.Screen name="cook-plan/[id]/add-recipe" options={{ title: '' }} />
        <Stack.Screen name="username" options={{ title: '' }} />
      </Stack.Protected>
      <Stack.Protected guard={session.status === 'signedOut'}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={__DEV__ && inApp}>
        <Stack.Screen name="dev/ui" options={{ title: 'UI gallery' }} />
        <Stack.Screen
          name="dev/scroll"
          options={({ route }) => ({
            title: '',
            headerShown: !(
              typeof route.params === 'object' &&
              'header' in route.params &&
              route.params.header === 'none'
            ),
          })}
        />
      </Stack.Protected>
    </Stack>
  );
}
