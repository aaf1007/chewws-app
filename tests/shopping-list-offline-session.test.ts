// Ticket 10: the Shopping List with no signal when the phone's access token has run out, as after
// an hour in a pocket. Refreshing it needs a signal, so the auth client has no session to give;
// the user is still signed in, and the list still works. Only a refresh the server refuses signs
// them out.
//
// With no signal, the auth client keeps retrying a refresh for about 25 seconds before it gives
// up, and then waits a minute before it tries the same refresh token again. The tests wait out
// the first, and move the clock past the second.
import { afterEach, expect, test, vi } from 'vitest';

import type { ShoppingList, ShoppingListView, SessionState } from '../src/data';
import { signInOnPhones, type TestPhone } from './harness';

const RUN_OUT_TEST_TIMEOUT_MS = 90_000;

afterEach(() => {
  vi.useRealTimers();
});

/** Time passes for every phone (and the auth clients on them). */
function passTime(ms: number) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.now() + ms);
}

const view = (list: ShoppingList) =>
  list.items.map((item) => ({
    item: item.kind === 'ingredient' ? item.ingredient.name : item.text,
    checked: item.check.status === 'checked',
  }));

function listOf(shown: ShoppingListView | undefined) {
  if (shown?.status !== 'loaded') throw new Error(`expected the list, got ${JSON.stringify(shown)}`);
  return view(shown.list);
}

/** Every view a phone's Shopping List screen would get, while watching. */
function watch(phone: TestPhone) {
  const views: ShoppingListView[] = [];
  const stop = phone.data.watchShoppingList((v) => views.push(v));
  return { last: () => views[views.length - 1], stop };
}

/** Every session state the app's screens would be told about. */
function watchSession(phone: TestPhone) {
  const states: SessionState[] = [];
  const stop = phone.data.onSessionChange((s) => states.push(s));
  return { states, last: () => states[states.length - 1], stop };
}

const signedIn = (phone: TestPhone): SessionState => ({ status: 'signedIn', userId: phone.userId });

/** Foil and Paper towels on the user's list, as every phone last saw it. */
async function foilAndTowels(phones: TestPhone[]) {
  const foil = await phones[0].data.addManualItem('Foil');
  const towels = await phones[0].data.addManualItem('Paper towels');
  for (const phone of phones) await phone.data.getShoppingList();
  return { foil, towels };
}

test(
  'the access token runs out and there is no signal: list changes still queue and show, and the user stays signed in',
  async () => {
    const [phone, other] = await signInOnPhones('shopper', 2);
    const { foil } = await foilAndTowels([phone, other]);
    const session = watchSession(phone);
    await vi.waitFor(() => expect(session.last()).toEqual(signedIn(phone)));

    phone.expireAccessToken();
    phone.goOffline();
    await phone.data.checkOff(foil);

    const screen = watch(phone);
    await vi.waitFor(() => expect(screen.last()).toMatchObject({ status: 'loaded', sync: { status: 'offline', waiting: 1 } }));
    const changed = [
      { item: 'Foil', checked: true },
      { item: 'Paper towels', checked: false },
    ];
    expect(listOf(screen.last())).toEqual(changed);
    expect(view(await phone.data.getShoppingList())).toEqual(changed);
    expect(await phone.data.getListSync()).toEqual({ status: 'offline', waiting: 1 });

    // Signal again, after a while: the session is refreshed and the change is sent.
    phone.goOnline();
    passTime(61_000);
    expect(await phone.data.syncListChanges()).toEqual({ status: 'idle', waiting: 0 });
    expect(view(await other.data.getShoppingList())).toEqual(changed);
    expect(session.states).not.toContainEqual({ status: 'signedOut' });
    expect(session.last()).toEqual(signedIn(phone));
    screen.stop();
    session.stop();
  },
  RUN_OUT_TEST_TIMEOUT_MS,
);

