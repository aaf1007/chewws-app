// Ticket 13: a Friend's Shopping List shared with them, with no signal (decisions 13 and 10). A
// shared Friend's changes queue and sync like the owner's; every queued change names its list, and
// goes out only as the user who made it, to a list the server says they can use when it arrives. A
// change to a list no longer shared comes back gone, and the phone says so and forgets the list.
// Changes an older version queued without a list still go to the user's own.
import { expect, test, vi } from 'vitest';

import type { DataLayer, ShoppingList, ShoppingListId, ShoppingListView, UserId } from '../src/data';
import { signInOnPhones, signInWithUsername, uniqueUsername, type TestPhone, type TestUser } from './harness';

/** The list as a user reads it: each line's name and whether it's checked. */
const view = (list: ShoppingList) =>
  list.items.map((item) => ({
    item: item.kind === 'ingredient' ? item.ingredient.name : item.text,
    checked: item.check.status === 'checked',
  }));

const pantryNames = async (user: { data: DataLayer }) => (await user.data.getPantry()).ingredients.map((i) => i.name);

type Someone = { userId: UserId; data: DataLayer };

async function befriend(a: Someone, b: Someone) {
  expect(await a.data.sendFriendRequest(b.userId)).toEqual({ status: 'requested' });
  expect(await b.data.respondToFriendRequest(a.userId, true)).toEqual({ status: 'accepted' });
}

/** A user signed in on one phone, with a username (so they can be Friends). */
async function phoneWithUsername(label: string): Promise<TestPhone> {
  const [phone] = await signInOnPhones(label, 1);
  const chosen = await phone.data.setUsername(uniqueUsername(label));
  if (chosen.status !== 'set') throw new Error(`Couldn't choose a username: ${chosen.status}`);
  return phone;
}

/**
 * An owner whose list (Garlic bread: garlic and butter; and Paper towels) is shared with `friends`,
 * each of whom has read it on their phone.
 */
async function shareWith(owner: TestUser, ...friends: TestPhone[]) {
  const bread = await owner.data.createRecipe({
    title: 'Garlic bread',
    lines: [
      { originalText: '2 cloves garlic', amountText: '2 cloves', ingredientName: 'garlic' },
      { originalText: '4 tbsp butter', amountText: '4 tbsp', ingredientName: 'butter' },
    ],
    steps: [],
  });
  await owner.data.addRecipeToShoppingList(bread);
  await owner.data.addManualItem('Paper towels');
  for (const friend of friends) {
    await befriend(owner, friend);
    expect(await owner.data.shareShoppingList(friend.userId)).toEqual({ status: 'shared' });
  }
  const listId = (await owner.data.getShoppingList()).id;
  for (const friend of friends) await friend.data.getShoppingList({ listId });
  return { listId };
}

function itemId(list: ShoppingList, name: string) {
  const found = list.items.find((i) => (i.kind === 'ingredient' ? i.ingredient.name : i.text) === name);
  if (!found) throw new Error(`${name} is not on the list`);
  return found.id;
}

/** Every view a phone's Shopping List screen would get, while watching a list. */
function watch(phone: TestPhone, listId?: ShoppingListId) {
  const views: ShoppingListView[] = [];
  const stop = phone.data.watchShoppingList((v) => views.push(v), { listId });
  return { views, last: () => views[views.length - 1], stop };
}

const unchanged = [
  { item: 'butter', checked: false },
  { item: 'garlic', checked: false },
  { item: 'Paper towels', checked: false },
];

/** Requests that change a list, sent from a phone after the first `from` it made. */
const listChangesSent = (phone: TestPhone, from: number) =>
  phone
    .requestsMade()
    .slice(from)
    .filter((sent) => /\/rpc\/(check_off|uncheck|add_manual_item)$/.test(sent.path));

test("a shared Friend's changes made with no signal show on their phone, wait, and sync like the owner's", async () => {
  const owner = await signInWithUsername('owner');
  const friend = await phoneWithUsername('friend');
  const { listId } = await shareWith(owner, friend);
  const seen = await friend.data.getShoppingList({ listId });
  await friend.data.getShoppingList();

  friend.goOffline();
  await friend.data.checkOff(itemId(seen, 'garlic'));
  await friend.data.checkOff(itemId(seen, 'Paper towels'), { listId });
  await friend.data.uncheck(itemId(seen, 'Paper towels'), { listId });
  await friend.data.addManualItem('Snacks', { listId });
  const changed = [
    { item: 'butter', checked: false },
    { item: 'garlic', checked: true },
    { item: 'Paper towels', checked: false },
    { item: 'Snacks', checked: false },
  ];
  expect(view(await friend.data.getShoppingList({ listId }))).toEqual(changed);
  expect(await friend.data.getListSync()).toEqual({ status: 'offline', waiting: 4 });
  // Their own list isn't touched, and the owner's server copy hasn't heard yet.
  expect((await friend.data.getShoppingList()).items).toEqual([]);
  expect(view(await owner.data.getShoppingList())).toEqual(unchanged);

  // Closed and opened again with no signal: the Friend's list and the changes are still there.
  const reopened = friend.relaunch();
  expect(view(await reopened.data.getShoppingList({ listId }))).toEqual(changed);
  expect(await reopened.data.listSharedShoppingLists()).toEqual([
    { id: listId, owner: { id: owner.userId, username: owner.username } },
  ]);

  reopened.goOnline();
  expect(await reopened.data.syncListChanges()).toEqual({ status: 'idle', waiting: 0 });
  expect(view(await owner.data.getShoppingList())).toEqual(changed);
  expect(await pantryNames(owner)).toEqual(['garlic']);
  expect(await pantryNames(reopened)).toEqual([]);
});

