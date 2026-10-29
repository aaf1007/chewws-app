// Ticket 11: usernames and Friends (decisions 11), through the data layer as real signed-in users.
// The "Friend request" push runs in-process through the recording push sender: no network.
import { expect, test } from 'vitest';

import { parseFriendRequestPush, type FoundUser, type UserId } from '../src/data';
import {
  backdateFriendRequestPushes,
  holdFriendRequest,
  holdFriendRequestAnswer,
  holdFriendRequestCancel,
  holdUnfriend,
  holdUsernameChoice,
  signInTestUser,
  signInWithUsername,
  uniqueUsername,
  type TestUser,
} from './harness';

const TOKEN_B = 'ExponentPushToken[friendsbbbbbbbbbbbbbb]';

const friendRequestPush = (to: string, username: string, fromUserId: UserId) => ({
  to,
  title: 'Friend request',
  body: `@${username} wants to be Friends`,
  data: { kind: 'friendRequest', fromUserId },
});

/** What `user` sees of their Friends and requests, by username. */
async function seenBy(user: Pick<TestUser, 'data'>) {
  const [friends, requests] = await Promise.all([user.data.listFriends(), user.data.listFriendRequests()]);
  return {
    friends: friends.map((f) => f.username),
    incoming: requests.incoming.map((r) => r.username),
    outgoing: requests.outgoing.map((r) => r.username),
  };
}

const nothing = { friends: [], incoming: [], outgoing: [] };

/** What a search for exactly `username` shows `user` about them. */
async function found(user: Pick<TestUser, 'data'>, username: string): Promise<FoundUser | undefined> {
  return (await user.data.searchUsers(username)).find((u) => u.username === username);
}

// Usernames

test('a new user has no username and must choose one; then the app stops asking', async () => {
  const a = await signInTestUser('a');
  expect((await a.data.getMyProfile()).username).toBeNull();
  expect(await a.data.needsUsername()).toBe(true);

  const wanted = uniqueUsername('rosa');
  const result = await a.data.setUsername(`  @${wanted.toUpperCase()} `);

  expect(result).toEqual({ status: 'set', username: wanted });
  expect((await a.data.getMyProfile()).username).toBe(wanted);
  expect(await a.data.needsUsername()).toBe(false);
});

test('a username someone has is refused as taken, whatever its case; reserved names likewise; bad ones as invalid', async () => {
  const a = await signInWithUsername('a');
  const b = await signInTestUser('b');

  expect(await b.data.setUsername(a.username.toUpperCase())).toEqual({ status: 'taken' });
  expect(await b.data.setUsername(`@${a.username}`)).toEqual({ status: 'taken' });
  expect(await b.data.setUsername('Admin')).toEqual({ status: 'reserved' });
  expect(await b.data.setUsername('recipeapp_help')).toEqual({ status: 'reserved' });
  expect(await b.data.setUsername('me')).toEqual({ status: 'invalid' });
  expect(await b.data.setUsername('crème_brûlée')).toEqual({ status: 'invalid' });
  expect(await b.data.setUsername("o'brien")).toEqual({ status: 'invalid' });
  expect(await b.data.setUsername('')).toEqual({ status: 'invalid' });
  expect((await b.data.getMyProfile()).username).toBeNull();
  expect(await b.data.needsUsername()).toBe(true);
});

test('a username can be changed later, and the old one is free for anyone at once', async () => {
  const a = await signInWithUsername('a');
  const b = await signInTestUser('b');
  const old = a.username;
  const renamed = uniqueUsername('renamed');

  expect(await a.data.setUsername(renamed)).toEqual({ status: 'set', username: renamed });
  expect(await a.data.setUsername(renamed)).toEqual({ status: 'set', username: renamed });
  expect(await b.data.setUsername(old)).toEqual({ status: 'set', username: old });

  expect((await a.data.getMyProfile()).username).toBe(renamed);
  expect((await b.data.getMyProfile()).username).toBe(old);
});

test('a name chosen while someone else is choosing it waits for them, and is taken', async () => {
  const a = await signInTestUser('a');
  const b = await signInTestUser('b');
  const wanted = uniqueUsername('race');
  const held = await holdUsernameChoice(a, wanted); // a's choice, not committed yet

  const choosing = b.data.setUsername(wanted);
  await held.waitForWaiting(1);
  await held.commit();

  expect(await choosing).toEqual({ status: 'taken' });
  expect((await a.data.getMyProfile()).username).toBe(wanted);
  expect((await b.data.getMyProfile()).username).toBeNull();
});