test(
  'opened from cold with the access token run out and no signal: still signed in, the list as last seen, and changes queue',
  async () => {
    const [phone, other] = await signInOnPhones('shopper', 2);
    const { foil, towels } = await foilAndTowels([phone, other]);
    await phone.data.checkOff(towels);
    await phone.data.getShoppingList();

    phone.goOffline();
    phone.expireAccessToken();
    const reopened = phone.relaunch();
    const session = watchSession(reopened);
    const screen = watch(reopened);

    await vi.waitFor(() => expect(screen.last()).toMatchObject({ status: 'loaded' }));
    expect(listOf(screen.last())).toEqual([
      { item: 'Foil', checked: false },
      { item: 'Paper towels', checked: true },
    ]);
    expect(session.last()).toEqual(signedIn(reopened));

    // Waits for the auth client to give up refreshing, then waits on the phone.
    await reopened.data.checkOff(foil);
    await reopened.data.uncheck(towels);
    const changed = [
      { item: 'Foil', checked: true },
      { item: 'Paper towels', checked: false },
    ];
    await vi.waitFor(() => expect(screen.last()).toMatchObject({ sync: { status: 'offline', waiting: 2 } }));
    expect(listOf(screen.last())).toEqual(changed);
    // The rest of the app needs a connection.
    await expect(reopened.data.getMyProfile()).rejects.toMatchObject({ code: 'offline' });

    reopened.goOnline();
    passTime(61_000);
    expect(await reopened.data.syncListChanges()).toEqual({ status: 'idle', waiting: 0 });
    expect(view(await other.data.getShoppingList())).toEqual(changed);
    expect(session.states).not.toContainEqual({ status: 'signedOut' });
    expect(session.last()).toEqual(signedIn(reopened));
    screen.stop();
    session.stop();
  },
  RUN_OUT_TEST_TIMEOUT_MS,
);

test('a refresh the server refuses (the session was revoked) still signs the user out, on a cold start, and throws away what the phone kept of theirs', async () => {
  const [phone, other] = await signInOnPhones('shopper', 2);
  const { foil, towels } = await foilAndTowels([phone, other]);
  phone.goOffline();
  await phone.data.checkOff(towels);
  phone.expireAccessToken();
  await phone.revokeSessions();

  phone.goOnline();
  const reopened = phone.relaunch();
  const session = watchSession(reopened);
  await vi.waitFor(() => expect(session.last()).toEqual({ status: 'signedOut' }));
  expect([...reopened.saved().keys()]).toEqual([]);
  await expect(reopened.data.checkOff(foil)).rejects.toMatchObject({ code: 'not_signed_in' });
  await expect(reopened.data.getShoppingList()).rejects.toMatchObject({ code: 'not_signed_in' });

  await reopened.data.signInWithPassword(phone.account);
  expect(await reopened.data.syncListChanges()).toEqual({ status: 'idle', waiting: 0 });
  expect(view(await other.data.getShoppingList())).toEqual([
    { item: 'Foil', checked: false },
    { item: 'Paper towels', checked: false },
  ]);
});

test('a refresh the server refuses signs the user out and throws away their list changes still waiting and the list last seen: signed in again, nothing old is sent', async () => {
  const [phone, other] = await signInOnPhones('shopper', 2);
  const { foil } = await foilAndTowels([phone, other]);
  phone.goOffline();
  await phone.data.checkOff(foil);
  const session = watchSession(phone);
  await vi.waitFor(() => expect(session.last()).toEqual(signedIn(phone)));
  phone.expireAccessToken();
  await phone.revokeSessions();

  phone.goOnline();
  await phone.data.syncListChanges();
  await vi.waitFor(() => expect(session.last()).toEqual({ status: 'signedOut' }));
  expect([...phone.saved().keys()]).toEqual([]);

  // Days later, after a restart, the user signs in again.
  const reopened = phone.relaunch();
  await reopened.data.signInWithPassword(phone.account);
  expect(await reopened.data.getListSync()).toEqual({ status: 'idle', waiting: 0 });
  expect(await reopened.data.syncListChanges()).toEqual({ status: 'idle', waiting: 0 });
  const unchanged = [
    { item: 'Foil', checked: false },
    { item: 'Paper towels', checked: false },
  ];
  expect(view(await reopened.data.getShoppingList())).toEqual(unchanged);
  expect(view(await other.data.getShoppingList())).toEqual(unchanged);
  session.stop();
});

