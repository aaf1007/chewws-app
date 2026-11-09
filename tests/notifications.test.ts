// Ticket 07: asking for notifications (src/notifications.ts). expo-notifications is native, so it's
// faked; the data layer is a real signed-in user's, so whether a push token was stored shows in
// the pushes their next finished Draft sends. Denied, no token is stored and saving still works.
// vi.mock calls are hoisted above the imports.
import { beforeEach, expect, test, vi } from 'vitest';

import { registerForDraftReady } from '@/notifications';

import type { DataLayer } from '../src/data';
import { FULL_RECIPE } from '../supabase/functions/_shared/draft-fixtures';
import { signInTestUser } from './harness';

const TOKEN = 'ExponentPushToken[simulatorsimulator001]';

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

beforeEach(() => {
  mocks.getPermissionsAsync.mockReset();
  mocks.requestPermissionsAsync.mockReset();
  mocks.getExpoPushTokenAsync.mockReset().mockResolvedValue({ type: 'expo', data: TOKEN });
});

/** A signed-in user, who is the app's `data` from now on. */
async function signedIn() {
  const user = await signInTestUser('n');
  app.data = user.data;
  return user;
}

/** The pushes a Draft saved and built now sends, and that it was built. */
async function saveAndBuild(user: Awaited<ReturnType<typeof signedIn>>) {
  const { recipeId } = await user.data.saveFromLink({ url: FULL_RECIPE.url });
  await user.drafts.settled();
  return { recipeId, recipe: await user.data.getRecipe(recipeId), pushes: user.drafts.pushesSent() };
}

test('the user denies the prompt after their first save: no token is stored, and saving still works', async () => {
  const user = await signedIn();
  mocks.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true, status: 'undetermined' });
  mocks.requestPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false, status: 'denied' });

  await registerForDraftReady({ ask: true });
  const { recipe, pushes } = await saveAndBuild(user);

  expect(mocks.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(mocks.getExpoPushTokenAsync).not.toHaveBeenCalled();
  expect(recipe).toMatchObject({ title: 'Creamy garlic pasta', build: { status: 'built' } });
  expect(pushes).toEqual([]);
});

test('denied before (as in every flow but 07): nothing is asked and no token is asked for', async () => {
  const user = await signedIn();
  mocks.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false, status: 'denied' });

  await registerForDraftReady({ ask: true });
  await registerForDraftReady({ ask: false });
  const { pushes } = await saveAndBuild(user);

  expect(mocks.requestPermissionsAsync).not.toHaveBeenCalled();
  expect(mocks.getExpoPushTokenAsync).not.toHaveBeenCalled();
  expect(pushes).toEqual([]);
});

test('not asked yet: a foreground or sign-in never shows the prompt; only a save does', async () => {
  await signedIn();
  mocks.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true, status: 'undetermined' });

  await registerForDraftReady({ ask: false });

  expect(mocks.requestPermissionsAsync).not.toHaveBeenCalled();
  expect(mocks.getExpoPushTokenAsync).not.toHaveBeenCalled();
});

test('allowed: the phone’s token is stored, and the next finished Draft is pushed to it', async () => {
  const user = await signedIn();
  mocks.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true, status: 'undetermined' });
  mocks.requestPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true, status: 'granted' });

  await registerForDraftReady({ ask: true });
  const { recipeId, pushes } = await saveAndBuild(user);

  expect(mocks.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'eas-project' });
  expect(pushes).toEqual([{ to: TOKEN, title: 'Draft ready', body: 'Creamy garlic pasta', data: { kind: 'draftReady', recipeId } }]);
});

test('allowed but no token to be had (the simulator): it carries on, and saving still works', async () => {
  const user = await signedIn();
  mocks.getPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true, status: 'granted' });
  mocks.getExpoPushTokenAsync.mockRejectedValue(new Error('no valid "aps-environment" entitlement'));

  await expect(registerForDraftReady({ ask: true })).resolves.toBeUndefined();
  const { recipe, pushes } = await saveAndBuild(user);

  expect(recipe).toMatchObject({ build: { status: 'built' } });
  expect(pushes).toEqual([]);
});
