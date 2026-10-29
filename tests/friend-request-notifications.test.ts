// Ticket 11 review: asking for notifications from Friends (src/notifications.ts). After a friend
// request sent or accepted, while notifications are undecided, the app says why in one line and,
// if the user goes on, the system asks. expo-notifications is native, so it's faked; the data
// layers are real signed-in users', so whether a push token was stored shows in the "Friend
// request" push the next request sends. vi.mock calls are hoisted above the imports.
import { beforeEach, expect, test, vi } from 'vitest';

import { askAfterFriendRequest, notificationPermission } from '@/notifications';

import type { DataLayer } from '../src/data';
import { signInWithUsername } from './harness';

const TOKEN = 'ExponentPushToken[friendsnotify0000001]';

const mocks = vi.hoisted(() => ({
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
  getExpoPushTokenAsync: vi.fn(),
}));
const app: { data: DataLayer | null } = vi.hoisted(() => ({ data: null }));

vi.mock('expo-notifications', () => ({
  setNotificationHandler: () => {},
  getPermissionsAsync: mocks.getPermissionsAsync,
  requestPermissionsAsync: mocks.requestPermissionsAsync,
  getExpoPushTokenAsync: mocks.getExpoPushTokenAsync,
}));
vi.mock('expo-constants', () => ({ default: { easConfig: { projectId: 'eas-project' } } }));
vi.mock('expo-router', () => ({ router: { push: () => {} } }));
vi.mock('react-native', () => ({ AppState: { addEventListener: () => ({ remove: () => {} }) } }));
vi.mock('@/data/app', () => ({
  get data() {
    return app.data;
  },
}));

const undecided = { granted: false, canAskAgain: true, status: 'undetermined' };
const granted = { granted: true, canAskAgain: true, status: 'granted' };
const denied = { granted: false, canAskAgain: false, status: 'denied' };

beforeEach(() => {
  mocks.getPermissionsAsync.mockReset();
  mocks.requestPermissionsAsync.mockReset();
  mocks.getExpoPushTokenAsync.mockReset().mockResolvedValue({ type: 'expo', data: TOKEN });
});

/** Alice, the app's user from now on, has sent Bob a request; and Carol, who will ask Alice next. */
async function aliceAskedBob() {
  const alice = await signInWithUsername('alice');
  const bob = await signInWithUsername('bob');
  const carol = await signInWithUsername('carol');
  app.data = alice.data;
  expect(await alice.data.sendFriendRequest(bob.userId)).toEqual({ status: 'requested' });
  return { alice, carol };
}

test('undecided: says why, then the system asks; allowed, the next request to the user is pushed to them', async () => {
  const { alice, carol } = await aliceAskedBob();
  mocks.getPermissionsAsync.mockResolvedValue(undecided);
  mocks.requestPermissionsAsync.mockResolvedValue(granted);
  const explain = vi.fn().mockResolvedValue(true);

  await askAfterFriendRequest(explain);
  await carol.data.sendFriendRequest(alice.userId);

  expect(explain).toHaveBeenCalledTimes(1);
  expect(mocks.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(carol.notifications.pushesSent()).toEqual([
    {
      to: TOKEN,
      title: 'Friend request',
      body: `@${carol.username} wants to be Friends`,
      data: { kind: 'friendRequest', fromUserId: carol.userId },
    },
  ]);
});

test('undecided, and the user says "Not now" to the reason: the system never asks, and no token is stored', async () => {
  const { alice, carol } = await aliceAskedBob();
  mocks.getPermissionsAsync.mockResolvedValue(undecided);
  const explain = vi.fn().mockResolvedValue(false);

  await askAfterFriendRequest(explain);
  await carol.data.sendFriendRequest(alice.userId);

  expect(explain).toHaveBeenCalledTimes(1);
  expect(mocks.requestPermissionsAsync).not.toHaveBeenCalled();
  expect(mocks.getExpoPushTokenAsync).not.toHaveBeenCalled();
  expect(carol.notifications.pushesSent()).toEqual([]);
});

test('already decided, allowed or denied: nothing is explained and the system is not asked', async () => {
  await aliceAskedBob();
  const explain = vi.fn().mockResolvedValue(true);

  for (const answer of [granted, denied]) {
    mocks.getPermissionsAsync.mockResolvedValue(answer);
    await askAfterFriendRequest(explain);
  }

  expect(explain).not.toHaveBeenCalled();
  expect(mocks.requestPermissionsAsync).not.toHaveBeenCalled();
});

test('the Friends screen offers "Turn on notifications" only while they are undecided', async () => {
  mocks.getPermissionsAsync.mockResolvedValueOnce(undecided).mockResolvedValueOnce(granted).mockResolvedValueOnce(denied);
  mocks.getPermissionsAsync.mockRejectedValueOnce(new Error('no native module'));

  expect(await notificationPermission()).toBe('undecided');
  expect(await notificationPermission()).toBe('allowed');
  expect(await notificationPermission()).toBe('denied');
  expect(await notificationPermission()).toBe('denied');
});