test.each(['stops sharing', 'unfriends them'] as const)(
  "a Friend's changes queued while the owner %s come back gone: dropped, the list forgotten, and the Friend told how many weren't saved",
  async (how) => {
    const owner = await signInWithUsername('owner');
    const friend = await phoneWithUsername('friend');
    const { listId } = await shareWith(owner, friend);
    const seen = await friend.data.getShoppingList({ listId });
    const screen = watch(friend, listId);
    await vi.waitFor(() => expect(screen.last()).toMatchObject({ status: 'loaded' }));

    friend.goOffline();
    await friend.data.checkOff(itemId(seen, 'garlic'), { listId });
    await friend.data.addManualItem('Snacks', { listId });
    expect(await friend.data.syncListChanges()).toEqual({ status: 'offline', waiting: 2 });
    if (how === 'stops sharing') await owner.data.stopSharingShoppingList(friend.userId);
    else await owner.data.unfriend(friend.userId);

    friend.goOnline();
    expect(await friend.data.syncListChanges()).toEqual({ status: 'idle', waiting: 0 });
    await vi.waitFor(() =>
      expect(screen.last()).toMatchObject({
        status: 'noLongerShared',
        ownerUsername: owner.username,
        changesNotSaved: 2,
      }),
    );
    // Nothing of it is kept on the phone, nor shown again, even after a restart with no signal.
    expect([...friend.saved().keys()].filter((key) => key.includes(listId))).toEqual([]);
    expect(await friend.data.listSharedShoppingLists()).toEqual([]);
    friend.goOffline();
    const reopened = friend.relaunch();
    await expect(reopened.data.getShoppingList({ listId })).rejects.toMatchObject({ code: 'shopping_list_not_shared' });
    expect(await reopened.data.listSharedShoppingLists()).toEqual([]);
    const after = watch(reopened, listId);
    await vi.waitFor(() => expect(after.last()).toMatchObject({ status: 'noLongerShared', changesNotSaved: 2 }));
    expect(after.views.filter((v) => v.status === 'loaded')).toEqual([]);

    // Seen: the notice goes.
    await reopened.data.dismissNoLongerShared(listId);
    await vi.waitFor(() => expect(after.last()?.status).not.toBe('noLongerShared'));
    expect(view(await owner.data.getShoppingList())).toEqual(unchanged);
    expect(await pantryNames(owner)).toEqual([]);
    screen.stop();
    after.stop();
  },
);

test('once a read finds a Friend\'s list unshared, the phone never shows it again: not from its copy, not after a restart', async () => {
  const owner = await signInWithUsername('owner');
  const friend = await phoneWithUsername('friend');
  const { listId } = await shareWith(owner, friend);
  expect([...friend.saved().keys()]).toContain(`recipeapp.shoppingList.${friend.userId}.${listId}`);

  await owner.data.unfriend(friend.userId);
  // The switcher's read finds it gone: its copy goes from the phone.
  expect(await friend.data.listSharedShoppingLists()).toEqual([]);
  expect([...friend.saved().keys()].filter((key) => key.includes(listId))).toEqual([]);

  const screen = watch(friend, listId);
  await vi.waitFor(() => expect(screen.last()).toMatchObject({ status: 'noLongerShared', changesNotSaved: 0 }));
  expect(screen.views.filter((v) => v.status === 'loaded')).toEqual([]);
  screen.stop();

  friend.goOffline();
  const reopened = friend.relaunch();
  await expect(reopened.data.getShoppingList({ listId })).rejects.toMatchObject({ code: 'shopping_list_not_shared' });
});