test('one user choosing the same name on two phones at once gets it both times', async () => {
  const a = await signInTestUser('a');
  const wanted = uniqueUsername('twice');
  const held = await holdUsernameChoice(a, wanted);

  const choosing = a.data.setUsername(wanted);
  await held.waitForWaiting(1);
  await held.commit();

  expect(await choosing).toEqual({ status: 'set', username: wanted });
  expect((await a.data.getMyProfile()).username).toBe(wanted);
});

// Search

test('username search finds users whose username starts with it, exact match first, then by name', async () => {
  const searcher = await signInWithUsername('searcher');
  const stem = uniqueUsername('s').slice(0, 12);
  const named = async (name: string) => {
    const user = await signInTestUser('named');
    expect(await user.data.setUsername(name)).toMatchObject({ status: 'set' });
    return user;
  };
  const exact = await named(stem);
  const zed = await named(`${stem}_zed`);
  const amy = await named(`${stem}_amy`);
  await signInTestUser('no-username');

  expect(await searcher.data.searchUsers(`  @${stem.toUpperCase()}`)).toEqual([
    { id: exact.userId, username: stem, relationship: 'none' },
    { id: amy.userId, username: `${stem}_amy`, relationship: 'none' },
    { id: zed.userId, username: `${stem}_zed`, relationship: 'none' },
  ]);
  expect(await searcher.data.searchUsers(`${stem}_a`)).toEqual([
    { id: amy.userId, username: `${stem}_amy`, relationship: 'none' },
  ]);
});

test('search needs 3 characters, never finds you, takes _ literally, and shows at most 10', async () => {
  const me = await signInWithUsername('me');
  const stem = uniqueUsername('t').slice(0, 11);
  for (let i = 0; i < 11; i += 1) {
    const user = await signInTestUser('many');
    await user.data.setUsername(`${stem}${String(i).padStart(2, '0')}`);
  }

  expect(await me.data.searchUsers('ab')).toEqual([]);
  expect(await me.data.searchUsers('  ')).toEqual([]);
  expect(await me.data.searchUsers("o'b")).toEqual([]);
  expect(await me.data.searchUsers(me.username)).toEqual([]);
  // `_` matches only an underscore, not any character.
  expect(await me.data.searchUsers(`${stem.slice(0, 1)}x${stem.slice(2)}`)).toEqual([]);
  const results = await me.data.searchUsers(stem);
  expect(results.map((r) => r.username)).toEqual(
    Array.from({ length: 10 }, (_, i) => `${stem}${String(i).padStart(2, '0')}`),
  );
});

// Requests and Friendships

test('a friend request sends the recipient a push; it makes no Friendship until accepted', async () => {
  const a = await signInWithUsername('alice');
  const b = await signInWithUsername('bob');
  await b.data.registerPushToken(TOKEN_B);

  expect(await a.data.sendFriendRequest(b.userId)).toEqual({ status: 'requested' });

  expect(a.notifications.pushesSent()).toEqual([friendRequestPush(TOKEN_B, a.username, a.userId)]);
  expect(parseFriendRequestPush(a.notifications.pushesSent()[0].data)).toBe(a.userId);
  expect(await seenBy(a)).toEqual({ friends: [], incoming: [], outgoing: [b.username] });
  expect(await seenBy(b)).toEqual({ friends: [], incoming: [a.username], outgoing: [] });
  expect(await found(a, b.username)).toEqual({ id: b.userId, username: b.username, relationship: 'requestSent' });
  expect(await found(b, a.username)).toEqual({ id: a.userId, username: a.username, relationship: 'requestReceived' });
});

test('after accepting, both see each other as Friends; accepting sends no push', async () => {
  const a = await signInWithUsername('alice');
  const b = await signInWithUsername('bob');
  await a.data.registerPushToken('ExponentPushToken[friendsaaaaaaaaaaaaaa]');
  await a.data.sendFriendRequest(b.userId);

  expect(await b.data.respondToFriendRequest(a.userId, true)).toEqual({ status: 'accepted' });

  expect(await seenBy(a)).toEqual({ friends: [b.username], incoming: [], outgoing: [] });
  expect(await seenBy(b)).toEqual({ friends: [a.username], incoming: [], outgoing: [] });
  expect(await found(a, b.username)).toMatchObject({ relationship: 'friends' });
  expect(await found(b, a.username)).toMatchObject({ relationship: 'friends' });
  expect(b.notifications.pushesSent()).toEqual([]);
  expect(a.notifications.pushesSent()).toEqual([]);
  const [friend] = await a.data.listFriends();
  expect(Date.now() - Date.parse(friend.friendsSince)).toBeLessThan(60_000);
});