test('a refresh the server refuses still signs the user out, with the app open', async () => {
  const [phone] = await signInOnPhones('shopper', 1);
  const { foil } = await foilAndTowels([phone]);
  const session = watchSession(phone);
  await vi.waitFor(() => expect(session.last()).toEqual(signedIn(phone)));
  phone.expireAccessToken();
  await phone.revokeSessions();

  await phone.data.syncListChanges();
  await phone.data.getShoppingList().catch(() => {});
  await vi.waitFor(() => expect(session.last()).toEqual({ status: 'signedOut' }));
  await expect(phone.data.checkOff(foil)).rejects.toMatchObject({ code: 'not_signed_in' });
  await expect(phone.data.getShoppingList()).rejects.toMatchObject({ code: 'not_signed_in' });
});

const signedOut: SessionState = { status: 'signedOut' };

/** How long signing out may take: no waiting on a refresh that can't happen. */
const SIGN_OUT_MS = 2_000;

test('signing out with no signal and the access token run out signs out at once, and stays signed out after a cold start, offline then online', async () => {
  const [phone, other] = await signInOnPhones('shopper', 2);
  const { foil } = await foilAndTowels([phone, other]);
  const session = watchSession(phone);
  await vi.waitFor(() => expect(session.last()).toEqual(signedIn(phone)));
  phone.expireAccessToken();
  phone.goOffline();

  const started = Date.now();
  await phone.data.signOut();
  expect(Date.now() - started).toBeLessThan(SIGN_OUT_MS);
  expect(session.last()).toEqual(signedOut);
  await expect(phone.data.checkOff(foil)).rejects.toMatchObject({ code: 'not_signed_in' });
  await expect(phone.data.getShoppingList()).rejects.toMatchObject({ code: 'not_signed_in' });

  const offline = phone.relaunch();
  const offlineSession = watchSession(offline);
  await vi.waitFor(() => expect(offlineSession.last()).toEqual(signedOut));
  await expect(offline.data.getShoppingList()).rejects.toMatchObject({ code: 'not_signed_in' });

  offline.goOnline();
  const online = offline.relaunch();
  const onlineSession = watchSession(online);
  await vi.waitFor(() => expect(onlineSession.last()).toEqual(signedOut));
  await expect(online.data.getMyProfile()).rejects.toMatchObject({ code: 'not_signed_in' });
  await expect(online.data.getShoppingList()).rejects.toMatchObject({ code: 'not_signed_in' });
  expect([...session.states, ...offlineSession.states, ...onlineSession.states]).toEqual([
    signedIn(phone),
    signedOut,
    signedOut,
    signedOut,
  ]);
  session.stop();
  offlineSession.stop();
  onlineSession.stop();
}, RUN_OUT_TEST_TIMEOUT_MS);

test('list changes still waiting when the user signs out are discarded: never sent, as them or as whoever signs in next', async () => {
  const [phone, other] = await signInOnPhones('shopper', 2);
  const [next] = await signInOnPhones('next', 1);
  const { foil, towels } = await foilAndTowels([phone, other]);
  phone.goOffline();
  await phone.data.checkOff(foil);
  await phone.data.addManualItem('Snacks');
  expect(await phone.data.syncListChanges()).toEqual({ status: 'offline', waiting: 2 });
  await phone.data.signOut();

  // Someone else signs in on this phone, with a signal: only their own (empty) list syncs.
  phone.goOnline();
  expect(await phone.data.signInWithPassword(next.account)).toEqual(next.userId);
  expect(await phone.data.syncListChanges()).toEqual({ status: 'idle', waiting: 0 });
  expect((await phone.data.getShoppingList()).items).toEqual([]);
  await phone.data.signOut();

  // The user again, after a restart: nothing of theirs is waiting, and the server never had it.
  const reopened = phone.relaunch();
  await reopened.data.signInWithPassword(phone.account);
  expect(await reopened.data.getListSync()).toEqual({ status: 'idle', waiting: 0 });
  expect(await reopened.data.syncListChanges()).toEqual({ status: 'idle', waiting: 0 });
  const unchanged = [
    { item: 'Foil', checked: false },
    { item: 'Paper towels', checked: false },
  ];
  expect(view(await reopened.data.getShoppingList())).toEqual(unchanged);
  expect(view(await other.data.getShoppingList())).toEqual(unchanged);
  expect((await next.data.getShoppingList()).items).toEqual([]);
  await other.data.checkOff(towels);
  expect(view(await reopened.data.getShoppingList())).toEqual([
    { item: 'Foil', checked: false },
    { item: 'Paper towels', checked: true },
  ]);
});

