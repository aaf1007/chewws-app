// Access-rule tests for ticket 13: shared Shopping Lists (decisions 13). A stranger, a Friend the
// list isn't shared with, and a shared Friend after unfriending (before the trigger that ends the
// shares has run) skip the data layer and call PostgREST and Realtime directly with their own
// session, as an attacker would. RLS, the table grants, the checks inside the list functions and
// the policy on realtime.messages are what have to stop them. A shared Friend may use the list, but
// can't add or take off Recipes or remove the lines from them.
import { expect, inject, test } from 'vitest';

import { createTestClient, signInAttacker, type Attacker } from './access-harness';
import { countShares, endFriendshipBeforeCleanup, functionsRestatingTheShareRule, uniqueUsername } from './harness';

const permissionDenied = { code: '42501' };

/** Joining a Realtime channel takes a round trip or two over its socket, each time. */
const REALTIME_TEST_TIMEOUT_MS = 30_000;

async function named(label: string): Promise<Attacker> {
  const user = await signInAttacker(label);
  const result = await user.data.setUsername(uniqueUsername(label));
  if (result.status !== 'set') throw new Error(`Couldn't choose a username: ${result.status}`);
  return user;
}

async function befriend(a: Attacker, b: Attacker) {
  expect(await a.data.sendFriendRequest(b.userId)).toEqual({ status: 'requested' });
  expect(await b.data.respondToFriendRequest(a.userId, true)).toEqual({ status: 'accepted' });
}

/**
 * An owner whose list has garlic (unchecked) and butter (checked off, so in their Pantry) from a
 * Recipe, plus "Paper towels" by hand, shared with `friend`; `otherFriend` is a Friend it isn't
 * shared with; `stranger` is nobody to them.
 */
async function sharedList() {
  const owner = await named('owner');
  const friend = await named('friend');
  const otherFriend = await named('other');
  const stranger = await named('stranger');
  await befriend(owner, friend);
  await befriend(owner, otherFriend);
  const recipeId = await owner.data.createRecipe({
    title: 'Garlic bread',
    lines: [
      { originalText: '2 cloves garlic', amountText: '2 cloves', ingredientName: 'garlic' },
      { originalText: '4 tbsp butter', amountText: '4 tbsp', ingredientName: 'butter' },
    ],
    steps: [],
  });
  await owner.data.addRecipeToShoppingList(recipeId);
  await owner.data.addManualItem('Paper towels');
  const list = await owner.data.getShoppingList();
  const [butter, garlic, towels] = list.items;
  await owner.data.checkOff(butter.id);
  expect(await owner.data.shareShoppingList(friend.userId)).toEqual({ status: 'shared' });
  const before = await owner.data.getShoppingList();

  async function expectOwnerListUnchanged() {
    const now = await owner.data.getShoppingList();
    // Who it's shared with may change (an unfriend); nothing on it may.
    expect({ ...now, sharedWith: [] }).toEqual({ ...before, sharedWith: [] });
    expect(now.items.map((i) => [i.kind === 'ingredient' ? i.ingredient.name : i.text, i.check.status])).toEqual([
      ['butter', 'checked'],
      ['garlic', 'unchecked'],
      ['Paper towels', 'unchecked'],
    ]);
    expect((await owner.data.getPantry()).ingredients.map((i) => i.name)).toEqual(['butter']);
  }
  return { owner, friend, otherFriend, stranger, listId: list.id, recipeId, butter, garlic, towels, expectOwnerListUnchanged };
}

/** How a Realtime subscription to a list's private topic ends: joined, or refused. */
function subscribe(user: Attacker, listId: string): Promise<'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED'> {
  return new Promise((resolve) => {
    const channel = user.client.channel(`shopping_list:${listId}`, { config: { private: true } });
    let answered = false;
    channel.subscribe((status) => {
      if (answered) return;
      answered = true;
      resolve(status);
      void user.client.removeChannel(channel);
    });
  });
}

/** Everything `user` could read of the list straight from the API. */
async function readsOf(user: Attacker, listId: string, itemIds: string[]) {
  const [lists, items, amounts, people, shares] = await Promise.all([
    user.client.from('shopping_lists').select('id').eq('id', listId),
    user.client.from('shopping_list_items').select('id').eq('list_id', listId),
    user.client.from('shopping_list_amounts').select('item_id').in('item_id', itemIds),
    user.client.from('shopping_list_people').select('user_id').eq('list_id', listId),
    user.client.from('shopping_list_shares').select('*'),
  ]);
  return {
    lists: lists.data,
    items: items.data,
    amounts: amounts.data,
    people: people.data,
    shares: shares.error?.code ?? shares.data,
  };
}

