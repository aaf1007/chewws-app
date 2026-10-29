// Access-rule tests for ticket 11: usernames and Friends (decisions 11). Users call PostgREST
// directly with their own session, as an attacker would. A stranger can find a username and nothing
// else; nobody reads or writes `friendships` except through the RPCs; the private schema isn't
// reachable; a decline never shows; at most 50 requests are out at once; and a pair gets at most
// one "Friend request" push in 7 days, however the requester tries.
import { expect, inject, test } from 'vitest';

import {
  createTestClient,
  inProcessNotifications,
  signInAttacker,
  type Attacker,
} from './access-harness';
import { backdateFriendRequestPushes, seedUsersWithUsernames, uniqueUsername } from './harness';

const permissionDenied = { code: '42501' };
const TOKEN = 'ExponentPushToken[friendsaccess0000001]';

/** A fresh signed-in attacker who has chosen a username. */
async function named(label: string): Promise<Attacker & { username: string }> {
  const user = await signInAttacker(label);
  const result = await user.data.setUsername(uniqueUsername(label));
  if (result.status !== 'set') throw new Error(`Couldn't choose a username: ${result.status}`);
  return { ...user, username: result.username };
}

/** What an RPC answered; its error, if any, is thrown. */
async function rpcData<T>(promise: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  const { data, error } = await promise;
  if (error) throw error;
  if (data === null) throw new Error('The RPC answered nothing.');
  return data;
}

test('a stranger can find a username, and reads no other Profile field and no friendships row', async () => {
  const owner = await named('owner');
  const friend = await named('friend');
  const stranger = await named('stranger');
  await owner.data.sendFriendRequest(friend.userId);
  await friend.data.respondToFriendRequest(owner.userId, true);

  expect(await rpcData(stranger.client.rpc('search_users', { query: owner.username }))).toEqual([
    { id: owner.userId, username: owner.username, relationship: 'none' },
  ]);

  const profiles = await stranger.client.from('profiles').select('*');
  expect(profiles.error).toBeNull();
  expect(profiles.data?.map((p) => p.id)).toEqual([stranger.userId]);
  expect(await rpcData(stranger.client.rpc('get_profile', { user_id: owner.userId }))).toEqual([]);
  // A Friend sees only id and username, through get_profile; never the Profile row itself.
  expect(await rpcData(friend.client.rpc('get_profile', { user_id: owner.userId }))).toEqual([
    { id: owner.userId, username: owner.username },
  ]);
  const friendsRow = await friend.client.from('profiles').select('*').eq('id', owner.userId);
  expect(friendsRow).toMatchObject({ data: [], error: null });

  for (const who of [stranger, owner]) {
    const read = await who.client.from('friendships').select('*');
    expect(read.error).toMatchObject(permissionDenied);
  }
  const insert = await stranger.client
    .from('friendships')
    .insert({ requester_id: stranger.userId, addressee_id: owner.userId, status: 'accepted' });
  const update = await owner.client.from('friendships').update({ status: 'declined' }).eq('requester_id', owner.userId);
  const remove = await owner.client.from('friendships').delete().eq('requester_id', owner.userId);
  expect(insert.error).toMatchObject(permissionDenied);
  expect(update.error).toMatchObject(permissionDenied);
  expect(remove.error).toMatchObject(permissionDenied);
  expect(await stranger.data.listFriends()).toEqual([]);
  expect((await owner.data.listFriends()).map((f) => f.id)).toEqual([friend.userId]);
});

test('nobody can change another user’s username, or their own except through set_username', async () => {
  const owner = await named('owner');
  const stranger = await named('stranger');

  const theirs = await stranger.client.from('profiles').update({ username: 'stolen_name' }).eq('id', owner.userId);
  const own = await owner.client.from('profiles').update({ username: 'ADMIN' }).eq('id', owner.userId);

  expect(theirs.error).toMatchObject(permissionDenied);
  expect(own.error).toMatchObject(permissionDenied);
  expect((await owner.data.getMyProfile()).username).toBe(owner.username);
  // set_username checks the rule itself, whatever the app sends.
  expect(await rpcData(owner.client.rpc('set_username', { name: 'Root' }))).toEqual({ status: 'reserved' });
  expect(await rpcData(owner.client.rpc('set_username', { name: 'a b' }))).toEqual({ status: 'invalid' });
});

test('the private schema (are_friends, can_see_profile…) cannot be called through the API', async () => {
  const a = await named('a');
  const b = await named('b');
  await a.data.sendFriendRequest(b.userId);
  await b.data.respondToFriendRequest(a.userId, true);
  const stranger = await named('stranger');
  const { url, anonKey } = inject('supabase');
  const { data } = await stranger.client.auth.getSession();
  const token = data.session?.access_token ?? '';

  for (const [fn, args] of [
    ['are_friends', { a: a.userId, b: b.userId }],
    ['friend_ids', { who: a.userId }],
    ['can_see_profile', { id: a.userId }],
    ['relationship_with', { other: a.userId }],
  ] as const) {
    const response = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Profile': 'private',
      },
      body: JSON.stringify(args),
    });
    const body: unknown = await response.json();
    expect(response.status, fn).toBe(406);
    expect(body, fn).toMatchObject({ code: 'PGRST106' });
  }
});