test("signing out with a signal ends this phone's session on the server too; the user's other phones stay signed in", async () => {
  const [phone, other] = await signInOnPhones('shopper', 2);
  await foilAndTowels([phone, other]);
  const before = phone.savedAuth();

  const started = Date.now();
  await phone.data.signOut();
  expect(Date.now() - started).toBeLessThan(SIGN_OUT_MS);

  // The session the phone held can't be refreshed any more, even by a copy of it.
  const copy = phone.relaunch(undefined, before);
  copy.expireAccessToken();
  const copySession = watchSession(copy);
  await vi.waitFor(() => expect(copySession.last()).toEqual(signedOut));

  // The other phone's session still refreshes.
  other.expireAccessToken();
  const reopened = other.relaunch();
  const otherSession = watchSession(reopened);
  await vi.waitFor(() => expect(otherSession.last()).toEqual(signedIn(other)));
  expect((await reopened.data.getMyProfile()).id).toEqual(other.userId);
  copySession.stop();
  otherSession.stop();
});

/**
 * Started with no signal and the access token run out, the app's auth client retries refreshing it
 * for about 25 seconds, waiting longer each time (0.2 s, 0.4 s, 0.8 s…). With a signal back 2
 * seconds in, its next retry, about 3 seconds in, gets through; this is comfortably after that.
 */
const STARTUP_REFRESH_DONE_MS = 6_000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test.each(['someone else', 'the same user'] as const)(
  'signed out while the app was still starting with no signal and the access token run out, then %s signs in once there is a signal: they stay signed in, and their session still works',
  async (who) => {
    const [phone] = await signInOnPhones('shopper', 1, { autoRefreshToken: true });
    const [next] = await signInOnPhones('next', 1);
    const { account, userId } = who === 'someone else' ? next : phone;
    phone.expireAccessToken();
    phone.goOffline();
    const started = phone.relaunch();
    const session = watchSession(started);
    await vi.waitFor(() => expect(session.last()).toEqual(signedIn(phone)));
    // The app shows the user signed out as soon as the phone says so, without waiting for more.
    const signingOut = started.data.signOut();
    await vi.waitFor(() => expect(session.last()).toEqual(signedOut));

    // The auth client is still trying to refresh the session it started with.
    await wait(2_000);
    started.goOnline();
    expect(await started.data.signInWithPassword(account)).toEqual(userId);
    await wait(STARTUP_REFRESH_DONE_MS);
    await signingOut;
    expect(session.last()).toEqual({ status: 'signedIn', userId });
    expect((await started.data.getMyProfile()).id).toEqual(userId);

    // Their session wasn't ended on the server: opened again with its access token run out, the
    // app refreshes it.
    started.expireAccessToken();
    const reopened = started.relaunch();
    const reopenedSession = watchSession(reopened);
    expect((await reopened.data.getMyProfile()).id).toEqual(userId);
    expect(reopenedSession.states).toEqual([{ status: 'signedIn', userId }]);
    session.stop();
    reopenedSession.stop();
  },
  RUN_OUT_TEST_TIMEOUT_MS,
);

