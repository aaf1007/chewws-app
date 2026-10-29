// Ticket 13: sharing a Shopping List with chosen Friends (decisions 13). Owners and Friends are real
// signed-in users acting through the data layer: what each can see and do on the shared list, where
// a Friend's check-off goes, what ending the sharing (or the Friendship) does, the races between
// them, and the list changing live on a Friend's screen.
import { expect, test, vi } from 'vitest';

import type { RecipeLineInput, ShoppingList, ShoppingListItem, ShoppingListView, UserId } from '../src/data';
import {
  countShares,
  endFriendshipBeforeCleanup,
  holdCheckOff,
  holdLeave,
  holdShare,
  holdStopSharing,
  holdUnfriend,
  signInWithUsername,
  type TestUser,
} from './harness';

type Named = TestUser & { username: string };

/** The list as a user reads it: each line's name, its Recipes' amounts, and whether it's checked. */
const view = (list: ShoppingList) =>
  list.items.map((item) =>
    item.kind === 'ingredient'
      ? {
          ingredient: item.ingredient.name,
          recipes: item.recipes.map((r) => [r.recipe.title, ...r.amountTexts]),
          checked: item.check.status === 'checked',
        }
      : { handAdded: item.text, ingredient: item.ingredient?.name ?? null, checked: item.check.status === 'checked' },
  );

const pantryNames = async (user: TestUser) => (await user.data.getPantry()).ingredients.map((i) => i.name);

async function befriend(a: Named, b: Named) {
  expect(await a.data.sendFriendRequest(b.userId)).toEqual({ status: 'requested' });
  expect(await b.data.respondToFriendRequest(a.userId, true)).toEqual({ status: 'accepted' });
}

/** An owner with Garlic bread (garlic, butter) and "Paper towels" on their list, shared with a Friend. */
async function sharedList() {
  const owner = await signInWithUsername('owner');
  const friend = await signInWithUsername('friend');
  await befriend(owner, friend);
  const bread = await owner.data.createRecipe({ title: 'Garlic bread', lines: garlicBread, steps: [] });
  await owner.data.addRecipeToShoppingList(bread);
  await owner.data.addManualItem('Paper towels');
  expect(await owner.data.shareShoppingList(friend.userId)).toEqual({ status: 'shared' });
  const listId = (await owner.data.getShoppingList()).id;
  return { owner, friend, bread, listId };
}

const garlicBread: RecipeLineInput[] = [
  { originalText: '2 cloves garlic, minced', amountText: '2 cloves', ingredientName: 'garlic' },
  { originalText: '4 tbsp butter', amountText: '4 tbsp', ingredientName: 'butter' },
];

/** An item on a list, by its Ingredient's name or its hand-added text. */
function named(list: ShoppingList, name: string): ShoppingListItem {
  const found = list.items.find((i) => (i.kind === 'ingredient' ? i.ingredient.name === name : i.text === name));
  if (!found) throw new Error(`${name} is not on the list`);
  return found;
}

const garlicLine = (checked: boolean) => ({ ingredient: 'garlic', recipes: [['Garlic bread', '2 cloves']], checked });
const butterLine = (checked: boolean) => ({ ingredient: 'butter', recipes: [['Garlic bread', '4 tbsp']], checked });
const towels = (checked: boolean) => ({ handAdded: 'Paper towels', ingredient: null, checked });

test('the owner shares their list with a Friend, who finds it beside their own and reads it, Recipe titles included', async () => {
  const { owner, friend, listId } = await sharedList();

  expect(await friend.data.listSharedShoppingLists()).toEqual([
    { id: listId, owner: { id: owner.userId, username: owner.username } },
  ]);
  const shared = await friend.data.getShoppingList({ listId });
  expect(view(shared)).toEqual([butterLine(false), garlicLine(false), towels(false)]);
  expect(shared).toMatchObject({
    ownerId: owner.userId,
    ownerUsername: owner.username,
    sharedWith: [{ id: friend.userId, username: friend.username }],
  });
  // Their own list is untouched, and nobody else's is shared with the owner.
  expect((await friend.data.getShoppingList()).items).toEqual([]);
  expect(await owner.data.listSharedShoppingLists()).toEqual([]);
  expect(await owner.data.listShoppingListShares()).toEqual([
    { friend: { id: friend.userId, username: friend.username }, sharedAt: expect.any(String) },
  ]);
});