test('a declined request makes no Friendship; the requester still sees it as sent, and asking again changes nothing', async () => {
  const a = await signInWithUsername('alice');
  const b = await signInWithUsername('bob');
  await b.data.registerPushToken(TOKEN_B);
  await a.data.sendFriendRequest(b.userId);

  expect(await b.data.respondToFriendRequest(a.userId, false)).toEqual({ status: 'declined' });

  expect(await seenBy(b)).toEqual(nothing);
  expect(await seenBy(a)).toEqual({ friends: [], incoming: [], outgoing: [b.username] });
  expect(await found(a, b.username)).toMatchObject({ relationship: 'requestSent' });
  expect(await found(b, a.username)).toMatchObject({ relationship: 'none' });
  expect(await a.data.sendFriendRequest(b.userId)).toEqual({ status: 'requested' });
  expect(a.notifications.pushesSent()).toHaveLength(1);
  expect(await seenBy(b)).toEqual(nothing);
});

test('unfriending removes the Friendship both ways; either can ask again', async () => {
  const a = await signInWithUsername('alice');
  const b = await signInWithUsername('bob');
  await a.data.sendFriendRequest(b.userId);
  await b.data.respondToFriendRequest(a.userId, true);

  await b.data.unfriend(a.userId);

  expect(await seenBy(a)).toEqual(nothing);
  expect(await seenBy(b)).toEqual(nothing);
  expect(await found(a, b.username)).toMatchObject({ relationship: 'none' });
  expect(await a.data.getProfile(b.userId)).toBeNull();
  await b.data.unfriend(a.userId);
  expect(await b.data.sendFriendRequest(a.userId)).toEqual({ status: 'requested' });
  expect(await seenBy(a)).toEqual({ friends: [], incoming: [b.username], outgoing: [] });
});

test('asking someone who already asked you makes you Friends at once', async () => {
  const a = await signInWithUsername('alice');
  const b = await signInWithUsername('bob');
  await a.data.sendFriendRequest(b.userId);

  expect(await b.data.sendFriendRequest(a.userId)).toEqual({ status: 'accepted' });
  expect(await a.data.sendFriendRequest(b.userId)).toEqual({ status: 'alreadyFriends' });

  expect(await seenBy(a)).toEqual({ friends: [b.username], incoming: [], outgoing: [] });
  expect(await seenBy(b)).toEqual({ friends: [a.username], incoming: [], outgoing: [] });
});

test('asking someone whose request you declined sends them a fresh request of yours', async () => {
  const a = await signInWithUsername('alice');
  const b = await signInWithUsername('bob');
  await a.data.sendFriendRequest(b.userId);
  await b.data.respondToFriendRequest(a.userId, false);

  expect(await b.data.sendFriendRequest(a.userId)).toEqual({ status: 'requested' });

  expect(await seenBy(a)).toEqual({ friends: [], incoming: [b.username], outgoing: [] });
  expect(await seenBy(b)).toEqual({ friends: [], incoming: [], outgoing: [a.username] });
});

test('cancelling withdraws a request, pending or declined; a new one sends no second push within 7 days', async () => {
  const a = await signInWithUsername('alice');
  const b = await signInWithUsername('bob');
  await b.data.registerPushToken(TOKEN_B);
  await a.data.sendFriendRequest(b.userId);

  await a.data.cancelFriendRequest(b.userId);
  expect(await seenBy(a)).toEqual(nothing);
  expect(await seenBy(b)).toEqual(nothing);

  expect(await a.data.sendFriendRequest(b.userId)).toEqual({ status: 'requested' });
  expect(await seenBy(b)).toEqual({ friends: [], incoming: [a.username], outgoing: [] });
  expect(a.notifications.pushesSent()).toHaveLength(1);

  await b.data.respondToFriendRequest(a.userId, false);
  await a.data.cancelFriendRequest(b.userId);
  expect(await seenBy(a)).toEqual(nothing);

  // A week on, a new request is pushed again.
  await backdateFriendRequestPushes(a, b, 8);
  expect(await a.data.sendFriendRequest(b.userId)).toEqual({ status: 'requested' });
  expect(a.notifications.pushesSent()).toEqual([
    friendRequestPush(TOKEN_B, a.username, a.userId),
    friendRequestPush(TOKEN_B, a.username, a.userId),
  ]);
});