test(
  'signed out while a list change waits for a refresh with no signal, then the same user signs in again once there is a signal: the change is never sent',
  async () => {
    const [phone, other] = await signInOnPhones('shopper', 2);
    const { foil } = await foilAndTowels([phone, other]);
    phone.goOffline();
    await phone.data.checkOff(foil);
    phone.expireAccessToken();

    // Sending it first refreshes the session, which with no signal retries for about 25 seconds.
    const syncing = phone.data.syncListChanges();
    await wait(300);
    await phone.data.signOut();

    phone.goOnline();
    expect(await phone.data.signInWithPassword(phone.account)).toEqual(phone.userId);
    await syncing;
    expect(await phone.data.syncListChanges()).toEqual({ status: 'idle', waiting: 0 });
    const unchanged = [
      { item: 'Foil', checked: false },
      { item: 'Paper towels', checked: false },
    ];
    expect(view(await other.data.getShoppingList())).toEqual(unchanged);
    expect(view(await phone.data.getShoppingList())).toEqual(unchanged);
  },
  RUN_OUT_TEST_TIMEOUT_MS,
);

test(
  'signed out while a refresh retries with no signal, and the signal comes back just then: the late refresh never signs the user back in',
  async () => {
    const [phone, other] = await signInOnPhones('shopper', 2);
    const { foil } = await foilAndTowels([phone, other]);
    phone.goOffline();
    await phone.data.checkOff(foil);
    phone.expireAccessToken();
    const session = watchSession(phone);
    await vi.waitFor(() => expect(session.last()).toEqual(signedIn(phone)));

    // Sending it first refreshes the session, which with no signal retries for about 25 seconds.
    const syncing = phone.data.syncListChanges();
    await wait(300);
    // With a signal again the refresh gets through, and a new refresh token with it. The user
    // signs out while the auth client is still reading what it saved, so it saves that refresh
    // after the sign-out and reports it as the same session, refreshed.
    const read = phone.slowNextSessionRead();
    phone.goOnline();
    await read.reached;
    await phone.data.signOut();
    read.release();
    await syncing;
    expect(session.states).toEqual([signedIn(phone), signedOut]);
    // The late refresh wasn't saved on the phone: nothing works as the user, now or after a restart.
    expect([...phone.savedAuth().keys()]).toEqual([]);
    await expect(phone.data.getShoppingList()).rejects.toMatchObject({ code: 'not_signed_in' });
    const reopened = phone.relaunch();
    const reopenedSession = watchSession(reopened);
    await vi.waitFor(() => expect(reopenedSession.last()).toEqual(signedOut));
    await expect(reopened.data.getShoppingList()).rejects.toMatchObject({ code: 'not_signed_in' });
    await expect(reopened.data.getMyProfile()).rejects.toMatchObject({ code: 'not_signed_in' });
    expect(reopenedSession.states).toEqual([signedOut]);
    session.stop();
    reopenedSession.stop();
  },
  RUN_OUT_TEST_TIMEOUT_MS,
);

/** How long the app takes to settle who is signed in after a cold start with no signal, at most. */
const COLD_START_SETTLED_MS = 40_000;

test.each(['kept', 'none'] as const)(
  'opened from cold with no signal and the access token run out, no user remembered on the phone (signed in on an older version), and a session %s: signed in as its user with the list as last seen, or signed out; never left loading',
  async (session) => {
    const [phone, other] = await signInOnPhones('shopper', 2);
    await foilAndTowels([phone, other]);
    phone.goOffline();
    phone.expireAccessToken();
    const saved = new Map(phone.saved());
    saved.delete('recipeapp.signedInUser');
    const reopened = phone.relaunch(saved, session === 'kept' ? undefined : new Map());
    const states = watchSession(reopened);
    await vi.waitFor(() => expect(states.last()).toBeDefined(), { timeout: COLD_START_SETTLED_MS });

    if (session === 'none') {
      expect(states.states).toEqual([signedOut]);
      await expect(reopened.data.getShoppingList()).rejects.toMatchObject({ code: 'not_signed_in' });
      states.stop();
      return;
    }
    expect(states.states).toEqual([signedIn(reopened)]);
    const screen = watch(reopened);
    await vi.waitFor(() => expect(screen.last()).toMatchObject({ status: 'loaded' }));
    expect(listOf(screen.last())).toEqual([
      { item: 'Foil', checked: false },
      { item: 'Paper towels', checked: false },
    ]);
    // Once the auth client gives up refreshing, the user is still signed in.
    await wait(STARTUP_REFRESH_DONE_MS);
    await reopened.data.syncListChanges();
    expect(states.states).toEqual([signedIn(reopened)]);
    screen.stop();
    states.stop();
  },
  RUN_OUT_TEST_TIMEOUT_MS,
);

