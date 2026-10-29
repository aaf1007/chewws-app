import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { parseDraftReadyPush, type SessionState } from '@/data';
import { data } from '@/data/app';

// "Draft ready" shows as a banner even while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/** The EAS project the app's Expo push tokens belong to (`extra.eas.projectId` in app.config.ts). */
function easProjectId(): string | undefined {
  if (Constants.easConfig?.projectId) return Constants.easConfig.projectId;
  const extra: unknown = Constants.expoConfig?.extra;
  const eas: unknown = typeof extra === 'object' && extra !== null ? Reflect.get(extra, 'eas') : null;
  const id: unknown = typeof eas === 'object' && eas !== null ? Reflect.get(eas, 'projectId') : null;
  return typeof id === 'string' ? id : undefined;
}

/**
 * Registers this phone for "Draft ready" (decisions 07), once notifications are allowed. With
 * `ask`, it asks for permission first if it hasn't been asked (after the first link saved, never at
 * launch). Denied, or no token to be had (the simulator, no signal), nothing is stored and saving
 * works as before. Never throws.
 */
export async function registerForDraftReady({ ask }: { ask: boolean }): Promise<void> {
  try {
    const current = await Notifications.getPermissionsAsync();
    const allowed =
      current.granted || (ask && current.canAskAgain && (await Notifications.requestPermissionsAsync()).granted);
    if (!allowed) return;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: easProjectId() });
    await data.registerPushToken(token);
  } catch {
    // No push token here; the app works without one.
  }
}

/**
 * While someone is signed in: registers the phone again on sign-in and each foreground (if
 * notifications are allowed), and a tapped "Draft ready" opens that Draft, whether the tap
 * started the app or came while it ran.
 */
export function useDraftReadyNotifications(session: SessionState) {
  const signedIn = session.status === 'signedIn';

  useEffect(() => {
    if (!signedIn) return;
    void registerForDraftReady({ ask: false });
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void registerForDraftReady({ ask: false });
    });
    return () => subscription.remove();
  }, [signedIn]);

  const response = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (!signedIn || !response) return;
    Notifications.clearLastNotificationResponse();
    if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const id = parseDraftReadyPush(response.notification.request.content.data);
    if (id) router.push({ pathname: '/draft/[id]', params: { id } });
  }, [signedIn, response]);
}