test('without a username you cannot ask anyone, nor be asked; nor can you ask yourself', async () => {
  const a = await signInWithUsername('alice');
  const nameless = await signInTestUser('nameless');

  expect(await nameless.data.sendFriendRequest(a.userId)).toEqual({ status: 'noUsername' });
  expect(await a.data.sendFriendRequest(nameless.userId)).toEqual({ status: 'notFound' });
  expect(await a.data.sendFriendRequest(a.userId)).toEqual({ status: 'notFound' });
  expect(await seenBy(a)).toEqual(nothing);
  expect(await seenBy(nameless)).toEqual(nothing);
});

test('answering a request that is not there is not found, and changes nothing', async () => {
  const a = await signInWithUsername('alice');
  const b = await signInWithUsername('bob');
  await a.data.sendFriendRequest(b.userId);

  expect(await a.data.respondToFriendRequest(b.userId, true)).toEqual({ status: 'notFound' });
  await b.data.respondToFriendRequest(a.userId, false);
  expect(await b.data.respondToFriendRequest(a.userId, true)).toEqual({ status: 'notFound' });

  expect(await seenBy(b)).toEqual(nothing);
});

test('a failed push, or a kick lost with no signal, never fails the request', async () => {
  const a = await signInWithUsername('alice', { pushFails: true });
  const c = await signInWithUsername('carol', { loseNotifyKicks: 1 });
  const b = await signInWithUsername('bob');
  await b.data.registerPushToken(TOKEN_B);

  expect(await a.data.sendFriendRequest(b.userId)).toEqual({ status: 'requested' });
  expect(await c.data.sendFriendRequest(b.userId)).toEqual({ status: 'requested' });

  expect(a.notifications.pushesSent()).toEqual([]);
  expect(c.notifications.pushesSent()).toEqual([]);
  expect((await seenBy(b)).incoming.sort()).toEqual([a.username, c.username].sort());
});

test('a token the push service reports gone is forgotten', async () => {
  const a = await signInWithUsername('alice', { unregisteredPushTokens: [TOKEN_B] });
  const b = await signInWithUsername('bob');
  const c = await signInWithUsername('carol');
  await b.data.registerPushToken(TOKEN_B);

  await a.data.sendFriendRequest(b.userId);
  await c.data.sendFriendRequest(b.userId);

  // The first push went to the gone token; Bob has none left, so Carol's request sends nothing.
  expect(a.notifications.pushesSent()).toEqual([friendRequestPush(TOKEN_B, a.username, a.userId)]);
  expect(c.notifications.pushesSent()).toEqual([]);
});

// At the same time. Each race holds one side open in a second database session (harness only) and
// makes the other wait on it, so the interleaving is the same on every run.

test('the same request sent from two phones at once is one request and one push', async () => {
  const a = await signInWithUsername('alice');
  const b = await signInWithUsername('bob');
  await b.data.registerPushToken(TOKEN_B);
  const held = await holdFriendRequest(a, b); // a's other phone, not committed yet

  const sending = a.data.sendFriendRequest(b.userId);
  await held.waitForWaiting(1);
  await held.commit();

  expect(await sending).toEqual({ status: 'requested' });
  expect(await seenBy(a)).toEqual({ friends: [], incoming: [], outgoing: [b.username] });
  expect(await seenBy(b)).toEqual({ friends: [], incoming: [a.username], outgoing: [] });
  expect(a.notifications.pushesSent()).toEqual([friendRequestPush(TOKEN_B, a.username, a.userId)]);
});

test('two people asking each other at once become Friends', async () => {
  const a = await signInWithUsername('alice');
  const b = await signInWithUsername('bob');
  const held = await holdFriendRequest(a, b);

  const sending = b.data.sendFriendRequest(a.userId);
  await held.waitForWaiting(1);
  await held.commit();

  expect(await sending).toEqual({ status: 'accepted' });
  expect(await seenBy(a)).toEqual({ friends: [b.username], incoming: [], outgoing: [] });
  expect(await seenBy(b)).toEqual({ friends: [a.username], incoming: [], outgoing: [] });
});

test('accepting on two phones at once ends the same as once', async () => {
  const a = await signInWithUsername('alice');
  const b = await signInWithUsername('bob');
  await a.data.sendFriendRequest(b.userId);
  const held = await holdFriendRequestAnswer(b, a, true);

  const answering = b.data.respondToFriendRequest(a.userId, true);
  await held.waitForWaiting(1);
  await held.commit();

  expect(await answering).toEqual({ status: 'accepted' });
  expect(await seenBy(a)).toEqual({ friends: [b.username], incoming: [], outgoing: [] });
  expect(await seenBy(b)).toEqual({ friends: [a.username], incoming: [], outgoing: [] });
});