const REFRESH = 'grant_type=refresh_token';

/**
 * The auth server refusing a refresh, as it answers one (API version 2024-01-01). Whatever the
 * code, a JSON answer of 400, 401 or 403 from the auth server ends the session.
 */
const REFRESH_REFUSALS = [
  ['refresh_token_not_found', { code: 'refresh_token_not_found', message: 'Invalid Refresh Token: Refresh Token Not Found' }],
  ['user_banned', { code: 'user_banned', message: 'Invalid Refresh Token: User Banned' }],
  ['validation_failed', { code: 'validation_failed', message: 'refresh_token required' }],
] as const;

test.each(REFRESH_REFUSALS)(
  'the server refuses the session while list changes wait (every request answers 401, its refresh 400 %s): the user is signed out, never left offline',
  async (_, refusal) => {
    const [phone, other] = await signInOnPhones('shopper', 2);
    const { foil } = await foilAndTowels([phone, other]);
    const session = watchSession(phone);
    await vi.waitFor(() => expect(session.last()).toEqual(signedIn(phone)));
    phone.goOffline();
    await phone.data.checkOff(foil);

    phone.goOnline();
    phone.serverAnswers(401);
    phone.serverAnswersFor(REFRESH, 400, refusal);
    await phone.data.syncListChanges();
    await vi.waitFor(() => expect(session.last()).toEqual(signedOut));
    expect([...phone.saved().keys()]).toEqual([]);
    expect([...phone.savedAuth().keys()]).toEqual([]);
    await expect(phone.data.getListSync()).rejects.toMatchObject({ code: 'not_signed_in' });

    phone.serverAnswers(null);
    expect(view(await other.data.getShoppingList())).toEqual([
      { item: 'Foil', checked: false },
      { item: 'Paper towels', checked: false },
    ]);
    session.stop();
  },
);

test("the server answers an item's changes with 401 even after the session is refreshed: retried with backoff like a server error, then given up and the user told", async () => {
  const [phone, other] = await signInOnPhones('shopper', 2);
  const { foil, towels } = await foilAndTowels([phone, other]);
  const session = watchSession(phone);
  phone.goOffline();
  await phone.data.checkOff(foil);
  await phone.data.checkOff(towels);

  phone.goOnline();
  phone.serverAnswersFor(foil, 401);
  const t0 = Date.now();
  phone.setClock(new Date(t0));
  const retryingAt = (at: number) => ({ status: 'waitingToRetry', waiting: 2, retryAt: new Date(t0 + at * 1000).toISOString() });
  expect(await phone.data.syncListChanges()).toEqual(retryingAt(10));
  for (const [at, next] of [
    [10, 40],
    [40, 100],
    [100, 400],
    [400, 1300],
  ]) {
    phone.setClock(new Date(t0 + at * 1000));
    expect(await phone.data.syncListChanges()).toEqual(retryingAt(next));
  }
  phone.setClock(new Date(t0 + 1300 * 1000));
  expect(await phone.data.syncListChanges()).toEqual({ status: 'idle', waiting: 0 });

  const expected = [
    { item: 'Foil', checked: false },
    { item: 'Paper towels', checked: true },
  ];
  expect(view(await other.data.getShoppingList())).toEqual(expected);
  const screen = watch(phone);
  await vi.waitFor(() =>
    expect(screen.last()).toMatchObject({ status: 'loaded', notSaved: [{ kind: 'checkOff', itemName: 'Foil' }] }),
  );
  expect(listOf(screen.last())).toEqual(expected);
  expect(session.states).toEqual([signedIn(phone)]);
  screen.stop();
  session.stop();
});