test('a change queued under one user never goes out as the next one signed in on the phone, for a shared list too', async () => {
  const owner = await signInWithUsername('owner');
  const a = await phoneWithUsername('a');
  const b = await phoneWithUsername('b');
  const { listId } = await shareWith(owner, a, b);
  const seen = await a.data.getShoppingList({ listId });
  await a.data.getShoppingList();

  a.goOffline();
  await a.data.checkOff(itemId(seen, 'garlic'), { listId });
  await a.data.addManualItem('Snacks', { listId });
  await a.data.addManualItem('Foil');
  expect(await a.data.syncListChanges()).toEqual({ status: 'offline', waiting: 3 });
  const sentBefore = a.requestsMade().length;
  await a.data.signOut();
  // Nothing of A's lists is left on the phone: not their queue, their list or the Friend's list.
  expect([...a.saved().keys()].filter((key) => /shoppingList|ShoppingLists|listChanges|signedInUser/.test(key))).toEqual([]);

  // B, who the same list is shared with, signs in on A's phone with a signal and uses it.
  a.goOnline();
  expect(await a.data.signInWithPassword(b.account)).toEqual(b.userId);
  expect(await a.data.syncListChanges()).toEqual({ status: 'idle', waiting: 0 });
  expect(view(await a.data.getShoppingList({ listId }))).toEqual(unchanged);
  expect(listChangesSent(a, sentBefore)).toEqual([]);
  await a.data.signOut();

  // A again: nothing of theirs is waiting, and the server never had it.
  expect(await a.data.signInWithPassword(a.account)).toEqual(a.userId);
  expect(await a.data.syncListChanges()).toEqual({ status: 'idle', waiting: 0 });
  expect(listChangesSent(a, sentBefore)).toEqual([]);
  expect(view(await owner.data.getShoppingList())).toEqual(unchanged);
  expect((await a.data.getShoppingList()).items).toEqual([]);
  expect(await pantryNames(owner)).toEqual([]);
});

test("a shared Friend's hand-add whose retry after a 401 would read the next user's session: nothing goes out as them", async () => {
  const owner = await signInWithUsername('owner');
  const a = await phoneWithUsername('a');
  const b = await phoneWithUsername('b');
  const { listId } = await shareWith(owner, a, b);
  a.goOffline();
  await a.data.addManualItem('Snacks', { listId });
  const sentBefore = a.requestsMade().length;

  // Back online, the server refuses the access token the add goes out with, so the phone refreshes
  // the session and sends it again. The retry reads the session the auth client just saved, slowly,
  // and B signs in on the phone before it has read.
  a.goOnline();
  a.serverAnswersFor('add_manual_item', 401);
  const send = a.holdNextRequest('add_manual_item');
  const syncing = a.data.syncListChanges();
  await send.reached;
  const read = a.holdSessionReadAfterNextSave();
  send.release();
  await read.reached;
  a.serverAnswersFor('add_manual_item', null);
  a.goOffline();
  await a.data.signOut();
  a.goOnline();
  expect(await a.data.signInWithPassword(b.account)).toEqual(b.userId);
  read.release();
  await syncing;

  expect(
    a
      .requestsMade()
      .slice(sentBefore)
      .filter((sent) => sent.user === b.userId && sent.path.startsWith('/rest/v1/rpc/')),
  ).toEqual([]);
  expect(listChangesSent(a, sentBefore)).toEqual([{ user: a.userId, path: '/rest/v1/rpc/add_manual_item' }]);
  expect(view(await owner.data.getShoppingList())).toEqual(unchanged);
});

/** What an older version saved: checks that name no list (before 13), and one hand-add with none (before 10). */
function asOlderVersion(saved: ReadonlyMap<string, string>, addWithoutList: string): Map<string, string> {
  const older = new Map(saved);
  for (const [key, value] of older) {
    if (!key.startsWith('recipeapp.listChanges.')) continue;
    const parsed: { queue: { change: Record<string, unknown> }[] } = JSON.parse(value);
    for (const { change } of parsed.queue) {
      if (change.kind !== 'addManualItem' || change.text === addWithoutList) delete change.listId;
    }
    older.set(key, JSON.stringify(parsed));
  }
  return older;
}

test('changes an older version queued without naming a list go to the user\'s own list, even with a Friend\'s list on the phone', async () => {
  const friendOwner = await signInWithUsername('owner');
  const [phone, other] = await signInOnPhones('shopper', 2);
  const chosen = await phone.data.setUsername(uniqueUsername('shopper'));
  if (chosen.status !== 'set') throw new Error(chosen.status);
  // The user's own list has Foil and Bin bags; a Friend's list is shared with them too.
  const foil = await phone.data.addManualItem('Foil');
  const bags = await phone.data.addManualItem('Bin bags');
  await phone.data.checkOff(bags);
  await shareWith(friendOwner, phone);
  await phone.data.getShoppingList();

  phone.goOffline();
  await phone.data.checkOff(foil);
  await phone.data.uncheck(bags);
  await phone.data.addManualItem('Snacks');
  await phone.data.addManualItem('Lemons');
  expect(await phone.data.syncListChanges()).toEqual({ status: 'offline', waiting: 4 });

  const reopened = phone.relaunch(asOlderVersion(phone.saved(), 'Lemons'));
  reopened.goOnline();
  expect(await reopened.data.syncListChanges()).toEqual({ status: 'idle', waiting: 0 });
  expect(view(await other.data.getShoppingList())).toEqual([
    { item: 'Bin bags', checked: false },
    { item: 'Foil', checked: true },
    { item: 'Lemons', checked: false },
    { item: 'Snacks', checked: false },
  ]);
  expect(view(await friendOwner.data.getShoppingList())).toEqual(unchanged);
});