test('accepting a request while it is being withdrawn: not found, and no Friendship', async () => {
  const a = await signInWithUsername('alice');
  const b = await signInWithUsername('bob');
  await a.data.sendFriendRequest(b.userId);
  const held = await holdFriendRequestCancel(a, b); // a withdraws it, not committed yet

  const answering = b.data.respondToFriendRequest(a.userId, true);
  await held.waitForWaiting(1);
  await held.commit();

  expect(await answering).toEqual({ status: 'notFound' });
  expect(await seenBy(a)).toEqual(nothing);
  expect(await seenBy(b)).toEqual(nothing);
});

test('asking back while the request is being withdrawn sends a fresh request, not a Friendship', async () => {
  const a = await signInWithUsername('alice');
  const b = await signInWithUsername('bob');
  await a.data.sendFriendRequest(b.userId);
  const held = await holdFriendRequestCancel(a, b);

  const sending = b.data.sendFriendRequest(a.userId);
  await held.waitForWaiting(1);
  await held.commit();

  expect(await sending).toEqual({ status: 'requested' });
  expect(await seenBy(a)).toEqual({ friends: [], incoming: [b.username], outgoing: [] });
  expect(await seenBy(b)).toEqual({ friends: [], incoming: [], outgoing: [a.username] });
});

test('withdrawing a request while it is being accepted withdraws nothing: they are Friends', async () => {
  const a = await signInWithUsername('alice');
  const b = await signInWithUsername('bob');
  await a.data.sendFriendRequest(b.userId);
  const held = await holdFriendRequestAnswer(b, a, true);

  const cancelling = a.data.cancelFriendRequest(b.userId);
  await held.waitForWaiting(1);
  await held.commit();

  await cancelling;
  expect(await seenBy(a)).toEqual({ friends: [b.username], incoming: [], outgoing: [] });
  expect(await seenBy(b)).toEqual({ friends: [a.username], incoming: [], outgoing: [] });
});

test('asking while being unfriended sends a request, not "already Friends"', async () => {
  const a = await signInWithUsername('alice');
  const b = await signInWithUsername('bob');
  await a.data.sendFriendRequest(b.userId);
  await b.data.respondToFriendRequest(a.userId, true);
  const held = await holdUnfriend(a, b); // a unfriends b, not committed yet

  const sending = b.data.sendFriendRequest(a.userId);
  await held.waitForWaiting(1);
  await held.commit();

  expect(await sending).toEqual({ status: 'requested' });
  expect(await seenBy(a)).toEqual({ friends: [], incoming: [b.username], outgoing: [] });
});

test('unfriending on both sides at once ends the same as once', async () => {
  const a = await signInWithUsername('alice');
  const b = await signInWithUsername('bob');
  await a.data.sendFriendRequest(b.userId);
  await b.data.respondToFriendRequest(a.userId, true);
  const held = await holdUnfriend(a, b);

  const unfriending = b.data.unfriend(a.userId);
  await held.waitForWaiting(1);
  await held.commit();

  await unfriending;
  expect(await seenBy(a)).toEqual(nothing);
  expect(await seenBy(b)).toEqual(nothing);
});

// What others can see

test('a stranger can find a username but read nothing else of the Profile', async () => {
  const a = await signInWithUsername('alice');
  const stranger = await signInWithUsername('stranger');

  expect(await stranger.data.searchUsers(a.username)).toEqual([
    { id: a.userId, username: a.username, relationship: 'none' },
  ]);
  expect(await stranger.data.getProfile(a.userId)).toBeNull();
  expect(await stranger.data.listFriends()).toEqual([]);
});

test('Friends and both sides of an open request see each other’s id and username, and nothing more', async () => {
  const a = await signInWithUsername('alice');
  const b = await signInWithUsername('bob');
  await a.data.sendFriendRequest(b.userId);

  expect(await a.data.getProfile(b.userId)).toEqual({ id: b.userId, username: b.username });
  expect(await b.data.getProfile(a.userId)).toEqual({ id: a.userId, username: a.username });

  await b.data.respondToFriendRequest(a.userId, true);
  expect(await a.data.getProfile(b.userId)).toEqual({ id: b.userId, username: b.username });
  expect(await b.data.getProfile(a.userId)).toEqual({ id: a.userId, username: a.username });
});