const nothing = { lists: [], items: [], amounts: [], people: [], shares: permissionDenied.code };

/** Every write `user` could try on the list straight from the API, and what each answered. */
async function writesOf(user: Attacker, listId: string, ids: { garlic: string; butter: string; towels: string }) {
  const checkOff = await user.client.rpc('check_off', { item_id: ids.garlic });
  const uncheck = await user.client.rpc('uncheck', { item_id: ids.butter });
  const add = await user.client.rpc('add_manual_item', { list_id: listId, item_text: 'Snacks', ingredient_name: 'snack' });
  const removeHand = await user.client.from('shopping_list_items').delete().eq('id', ids.towels).select('id');
  const removeLine = await user.client.from('shopping_list_items').delete().eq('id', ids.garlic).select('id');
  const removeAmounts = await user.client.from('shopping_list_amounts').delete().eq('item_id', ids.garlic).select('item_id');
  return {
    checkOff: checkOff.data,
    uncheck: uncheck.data,
    add: add.data,
    removeHand: removeHand.data,
    removeLine: removeLine.data,
    removeAmounts: removeAmounts.data,
  };
}

const refused = { checkOff: 'gone', uncheck: 'gone', add: null, removeHand: [], removeLine: [], removeAmounts: [] };

test('a stranger and a Friend the list is not shared with read nothing of it, change nothing on it, and cannot subscribe to it', async () => {
  const { owner, friend, otherFriend, stranger, listId, garlic, butter, towels, expectOwnerListUnchanged } = await sharedList();
  const itemIds = [garlic.id, butter.id, towels.id];

  for (const attacker of [stranger, otherFriend]) {
    expect(await readsOf(attacker, listId, itemIds)).toEqual(nothing);
    expect(await writesOf(attacker, listId, { garlic: garlic.id, butter: butter.id, towels: towels.id })).toEqual(refused);
    expect(await subscribe(attacker, listId)).toBe('CHANNEL_ERROR');
    expect((await attacker.client.rpc('list_shared_shopping_lists')).data).toEqual([]);
  }
  await expectOwnerListUnchanged();

  // The owner and the shared Friend read it and may subscribe: the same calls aren't refused for all.
  expect(await subscribe(owner, listId)).toBe('SUBSCRIBED');
  expect(await subscribe(friend, listId)).toBe('SUBSCRIBED');
  const friendReads = await readsOf(friend, listId, itemIds);
  expect(friendReads.lists).toEqual([{ id: listId }]);
  expect(friendReads.items).toHaveLength(3);
  expect(friendReads.amounts).toHaveLength(2);
  expect(friendReads.people).toHaveLength(2);
  expect(friendReads.shares).toBe(permissionDenied.code);
}, REALTIME_TEST_TIMEOUT_MS);

test('nobody writes shares, list rows or amounts directly; nobody shares themselves into a list or leaves one for someone else', async () => {
  const { owner, friend, otherFriend, stranger, listId, garlic, recipeId } = await sharedList();

  const insertShare = await stranger.client.from('shopping_list_shares').insert({ list_id: listId, friend_id: stranger.userId });
  const deleteShare = await owner.client.from('shopping_list_shares').delete().eq('list_id', listId);
  const insertItem = await friend.client
    .from('shopping_list_items')
    .insert({ list_id: listId, hand_added_text: 'Snacks' });
  const insertAmount = await friend.client
    .from('shopping_list_amounts')
    .insert({ item_id: garlic.id, recipe_id: recipeId, recipe_title: 'Garlic bread' });
  const updateItem = await friend.client.from('shopping_list_items').update({ checked_at: null }).eq('list_id', listId);
  const peopleWrite = await friend.client.from('shopping_list_people').delete().eq('list_id', listId);
  expect(insertShare.error).toMatchObject(permissionDenied);
  expect(deleteShare.error).toMatchObject(permissionDenied);
  expect(insertItem.error).toMatchObject(permissionDenied);
  expect(insertAmount.error).toMatchObject(permissionDenied);
  expect(updateItem.error).toMatchObject(permissionDenied);
  // A view of a function: it can't be written at all (55000), let alone by them.
  expect(peopleWrite.error).toMatchObject({ code: '55000' });

  // Sharing is the owner's own list only; a stranger "sharing" with the owner shares nothing of theirs.
  expect((await stranger.client.rpc('share_shopping_list', { friend_id: owner.userId })).data).toEqual({ status: 'notFriends' });
  expect((await otherFriend.client.rpc('share_shopping_list', { friend_id: owner.userId })).data).toEqual({ status: 'shared' });
  expect((await otherFriend.client.rpc('list_shared_shopping_lists')).data).toEqual([]);
  // Leaving or stopping someone else's share does nothing.
  expect((await stranger.client.rpc('leave_shared_shopping_list', { list_id: listId })).data).toEqual({ status: 'notShared' });
  expect((await otherFriend.client.rpc('stop_sharing_shopping_list', { friend_id: friend.userId })).data).toEqual({
    status: 'notShared',
  });
  expect((await friend.client.rpc('list_shared_shopping_lists')).data).toEqual([
    { list_id: listId, owner_id: owner.userId, owner_username: expect.any(String) },
  ]);
});