test('sharing with one or more Friends, and again, is fine; with someone who is not a Friend it is refused', async () => {
  const { owner, friend, listId } = await sharedList();
  const second = await signInWithUsername('second');
  const stranger = await signInWithUsername('stranger');
  await befriend(owner, second);

  expect(await owner.data.shareShoppingList(friend.userId)).toEqual({ status: 'shared' });
  expect(await owner.data.shareShoppingList(second.userId)).toEqual({ status: 'shared' });
  expect(await owner.data.shareShoppingList(stranger.userId)).toEqual({ status: 'notFriends' });
  expect(await owner.data.shareShoppingList(owner.userId)).toEqual({ status: 'notFriends' });

  expect((await owner.data.listShoppingListShares()).map((s) => s.friend.username).sort()).toEqual(
    [friend.username, second.username].sort(),
  );
  expect(view(await second.data.getShoppingList({ listId }))).toEqual([butterLine(false), garlicLine(false), towels(false)]);
  expect(await stranger.data.listSharedShoppingLists()).toEqual([]);
  await expect(stranger.data.getShoppingList({ listId })).rejects.toMatchObject({ code: 'shopping_list_not_shared' });
});

test('a shared Friend adds, checks off and unchecks items, and removes those added by hand; the owner sees each change', async () => {
  const { owner, friend, listId } = await sharedList();
  const list = await friend.data.getShoppingList({ listId });

  await friend.data.addManualItem('Snacks', { listId });
  await friend.data.checkOff(named(list, 'garlic').id, { listId });
  await friend.data.checkOff(named(list, 'Paper towels').id);
  await friend.data.uncheck(named(list, 'Paper towels').id);
  expect(view(await owner.data.getShoppingList())).toEqual([
    butterLine(false),
    garlicLine(true),
    towels(false),
    { handAdded: 'Snacks', ingredient: null, checked: false },
  ]);
  expect(named(await owner.data.getShoppingList(), 'garlic').check).toMatchObject({ status: 'checked', checkedBy: friend.userId });

  await friend.data.removeFromShoppingList(named(list, 'Paper towels').id);
  expect(view(await owner.data.getShoppingList())).toEqual([
    butterLine(false),
    garlicLine(true),
    { handAdded: 'Snacks', ingredient: null, checked: false },
  ]);
  // The Friend's own list never had any of it.
  expect((await friend.data.getShoppingList()).items).toEqual([]);
});

test("a shared Friend can't remove the lines from the owner's Recipes, nor add or take off Recipes", async () => {
  const { owner, friend, bread, listId } = await sharedList();
  const garlic = named(await friend.data.getShoppingList({ listId }), 'garlic');

  await expect(friend.data.removeFromShoppingList(garlic.id)).rejects.toMatchObject({ code: 'shopping_list_item_not_yours' });
  await expect(friend.data.addRecipeToShoppingList(bread)).rejects.toMatchObject({ code: 'recipe_not_found' });
  await friend.data.removeRecipeFromShoppingList(bread);

  expect(view(await owner.data.getShoppingList())).toEqual([butterLine(false), garlicLine(false), towels(false)]);
  expect((await friend.data.getShoppingList()).items).toEqual([]);
});

test("a shared Friend's check-off puts the Ingredient in the owner's Pantry, never the Friend's", async () => {
  const { owner, friend, listId } = await sharedList();
  await friend.data.addManualItem('Garlic', { listId });
  const list = await friend.data.getShoppingList({ listId });

  await friend.data.checkOff(named(list, 'butter').id, { listId });
  // A hand-added item that matches an Ingredient goes to the owner's Pantry too; one that matches
  // none goes nowhere.
  await friend.data.checkOff(named(list, 'Garlic').id, { listId });
  await friend.data.checkOff(named(list, 'Paper towels').id, { listId });

  expect(await pantryNames(owner)).toEqual(['butter', 'garlic']);
  expect(await pantryNames(friend)).toEqual([]);
});

test('the owner and a Friend checking off the same item at once: the first keeps it, and the Pantry gets it once', async () => {
  const { owner, friend, listId } = await sharedList();
  const garlic = named(await friend.data.getShoppingList({ listId }), 'garlic');

  const held = await holdCheckOff(owner, garlic.id);
  const friendChecks = friend.data.checkOff(garlic.id, { listId });
  await held.waitForWaiting(1);
  await held.commit();
  await friendChecks;

  expect(named(await owner.data.getShoppingList(), 'garlic').check).toMatchObject({ status: 'checked', checkedBy: owner.userId });
  expect(await pantryNames(owner)).toEqual(['garlic']);
  expect(await pantryNames(friend)).toEqual([]);
});