test.each([
  ['rate limited by the auth server (429)', 429, { code: 'over_request_rate_limit', message: 'Request rate limit reached' }],
  ['timed out at a gateway (408, plain text)', 408, undefined],
  ['refused by a proxy (403, not JSON)', 403, undefined],
] as const)(
  'a 401 whose refresh is %s is no answer about the session: the user stays signed in with their changes waiting',
  async (_, status, json) => {
    const [phone, other] = await signInOnPhones('shopper', 2);
    const { foil } = await foilAndTowels([phone, other]);
    const session = watchSession(phone);
    await vi.waitFor(() => expect(session.last()).toEqual(signedIn(phone)));
    phone.goOffline();
    await phone.data.checkOff(foil);

    phone.goOnline();
    phone.serverAnswers(401);
    phone.serverAnswersFor(REFRESH, status, json);
    expect(await phone.data.syncListChanges()).toEqual({ status: 'offline', waiting: 1 });
    expect(session.states).toEqual([signedIn(phone)]);
    expect([...phone.savedAuth().keys()]).not.toEqual([]);

    phone.serverAnswers(null);
    phone.serverAnswersFor(REFRESH, null);
    expect(await phone.data.syncListChanges()).toEqual({ status: 'idle', waiting: 0 });
    expect(view(await other.data.getShoppingList())).toEqual([
      { item: 'Foil', checked: true },
      { item: 'Paper towels', checked: false },
    ]);
    expect(session.states).toEqual([signedIn(phone)]);
    session.stop();
  },
);

test.each([
  ['rate limited by the auth server (429)', 429, { code: 'over_request_rate_limit', message: 'Request rate limit reached' }],
  ['timed out at a gateway (408, plain text)', 408, undefined],
  ['refused by a proxy (403, not JSON)', 403, undefined],
] as const)(
  'opened from cold with the access token run out, its refresh %s: still signed in, with the changes still waiting sent once the auth server answers',
  async (_, status, json) => {
    const [phone, other] = await signInOnPhones('shopper', 2);
    const { foil } = await foilAndTowels([phone, other]);
    phone.goOffline();
    await phone.data.checkOff(foil);
    phone.expireAccessToken();

    const reopened = phone.relaunch();
    reopened.goOnline();
    reopened.serverAnswersFor(REFRESH, status, json);
    const session = watchSession(reopened);
    // Waits on the auth client, which answers once it has tried the refresh.
    expect(await reopened.data.syncListChanges()).toEqual({ status: 'offline', waiting: 1 });
    expect([...reopened.savedAuth().keys()]).not.toEqual([]);
    expect(session.states).toEqual([signedIn(reopened)]);

    reopened.serverAnswersFor(REFRESH, null);
    passTime(61_000);
    expect(await reopened.data.syncListChanges()).toEqual({ status: 'idle', waiting: 0 });
    expect(view(await other.data.getShoppingList())).toEqual([
      { item: 'Foil', checked: true },
      { item: 'Paper towels', checked: false },
    ]);
    expect(session.states).toEqual([signedIn(reopened)]);
    session.stop();
  },
);

test.each(REFRESH_REFUSALS)(
  'opened from cold with the access token run out, its refresh refused (400 %s): signed out, the changes still waiting thrown away',
  async (_, refusal) => {
    const [phone, other] = await signInOnPhones('shopper', 2);
    const { foil } = await foilAndTowels([phone, other]);
    phone.goOffline();
    await phone.data.checkOff(foil);
    phone.expireAccessToken();

    const reopened = phone.relaunch();
    reopened.goOnline();
    reopened.serverAnswersFor(REFRESH, 400, refusal);
    const session = watchSession(reopened);
    await vi.waitFor(() => expect(session.last()).toEqual(signedOut));
    expect([...reopened.saved().keys()]).toEqual([]);
    expect([...reopened.savedAuth().keys()]).toEqual([]);
    await expect(reopened.data.getListSync()).rejects.toMatchObject({ code: 'not_signed_in' });

    reopened.serverAnswersFor(REFRESH, null);
    expect(view(await other.data.getShoppingList())).toEqual([
      { item: 'Foil', checked: false },
      { item: 'Paper towels', checked: false },
    ]);
    session.stop();
  },
);