test("a shared Friend can't add or take off the owner's Recipes, nor remove the lines and amounts they brought", async () => {
  const { friend, garlic, butter, towels, recipeId, expectOwnerListUnchanged } = await sharedList();

  const add = await friend.client.rpc('add_recipe_to_shopping_list', {
    recipe_id: recipeId,
    lines: [{ ingredient_id: garlic.kind === 'ingredient' ? garlic.ingredient.id : '', amount_texts: ['9 cloves'] }],
  });
  expect(add).toMatchObject({ data: null, error: null });
  await friend.client.rpc('remove_recipe_from_shopping_list', { recipe_id: recipeId });
  const removeLine = await friend.client.from('shopping_list_items').delete().eq('id', garlic.id).select('id');
  const removeAmounts = await friend.client.from('shopping_list_amounts').delete().eq('item_id', garlic.id).select('item_id');
  expect(removeLine.data).toEqual([]);
  expect(removeAmounts.data).toEqual([]);
  await expectOwnerListUnchanged();

  // What a shared Friend may do, they can: here, take off a hand-added item.
  const removeHand = await friend.client.from('shopping_list_items').delete().eq('id', towels.id).select('id');
  expect(removeHand.data).toEqual([{ id: towels.id }]);
  expect((await friend.client.rpc('uncheck', { item_id: butter.id })).data).toBe('applied');
});

test('after unfriending, before the shares are cleaned up, the Friend is refused everything at once', async () => {
  const { owner, friend, listId, garlic, butter, towels, expectOwnerListUnchanged } = await sharedList();
  expect(await subscribe(friend, listId)).toBe('SUBSCRIBED');

  await endFriendshipBeforeCleanup(owner, friend);
  expect(await countShares(owner)).toBe(1);

  expect(await readsOf(friend, listId, [garlic.id, butter.id, towels.id])).toEqual(nothing);
  expect(await writesOf(friend, listId, { garlic: garlic.id, butter: butter.id, towels: towels.id })).toEqual(refused);
  expect(await subscribe(friend, listId)).toBe('CHANNEL_ERROR');
  expect((await friend.client.rpc('list_shared_shopping_lists')).data).toEqual([]);
  expect((await owner.client.rpc('list_shopping_list_shares')).data).toEqual([]);
  // The owner sees nobody shared with: the people on the list are only those who may use it.
  expect((await owner.data.getShoppingList()).sharedWith).toEqual([]);
  await expectOwnerListUnchanged();
}, REALTIME_TEST_TIMEOUT_MS);

test('the private sharing rules are not exposed through the Data API, and signed out nothing answers', async () => {
  const { stranger, owner, listId } = await sharedList();
  const { url, anonKey } = inject('supabase');
  const { data } = await stranger.client.auth.getSession();
  const token = data.session?.access_token ?? '';
  for (const [fn, args] of [
    ['shopping_list_people', {}],
    ['shopping_list_of_topic', { topic: `shopping_list:${listId}` }],
    ['announce_shopping_lists', { list_ids: [listId] }],
    ['lock_pair', { a: stranger.userId, b: owner.userId }],
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
    expect(response.status, fn).toBe(406);
  }

  const anon = createTestClient();
  const signedOut = [
    await anon.rpc('share_shopping_list', { friend_id: owner.userId }),
    await anon.rpc('stop_sharing_shopping_list', { friend_id: owner.userId }),
    await anon.rpc('leave_shared_shopping_list', { list_id: listId }),
    await anon.rpc('list_shopping_list_shares'),
    await anon.rpc('list_shared_shopping_lists'),
  ];
  for (const { error } of signedOut) expect(error).toMatchObject(permissionDenied);
  const people = await anon.from('shopping_list_people').select('*');
  expect(people.error).toMatchObject(permissionDenied);
});

test('who may use a shared list is decided only by private.can_use_shopping_list, never restated', async () => {
  expect(await functionsRestatingTheShareRule()).toEqual([]);
});