test('Recipe titles on a shared list follow the Recipe when the owner renames it', async () => {
  const { owner, friend, bread, listId } = await sharedList();

  await owner.data.editRecipe(bread, { title: 'Cheesy garlic bread', lines: garlicBread, steps: [] });

  expect(view(await friend.data.getShoppingList({ listId }))).toEqual([
    { ingredient: 'butter', recipes: [['Cheesy garlic bread', '4 tbsp']], checked: false },
    { ingredient: 'garlic', recipes: [['Cheesy garlic bread', '2 cloves']], checked: false },
    towels(false),
  ]);
  expect((await friend.data.getShoppingList({ listId })).recipes).toEqual([{ id: bread, title: 'Cheesy garlic bread' }]);
});

test("a Friend the list isn't shared with can't read it, nor change it", async () => {
  const { owner, listId } = await sharedList();
  const other = await signInWithUsername('other');
  await befriend(owner, other);
  const garlic = named(await owner.data.getShoppingList(), 'garlic');

  expect(await other.data.listSharedShoppingLists()).toEqual([]);
  await expect(other.data.getShoppingList({ listId })).rejects.toMatchObject({ code: 'shopping_list_not_shared' });
  await expect(other.data.checkOff(garlic.id, { listId })).rejects.toMatchObject({ code: 'shopping_list_item_not_found' });
  await expect(other.data.addManualItem('Snacks', { listId })).rejects.toMatchObject({ code: 'shopping_list_not_shared' });
  await expect(other.data.removeFromShoppingList(garlic.id, { listId })).rejects.toMatchObject({
    code: 'shopping_list_not_shared',
  });

  expect(view(await owner.data.getShoppingList())).toEqual([butterLine(false), garlicLine(false), towels(false)]);
  expect(await pantryNames(owner)).toEqual([]);
});

test("removing from a Friend's list that stopped being shared fails, even an item the phone still holds", async () => {
  const { owner, friend, listId } = await sharedList();
  const snacks = await friend.data.addManualItem('Snacks', { listId });
  const towelsId = named(await friend.data.getShoppingList({ listId }), 'Paper towels').id;

  // Gone already from a list still shared: fine.
  await owner.data.removeFromShoppingList(snacks);
  await friend.data.removeFromShoppingList(snacks, { listId });

  await owner.data.stopSharingShoppingList(friend.userId);
  // The phone still holds the item on its copy of the list: no listId needed to find it.
  await expect(friend.data.removeFromShoppingList(towelsId)).rejects.toMatchObject({ code: 'shopping_list_not_shared' });
  await expect(friend.data.removeFromShoppingList(towelsId, { listId })).rejects.toMatchObject({
    code: 'shopping_list_not_shared',
  });
  expect(view(await owner.data.getShoppingList())).toEqual([butterLine(false), garlicLine(false), towels(false)]);
});

test('the owner stops sharing: the Friend loses the list at once; stopping again says it was not shared', async () => {
  const { owner, friend, listId } = await sharedList();
  await friend.data.getShoppingList({ listId });

  expect(await owner.data.stopSharingShoppingList(friend.userId)).toEqual({ status: 'stopped' });
  expect(await owner.data.stopSharingShoppingList(friend.userId)).toEqual({ status: 'notShared' });

  expect(await owner.data.listShoppingListShares()).toEqual([]);
  expect(await friend.data.listSharedShoppingLists()).toEqual([]);
  await expect(friend.data.getShoppingList({ listId })).rejects.toMatchObject({ code: 'shopping_list_not_shared' });
  expect((await owner.data.getShoppingList()).sharedWith).toEqual([]);
});

test('the Friend leaves a list shared with them; leaving again says it was not shared', async () => {
  const { owner, friend, listId } = await sharedList();

  expect(await friend.data.leaveSharedShoppingList(listId)).toEqual({ status: 'left' });
  expect(await friend.data.leaveSharedShoppingList(listId)).toEqual({ status: 'notShared' });

  expect(await friend.data.listSharedShoppingLists()).toEqual([]);
  expect(await owner.data.listShoppingListShares()).toEqual([]);
  expect(view(await owner.data.getShoppingList())).toEqual([butterLine(false), garlicLine(false), towels(false)]);
});