test('only the notify function (the service role) can claim a push, and only for a request the caller sent', async () => {
  const a = await named('a');
  const victim = await named('victim');
  await victim.data.registerPushToken(TOKEN);
  const anon = createTestClient();

  const claim = await a.client.rpc('claim_friend_request_push', { requester: a.userId, addressee: victim.userId });
  expect(claim.error).toMatchObject(permissionDenied);
  const signedOut = [
    await anon.rpc('search_users', { query: victim.username }),
    await anon.rpc('send_friend_request', { user_id: victim.userId }),
    await anon.rpc('list_friends'),
    await anon.rpc('get_profile', { user_id: victim.userId }),
    await anon.rpc('set_username', { name: 'anonymous' }),
  ];
  for (const { error } of signedOut) expect(error).toMatchObject(permissionDenied);

  // Asking the notify function to push someone a has sent no request to sends nothing.
  const { notifications, sendNotification } = inProcessNotifications(a.client);
  await sendNotification({ kind: 'friendRequest', toUserId: victim.userId });
  expect(notifications.pushesSent()).toEqual([]);
});

test('a requester cannot learn that their request was declined', async () => {
  const requester = await named('requester');
  const addressee = await named('addressee');
  await requester.data.sendFriendRequest(addressee.userId);

  /** Everything the requester can ask the API about the addressee. */
  const view = async () => ({
    requests: (await rpcData(requester.client.rpc('list_friend_requests'))).map((r) => ({
      id: r.id,
      direction: r.direction,
    })),
    friends: await rpcData(requester.client.rpc('list_friends')),
    search: await rpcData(requester.client.rpc('search_users', { query: addressee.username })),
    profile: await rpcData(requester.client.rpc('get_profile', { user_id: addressee.userId })),
  });
  const pending = await view();
  expect(pending).toEqual({
    requests: [{ id: addressee.userId, direction: 'outgoing' }],
    friends: [],
    search: [{ id: addressee.userId, username: addressee.username, relationship: 'requestSent' }],
    profile: [{ id: addressee.userId, username: addressee.username }],
  });

  await addressee.data.respondToFriendRequest(requester.userId, false);

  expect(await view()).toEqual(pending);
  expect(await rpcData(requester.client.rpc('send_friend_request', { user_id: addressee.userId }))).toEqual({
    status: 'requested',
  });
  expect(await view()).toEqual(pending);
});

test('a user cannot have more than 50 requests out, and a decline frees no room for a 51st', async () => {
  const sender = await named('sender');
  const people = await seedUsersWithUsernames('target', 52);

  const answers = [];
  for (const person of people.slice(0, 50)) {
    answers.push(await rpcData(sender.client.rpc('send_friend_request', { user_id: person.userId })));
  }
  expect(answers).toEqual(Array.from({ length: 50 }, () => ({ status: 'requested' })));
  expect(await rpcData(sender.client.rpc('send_friend_request', { user_id: people[50].userId }))).toEqual({
    status: 'tooMany',
  });

  // One of them declines: still 50 out, as far as anyone can tell.
  const decliner = createTestClient();
  await decliner.auth.signInWithPassword(people[0].account);
  expect(await rpcData(decliner.rpc('respond_to_friend_request', { requester_id: sender.userId, accept: false }))).toEqual({
    status: 'declined',
  });
  expect(await rpcData(sender.client.rpc('send_friend_request', { user_id: people[50].userId }))).toEqual({
    status: 'tooMany',
  });

  // Withdrawing one does free a place.
  expect((await sender.client.rpc('cancel_friend_request', { user_id: people[1].userId })).error).toBeNull();
  expect(await rpcData(sender.client.rpc('send_friend_request', { user_id: people[50].userId }))).toEqual({
    status: 'requested',
  });
  expect(await rpcData(sender.client.rpc('send_friend_request', { user_id: people[51].userId }))).toEqual({
    status: 'tooMany',
  });
  expect(await rpcData(sender.client.rpc('list_friend_requests'))).toHaveLength(50);
});

test('a pair gets at most one "Friend request" push in 7 days, however often the requester asks', async () => {
  const requester = await named('requester');
  const addressee = await named('addressee');
  await addressee.data.registerPushToken(TOKEN);

  await requester.data.sendFriendRequest(addressee.userId);
  for (let i = 0; i < 3; i += 1) {
    expect((await requester.client.rpc('cancel_friend_request', { user_id: addressee.userId })).error).toBeNull();
    await requester.data.sendFriendRequest(addressee.userId);
  }
  const { sendNotification } = inProcessNotifications(requester.client);
  await sendNotification({ kind: 'friendRequest', toUserId: addressee.userId });

  expect(requester.notifications.pushesSent()).toHaveLength(1);
  expect(requester.notifications.pushesSent()[0]).toMatchObject({ to: TOKEN, title: 'Friend request' });

  // Six days on, still none; past seven, one more.
  await backdateFriendRequestPushes(requester, addressee, 6);
  await requester.data.cancelFriendRequest(addressee.userId);
  await requester.data.sendFriendRequest(addressee.userId);
  expect(requester.notifications.pushesSent()).toHaveLength(1);
  await backdateFriendRequestPushes(requester, addressee, 2);
  await requester.data.cancelFriendRequest(addressee.userId);
  await requester.data.sendFriendRequest(addressee.userId);
  expect(requester.notifications.pushesSent()).toHaveLength(2);
});
