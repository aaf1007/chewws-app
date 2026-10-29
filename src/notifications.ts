import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { parseDraftReadyPush, parseFriendRequestPush, type SessionState } from '@/data';
import { data } from '@/data/app';

// "Draft ready" and "Friend request" show as a banner even while the app is open.
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
 * Whether the user has decided about notifications: `undecided` while the system can still ask.
 * `denied` too when it can't be told (no native module), so nothing offers to ask.
 */
export type NotificationPermission = 'undecided' | 'allowed' | 'denied';

export async function notificationPermission(): Promise<NotificationPermission> {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return 'allowed';
    return current.canAskAgain ? 'undecided' : 'denied';
  } catch {
    return 'denied';
  }
}

/**
 * After the user sends or accepts a friend request (decisions 11): while notifications are
 * undecided, `explain` gives the one-line reason (how they'll hear about friend requests) and
 * answers whether the user goes on; then the system asks, and an allowed phone is registered as
 * for "Draft ready". Once decided, it does nothing, so it asks only after the first. Never throws.
 */
export async function askAfterFriendRequest(explain: () => Promise<boolean>): Promise<void> {
  if ((await notificationPermission()) !== 'undecided') return;
  if (!(await explain().catch(() => false))) return;
  await registerForDraftReady({ ask: true });
}

/**
 * While someone is signed in: registers the phone again on sign-in and each foreground (if
 * notifications are allowed). A tapped notification opens its screen once the app can show it
 * (`canOpen`: signed in, with a username), whether the tap started the app or came while it ran:
 * "Draft ready" that Draft, "Friend request" Friends, where Requests are listed first.
 */
export function useNotifications(session: SessionState, { canOpen }: { canOpen: boolean }) {
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
    if (!canOpen || !response) return;
    Notifications.clearLastNotificationResponse();
    if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const pushed = response.notification.request.content.data;
    const draftId = parseDraftReadyPush(pushed);
    if (draftId) router.push({ pathname: '/draft/[id]', params: { id: draftId } });
    else if (parseFriendRequestPush(pushed)) router.push('/friends');
  }, [canOpen, response]);
}