test('unfriending ends sharing both ways; what the Friend added and checked stays, by "a former Friend"', async () => {
  const { owner, friend, listId } = await sharedList();
  expect(await friend.data.shareShoppingList(owner.userId)).toEqual({ status: 'shared' });
  const friendsListId = (await friend.data.getShoppingList()).id;
  await friend.data.addManualItem('Snacks', { listId });
  await friend.data.checkOff(named(await friend.data.getShoppingList({ listId }), 'garlic').id, { listId });

  await owner.data.unfriend(friend.userId);

  await expect(friend.data.getShoppingList({ listId })).rejects.toMatchObject({ code: 'shopping_list_not_shared' });
  await expect(owner.data.getShoppingList({ listId: friendsListId })).rejects.toMatchObject({ code: 'shopping_list_not_shared' });
  expect(await friend.data.listSharedShoppingLists()).toEqual([]);
  expect(await owner.data.listSharedShoppingLists()).toEqual([]);
  expect(await owner.data.listShoppingListShares()).toEqual([]);
  const after = await owner.data.getShoppingList();
  expect(view(after)).toEqual([
    butterLine(false),
    garlicLine(true),
    towels(false),
    { handAdded: 'Snacks', ingredient: null, checked: false },
  ]);
  // Checked by someone who is neither the owner nor shared with: a former Friend.
  expect(named(after, 'garlic').check).toMatchObject({ checkedBy: friend.userId });
  expect(after.sharedWith).toEqual([]);

  // Friends again: nothing is shared until the owner shares it again.
  await befriend(owner, friend);
  expect(await friend.data.listSharedShoppingLists()).toEqual([]);
  await expect(friend.data.getShoppingList({ listId })).rejects.toMatchObject({ code: 'shopping_list_not_shared' });
});

test('unfriending cuts access at once, even while the share rows are still there', async () => {
  const { owner, friend, listId } = await sharedList();
  const garlic = named(await friend.data.getShoppingList({ listId }), 'garlic');

  await endFriendshipBeforeCleanup(owner, friend);
  expect(await countShares(owner)).toBe(1);

  expect(await friend.data.listSharedShoppingLists()).toEqual([]);
  await expect(friend.data.getShoppingList({ listId })).rejects.toMatchObject({ code: 'shopping_list_not_shared' });
  await expect(friend.data.checkOff(garlic.id, { listId })).rejects.toMatchObject({ code: 'shopping_list_item_not_found' });
  await expect(friend.data.addManualItem('Snacks', { listId })).rejects.toMatchObject({ code: 'shopping_list_not_shared' });
  expect(await owner.data.listShoppingListShares()).toEqual([]);
  expect(view(await owner.data.getShoppingList())).toEqual([butterLine(false), garlicLine(false), towels(false)]);
  expect(await pantryNames(owner)).toEqual([]);
});

test('sharing on two phones at once shares once', async () => {
  const owner = await signInWithUsername('owner');
  const friend = await signInWithUsername('friend');
  await befriend(owner, friend);

  const held = await holdShare(owner, friend);
  const sharing = owner.data.shareShoppingList(friend.userId);
  await held.waitForWaiting(1);
  await held.commit();

  expect(await sharing).toEqual({ status: 'shared' });
  expect((await owner.data.listShoppingListShares()).map((s) => s.friend.id)).toEqual([friend.userId]);
});

test('stopping on two phones at once: one stops it, the other finds it not shared', async () => {
  const { owner, friend } = await sharedList();

  const held = await holdStopSharing(owner, friend);
  const stopping = owner.data.stopSharingShoppingList(friend.userId);
  await held.waitForWaiting(1);
  await held.commit();

  expect(await stopping).toEqual({ status: 'notShared' });
  expect(await owner.data.listShoppingListShares()).toEqual([]);
});

test('leaving on two phones at once: one leaves, the other finds it not shared', async () => {
  const { owner, friend, listId } = await sharedList();

  const held = await holdLeave(friend, listId);
  const leaving = friend.data.leaveSharedShoppingList(listId);
  await held.waitForWaiting(1);
  await held.commit();

  expect(await leaving).toEqual({ status: 'notShared' });
  expect(await owner.data.listShoppingListShares()).toEqual([]);
});

test('sharing while being unfriended waits for it, and then shares nothing', async () => {
  const owner = await signInWithUsername('owner');
  const friend = await signInWithUsername('friend');
  await befriend(owner, friend);

  const held = await holdUnfriend(friend, owner);
  const sharing = owner.data.shareShoppingList(friend.userId);
  await held.waitForWaiting(1);
  await held.commit();

  expect(await sharing).toEqual({ status: 'notFriends' });
  expect(await countShares(owner)).toBe(0);
  // Friends again later: still nothing shared.
  await befriend(owner, friend);
  expect(await friend.data.listSharedShoppingLists()).toEqual([]);
});

test('unfriending while a share is being made waits for it, and then ends it', async () => {
  const owner = await signInWithUsername('owner');
  const friend = await signInWithUsername('friend');
  await befriend(owner, friend);

  const held = await holdShare(owner, friend);
  const unfriending = friend.data.unfriend(owner.userId);
  await held.waitForWaiting(1);
  await held.commit();
  await unfriending;

  expect(await countShares(owner)).toBe(0);
  await befriend(owner, friend);
  expect(await friend.data.listSharedShoppingLists()).toEqual([]);
});

/** Every view a user's Shopping List screen would get, while watching a list. */
function watch(user: TestUser, listId?: ShoppingList['id']) {
  const views: ShoppingListView[] = [];
  const stop = user.data.watchShoppingList((v) => views.push(v), { listId });
  return { last: () => views[views.length - 1], stop };
}

const itemNames = (v: ShoppingListView | undefined) =>
  v?.status === 'loaded' ? v.list.items.map((i) => (i.kind === 'ingredient' ? i.ingredient.name : i.text)) : null;

test("live: the owner's changes reach a Friend watching the list, and the Friend's reach the owner, with no reading by hand", async () => {
  const { owner, friend, listId } = await sharedList();
  const friendScreen = watch(friend, listId);
  const ownerScreen = watch(owner);
  await vi.waitFor(() => expect(friendScreen.last()).toMatchObject({ status: 'loaded', live: true }), { timeout: 10_000 });
  await vi.waitFor(() => expect(ownerScreen.last()).toMatchObject({ status: 'loaded', live: true }), { timeout: 10_000 });

  await owner.data.addManualItem('Dish soap');
  await vi.waitFor(() => expect(itemNames(friendScreen.last())).toContain('Dish soap'), { timeout: 5_000 });

  await friend.data.addManualItem('Bananas', { listId });
  const towelsId = named(await friend.data.getShoppingList({ listId }), 'Paper towels').id;
  await owner.data.checkOff(towelsId);
  await vi.waitFor(() => expect(itemNames(ownerScreen.last())).toContain('Bananas'), { timeout: 5_000 });
  await vi.waitFor(() => {
    const shown = friendScreen.last();
    expect(shown?.status === 'loaded' && named(shown.list, 'Paper towels').check.status).toBe('checked');
  }, { timeout: 5_000 });
  friendScreen.stop();
  ownerScreen.stop();
});

test('live: when the owner stops sharing, a Friend watching the list is told it is not shared any more', async () => {
  const { owner, friend, listId } = await sharedList();
  const friendScreen = watch(friend, listId);
  await vi.waitFor(() => expect(friendScreen.last()).toMatchObject({ status: 'loaded', live: true }), { timeout: 10_000 });

  await owner.data.stopSharingShoppingList(friend.userId);

  await vi.waitFor(
    () =>
      expect(friendScreen.last()).toMatchObject({
        status: 'noLongerShared',
        ownerUsername: owner.username,
        changesNotSaved: 0,
      }),
    { timeout: 5_000 },
  );
  await friend.data.dismissNoLongerShared(listId);
  expect(await friend.data.listSharedShoppingLists()).toEqual([]);
  friendScreen.stop();
});

test('the people on a list: the owner and the Friends it is shared with, as each of them sees it', async () => {
  const { owner, friend, listId } = await sharedList();
  const second = await signInWithUsername('second');
  await befriend(owner, second);
  await owner.data.shareShoppingList(second.userId);

  const people = (list: ShoppingList) => ({
    owner: list.ownerUsername,
    sharedWith: list.sharedWith.map((p) => p.username).sort(),
  });
  const expected = { owner: owner.username, sharedWith: [friend.username, second.username].sort() };
  expect(people(await owner.data.getShoppingList())).toEqual(expected);
  expect(people(await friend.data.getShoppingList({ listId }))).toEqual(expected);
  expect(people(await second.data.getShoppingList({ listId }))).toEqual(expected);
  const ids: UserId[] = (await owner.data.getShoppingList()).sharedWith.map((p) => p.id).sort();
  expect(ids).toEqual([friend.userId, second.userId].sort());
});
