// Ticket 21: editing a Recipe updates the lists it's on (user decision 1 of 2026-11-08), through
// the data layer as real signed-in users. After an edit, its owner's Shopping List (shared or not)
// and every active Cook Plan it's in look as if it had been taken off and put back, except that
// checked-off lines stay, and so do Claims, and a line other Recipes need keeps their amounts.
// Races hold one side in a second database session (CODING_STANDARDS.md).
import { expect, test, vi } from 'vitest';

import type {
  CookPlanList,
  CookPlanListView,
  DataLayer,
  RecipeId,
  ShoppingList,
  ShoppingListView,
  UserId,
} from '../src/data';
import {
  holdCookPlanCheckOff,
  holdCookPlanClaim,
  holdRecipeEdit,
  holdShoppingListLinesThenRecipeRemoval,
  holdShoppingListRecipeRemoval,
  markCookPlanCookedInDatabase,
  signInOnPhones,
  signInWithUsername,
  uniqueUsername,
  type TestPhone,
} from './harness';

type Someone = { userId: UserId; data: DataLayer; username: string };

async function befriend(a: Someone, b: Someone) {
  expect(await a.data.sendFriendRequest(b.userId)).toEqual({ status: 'requested' });
  expect(await b.data.respondToFriendRequest(a.userId, true)).toEqual({ status: 'accepted' });
}

const line = (text: string, amountText: string | null, ingredientName: string) => ({
  originalText: text,
  amountText,
  ingredientName,
});

/** Garlic bread before the edit: garlic, butter, parsley, chives, flour and milk. */
const breadBefore = [
  line('2 cloves garlic', '2 cloves', 'garlic'),
  line('4 tbsp butter', '4 tbsp', 'butter'),
  line('A handful of parsley', 'a handful', 'parsley'),
  line('Chives', '1 tbsp', 'chives'),
  line('1 cup flour', '1 cup', 'flour'),
  line('1 cup milk', '1 cup', 'milk'),
];

/**
 * After: garlic 3 cloves, butter 5 tbsp and milk kept; parsley, chives and flour dropped; paprika
 * (nobody has it), lemon (in the owner's Pantry) and salt (a Staple) added.
 */
const breadAfter = [
  line('3 cloves garlic', '3 cloves', 'garlic'),
  line('5 tbsp butter', '5 tbsp', 'butter'),
  line('1 cup milk', '1 cup', 'milk'),
  line('1 tsp paprika', '1 tsp', 'paprika'),
  line('Juice of a lemon', '1', 'lemon'),
  line('Salt', null, 'salt'),
];

/** Aglio e olio, which also needs garlic and chives. */
const aglio = [line('4 cloves garlic', '4 cloves', 'garlic'), line('Chives', '1 bunch', 'chives')];

/** The Shopping List as a user reads it: each line's name, its Recipes' amounts, and whether it's checked. */
const view = (list: ShoppingList) =>
  list.items.map((item) =>
    item.kind === 'ingredient'
      ? {
          ingredient: item.ingredient.name,
          recipes: item.recipes.map((r) => [r.recipe.title, ...r.amountTexts]),
          checked: item.check.status === 'checked',
        }
      : { handAdded: item.text, checked: item.check.status === 'checked' },
  );

const named = (list: ShoppingList, name: string) => {
  const found = list.items.find((i) => i.kind === 'ingredient' && i.ingredient.name === name);
  if (!found) throw new Error(`${name} is not on the Shopping List`);
  return found.id;
};

const pantryNames = async (user: { data: DataLayer }) => (await user.data.getPantry()).ingredients.map((i) => i.name);

/**
 * The owner's Shopping List with Garlic bread and Aglio e olio on it, shared with a Friend. The
 * butter and flour are checked off (so in the Pantry); milk and lemon went into the Pantry after
 * the bread was added.
 */
async function shoppingList() {
  const owner = await signInWithUsername('owner');
  const friend = await signInWithUsername('friend');
  await befriend(owner, friend);
  const bread = await owner.data.createRecipe({ title: 'Garlic bread', lines: breadBefore, steps: [] });
  const pasta = await owner.data.createRecipe({ title: 'Aglio e olio', lines: aglio, steps: [] });
  await owner.data.addRecipeToShoppingList(bread);
  await owner.data.addRecipeToShoppingList(pasta);
  const before = await owner.data.getShoppingList();
  await owner.data.checkOff(named(before, 'butter'));
  await owner.data.checkOff(named(before, 'flour'));
  await owner.data.addToPantry('milk');
  await owner.data.addToPantry('lemon');
  expect(await owner.data.shareShoppingList(friend.userId)).toEqual({ status: 'shared' });
  return { owner, friend, bread, pasta, listId: before.id };
}

/** The list after the bread's edit, as everyone who can use it reads it. */
const editedShoppingList = [
  { ingredient: 'butter', recipes: [['Garlic bread', '5 tbsp']], checked: true },
  { ingredient: 'chive', recipes: [['Aglio e olio', '1 bunch']], checked: false },
  { ingredient: 'flour', recipes: [], checked: true },
  { ingredient: 'garlic', recipes: [['Garlic bread', '3 cloves'], ['Aglio e olio', '4 cloves']], checked: false },
  { ingredient: 'paprika', recipes: [['Garlic bread', '1 tsp']], checked: false },
];

test('an edit changes its Recipe’s lines on the Shopping List: new ones join or are made, amounts change, dropped ones leave', async () => {
  const { owner, friend, bread, listId } = await shoppingList();
  expect(view(await owner.data.getShoppingList())).toEqual([
    { ingredient: 'butter', recipes: [['Garlic bread', '4 tbsp']], checked: true },
    { ingredient: 'chive', recipes: [['Garlic bread', '1 tbsp'], ['Aglio e olio', '1 bunch']], checked: false },
    { ingredient: 'flour', recipes: [['Garlic bread', '1 cup']], checked: true },
    { ingredient: 'garlic', recipes: [['Garlic bread', '2 cloves'], ['Aglio e olio', '4 cloves']], checked: false },
    { ingredient: 'milk', recipes: [['Garlic bread', '1 cup']], checked: false },
    { ingredient: 'parsley', recipes: [['Garlic bread', 'a handful']], checked: false },
  ]);

  await owner.data.editRecipe(bread, { title: 'Garlic bread', lines: breadAfter, steps: [] });

  // Parsley, which only the bread needed, goes; the chives stay for the pasta. Garlic and butter
  // take the new amounts; butter and flour, checked off, stay checked (flour without the bread).
  // Paprika joins; lemon (in the Pantry) and salt (a Staple) don't, and milk, in the Pantry since
  // the bread was added, leaves, as when adding.
  expect(view(await owner.data.getShoppingList())).toEqual(editedShoppingList);
  expect(view(await friend.data.getShoppingList({ listId }))).toEqual(editedShoppingList);
  expect(await pantryNames(owner)).toEqual(['butter', 'flour', 'lemon', 'milk']);
});

test('an edit puts nothing back on the list for a Recipe taken off it, or never on it', async () => {
  const owner = await signInWithUsername('owner');
  const bread = await owner.data.createRecipe({ title: 'Garlic bread', lines: breadBefore, steps: [] });
  const pasta = await owner.data.createRecipe({ title: 'Aglio e olio', lines: aglio, steps: [] });
  await owner.data.addRecipeToShoppingList(bread);
  await owner.data.removeRecipeFromShoppingList(bread);

  await owner.data.editRecipe(bread, { title: 'Garlic bread', lines: breadAfter, steps: [] });
  await owner.data.editRecipe(pasta, { title: 'Aglio e olio', lines: [...aglio, line('Parsley', null, 'parsley')], steps: [] });

  expect(view(await owner.data.getShoppingList())).toEqual([]);
});

/**
 * sam's plan with jo and kim, his Friends: his Garlic bread and jo's Aglio e olio. jo has claimed
 * the parsley and checked off the butter. sam has a second plan with the bread, cooked.
 */
async function plan() {
  const sam = await signInWithUsername('sam');
  const jo = await signInWithUsername('jo');
  const kim = await signInWithUsername('kim');
  await befriend(sam, jo);
  await befriend(sam, kim);
  const { planId } = await sam.data.createCookPlan({ cookOn: null, friends: [jo.userId, kim.userId] });
  const bread = await sam.data.createRecipe({ title: 'Garlic bread', lines: breadBefore, steps: [] });
  const pasta = await jo.data.createRecipe({ title: 'Aglio e olio', lines: aglio, steps: [] });
  expect(await sam.data.addRecipeToCookPlan(planId, bread)).toEqual({ status: 'added' });
  expect(await jo.data.addRecipeToCookPlan(planId, pasta)).toEqual({ status: 'added' });
  const cooked = (await sam.data.createCookPlan({ cookOn: null, friends: [jo.userId] })).planId;
  expect(await sam.data.addRecipeToCookPlan(cooked, bread)).toEqual({ status: 'added' });
  await markCookPlanCookedInDatabase(cooked, sam);
  const usernames = new Map<UserId | null, string>([
    [sam.userId, sam.username],
    [jo.userId, jo.username],
    [kim.userId, kim.username],
  ]);
  return { sam, jo, kim, planId, cooked, bread, pasta, usernames };
}

const planLine = (list: CookPlanList, name: string) => {
  const found = list.items.find((i) => i.ingredient.name === name);
  if (!found) throw new Error(`${name} is not on the list`);
  return found.id;
};

/** A plan's list as a member reads it: each line, its Recipes' amounts, who claimed and checked it. */
function readPlan(list: CookPlanList, usernames: Map<UserId | null, string>) {
  const who = (id: UserId | null) => usernames.get(id) ?? 'a former member';
  return list.items.map((item) => ({
    line: item.ingredient.name,
    amounts: item.recipes.map(({ recipe, amountTexts }) => [
      recipe.status === 'removed' ? `${recipe.title} (removed)` : recipe.title,
      ...amountTexts,
    ]),
    claimedBy: item.claim.status === 'claimed' ? who(item.claim.claimedBy) : null,
    checkedBy: item.check.status === 'checked' ? who(item.check.checkedBy) : null,
  }));
}

const untouchedLine = (name: string, amounts: string[][]) => ({ line: name, amounts, claimedBy: null, checkedBy: null });

/** The cooked plan's list: the bread as it was added, never edited. */
const cookedPlanList = [
  untouchedLine('butter', [['Garlic bread', '4 tbsp']]),
  untouchedLine('chive', [['Garlic bread', '1 tbsp']]),
  untouchedLine('flour', [['Garlic bread', '1 cup']]),
  untouchedLine('garlic', [['Garlic bread', '2 cloves']]),
  untouchedLine('milk', [['Garlic bread', '1 cup']]),
  untouchedLine('parsley', [['Garlic bread', 'a handful']]),
];

test('every active Cook Plan the Recipe is in follows the edit; Claims and checked-off lines stay; cooked plans and copies don’t change', async () => {
  const { sam, jo, kim, planId, cooked, bread, usernames } = await plan();
  const before = await jo.data.getCookPlanList(planId);
  await jo.data.claim(planId, planLine(before, 'parsley'));
  await jo.data.checkOffCookPlanItem(planId, planLine(before, 'butter'));
  const copy = await jo.data.copyRecipe(bread);
  if (copy.status !== 'copied') throw new Error(`Couldn't copy: ${copy.status}`);
  const copyLines = (await jo.data.getRecipe(copy.recipeId))?.lines.map((l) => [l.ingredient.name, l.amountText]);

  await sam.data.editRecipe(bread, { title: 'Cheesy garlic bread', lines: breadAfter, steps: [] });

  // No Pantry skip on a plan: lemon and salt join. The claimed parsley stays, the bread's amount
  // "(removed)"; flour, nobody's, goes; the chives stay for the pasta.
  const edited = [
    { line: 'butter', amounts: [['Cheesy garlic bread', '5 tbsp']], claimedBy: null, checkedBy: jo.username },
    untouchedLine('chive', [['Aglio e olio', '1 bunch']]),
    untouchedLine('garlic', [['Cheesy garlic bread', '3 cloves'], ['Aglio e olio', '4 cloves']]),
    untouchedLine('lemon', [['Cheesy garlic bread', '1']]),
    untouchedLine('milk', [['Cheesy garlic bread', '1 cup']]),
    untouchedLine('paprika', [['Cheesy garlic bread', '1 tsp']]),
    { line: 'parsley', amounts: [['Garlic bread (removed)', 'a handful']], claimedBy: jo.username, checkedBy: null },
    untouchedLine('salt', [['Cheesy garlic bread']]),
  ];
  for (const member of [sam, jo, kim]) {
    expect(readPlan(await member.data.getCookPlanList(planId), usernames)).toEqual(edited);
  }
  expect(readPlan(await jo.data.getCookPlanList(cooked), usernames)).toEqual(cookedPlanList);
  expect((await jo.data.getRecipe(copy.recipeId))?.lines.map((l) => [l.ingredient.name, l.amountText])).toEqual(copyLines);
});

test('the owner who left the plan still edits their Recipe in it, and the plan’s list follows', async () => {
  const { sam, jo, planId, bread, usernames } = await plan();
  expect(await sam.data.leaveCookPlan(planId)).toMatchObject({ status: 'left' });

  await sam.data.editRecipe(bread, { title: 'Garlic bread', lines: [line('3 cloves garlic', '3 cloves', 'garlic')], steps: [] });

  expect(readPlan(await jo.data.getCookPlanList(planId), usernames)).toEqual([
    untouchedLine('chive', [['Aglio e olio', '1 bunch']]),
    untouchedLine('garlic', [['Garlic bread', '3 cloves'], ['Aglio e olio', '4 cloves']]),
  ]);
});

// Races --------------------------------------------------------------------------------------------

test('an edit while a line it drops is being checked off waits: the line stays checked, the amount "(removed)", and the Pantry gets it', async () => {
  const { sam, jo, planId, bread, usernames } = await plan();
  const flour = planLine(await jo.data.getCookPlanList(planId), 'flour');

  // jo checks the flour off in the shop, not committed yet; sam's edit, dropping it, waits.
  const held = await holdCookPlanCheckOff(jo, planId, flour);
  const editing = sam.data.editRecipe(bread, { title: 'Garlic bread', lines: breadAfter, steps: [] });
  await held.waitForWaiting(1);
  await held.commit();
  await editing;

  expect(readPlan(await sam.data.getCookPlanList(planId), usernames).find((l) => l.line === 'flour')).toEqual({
    line: 'flour',
    amounts: [['Garlic bread (removed)', '1 cup']],
    claimedBy: null,
    checkedBy: jo.username,
  });
  expect(await pantryNames(jo)).toEqual(['flour']);
});

test('an edit while a line it drops is being claimed waits: the Claim lands and the line stays, the amount "(removed)"', async () => {
  const { sam, jo, planId, bread, usernames } = await plan();
  const flour = planLine(await jo.data.getCookPlanList(planId), 'flour');

  const held = await holdCookPlanClaim(jo, planId, flour, new Date());
  const editing = sam.data.editRecipe(bread, { title: 'Garlic bread', lines: breadAfter, steps: [] });
  await held.waitForWaiting(1);
  await held.commit();
  await editing;

  expect(readPlan(await sam.data.getCookPlanList(planId), usernames).find((l) => l.line === 'flour')).toEqual({
    line: 'flour',
    amounts: [['Garlic bread (removed)', '1 cup']],
    claimedBy: jo.username,
    checkedBy: null,
  });
});

test('an edit while the Recipe is being taken off the Shopping List waits, and puts none of it back', async () => {
  const owner = await signInWithUsername('owner');
  const bread = await owner.data.createRecipe({ title: 'Garlic bread', lines: breadBefore, steps: [] });
  const pasta = await owner.data.createRecipe({ title: 'Aglio e olio', lines: aglio, steps: [] });
  await owner.data.addRecipeToShoppingList(bread);
  await owner.data.addRecipeToShoppingList(pasta);

  // The owner takes the bread off on their other phone, not committed yet; this phone's edit waits.
  const held = await holdShoppingListRecipeRemoval(owner, bread);
  const editing = owner.data.editRecipe(bread, { title: 'Garlic bread', lines: breadAfter, steps: [] });
  await held.waitForWaiting(1);
  await held.commit();
  await editing;

  expect(view(await owner.data.getShoppingList())).toEqual([
    { ingredient: 'chive', recipes: [['Aglio e olio', '1 bunch']], checked: false },
    { ingredient: 'garlic', recipes: [['Aglio e olio', '4 cloves']], checked: false },
  ]);
});

test('two edits at once, each dropping a line both Recipes needed: the second waits, and the line goes', async () => {
  const { sam, jo, planId, bread, pasta, usernames } = await plan();

  // jo's edit of her pasta drops the chives on her phone, not committed yet; sam's of his bread,
  // dropping them too, waits for it.
  const held = await holdRecipeEdit(jo, pasta, 'Aglio e olio', [line('4 cloves garlic', '4 cloves', 'garlic')]);
  const editing = sam.data.editRecipe(bread, { title: 'Garlic bread', lines: breadAfter, steps: [] });
  await held.waitForWaiting(1);
  await held.commit();
  await editing;

  const list = readPlan(await jo.data.getCookPlanList(planId), usernames);
  expect(list.map((l) => l.line)).toEqual(['butter', 'garlic', 'lemon', 'milk', 'paprika', 'salt']);
  expect(list.find((l) => l.line === 'garlic')?.amounts).toEqual([['Garlic bread', '3 cloves'], ['Aglio e olio', '4 cloves']]);
});

test('an edit that renames the Recipe while it’s being taken off the Shopping List waits for the removal, and neither deadlocks', async () => {
  const owner = await signInWithUsername('owner');
  const bread = await owner.data.createRecipe({ title: 'Garlic bread', lines: breadBefore, steps: [] });
  const pasta = await owner.data.createRecipe({ title: 'Aglio e olio', lines: aglio, steps: [] });
  await owner.data.addRecipeToShoppingList(bread);
  await owner.data.addRecipeToShoppingList(pasta);
  const breadLines = (await owner.data.getShoppingList()).items
    .filter((i) => i.kind === 'ingredient' && i.recipes.some((r) => r.recipe.id === bread))
    .map((i) => i.id);

  // The owner's other phone has locked the bread's lines to take it off, and is about to reach for
  // its amounts; this phone's edit renames it, which renames its amounts on the list.
  const held = await holdShoppingListLinesThenRecipeRemoval(owner, breadLines, bread);
  const editing = owner.data.editRecipe(bread, { title: 'Cheesy garlic bread', lines: breadAfter, steps: [] });
  await held.waitForWaiting(1);
  await held.finish();
  await editing;

  expect(view(await owner.data.getShoppingList())).toEqual([
    { ingredient: 'chive', recipes: [['Aglio e olio', '1 bunch']], checked: false },
    { ingredient: 'garlic', recipes: [['Aglio e olio', '4 cloves']], checked: false },
  ]);
});

test('an edit that renames the Recipe and adds an Ingredient takes that Ingredient’s line in id order with the rest, so a removal holding it doesn’t deadlock', async () => {
  const owner = await signInWithUsername('owner');
  const pasta = await owner.data.createRecipe({ title: 'Aglio e olio', lines: aglio, steps: [] });
  await owner.data.addRecipeToShoppingList(pasta);
  // Of the pasta's two lines, the bread is on the later one (by id), and the edit adds the earlier.
  const [first, later] = (await owner.data.getShoppingList()).items
    .flatMap((i) => (i.kind === 'ingredient' ? [{ id: i.id, name: i.ingredient.name }] : []))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const lineFor = (name: string) =>
    name === 'garlic' ? line('3 cloves garlic', '3 cloves', 'garlic') : line('Chives', '1 tbsp', 'chives');
  const butter = line('4 tbsp butter', '4 tbsp', 'butter');
  const bread = await owner.data.createRecipe({ title: 'Garlic bread', lines: [lineFor(later.name), butter], steps: [] });
  await owner.data.addRecipeToShoppingList(bread);

  // The other phone takes the pasta off and has locked the earlier line so far; the edit, which
  // now needs that line too, waits for it before taking any other.
  const held = await holdShoppingListLinesThenRecipeRemoval(owner, [first.id], pasta);
  const editing = owner.data.editRecipe(bread, {
    title: 'Cheesy garlic bread',
    lines: [lineFor(later.name), butter, lineFor(first.name)],
    steps: [],
  });
  await held.waitForWaiting(1);
  await held.finish();
  await editing;

  expect(view(await owner.data.getShoppingList())).toEqual([
    { ingredient: 'butter', recipes: [['Cheesy garlic bread', '4 tbsp']], checked: false },
    { ingredient: 'chive', recipes: [['Cheesy garlic bread', '1 tbsp']], checked: false },
    { ingredient: 'garlic', recipes: [['Cheesy garlic bread', '3 cloves']], checked: false },
  ]);
});

// Live and offline ---------------------------------------------------------------------------------

test('live: an edit reaches a Friend watching the shared Shopping List and a member watching the plan’s list, with no reading by hand', async () => {
  const { owner: sam, friend, bread, listId } = await shoppingList();
  const jo = await signInWithUsername('jo');
  await befriend(sam, jo);
  const { planId } = await sam.data.createCookPlan({ cookOn: null, friends: [jo.userId] });
  expect(await sam.data.addRecipeToCookPlan(planId, bread)).toEqual({ status: 'added' });

  const shopping: ShoppingListView[] = [];
  const planViews: CookPlanListView[] = [];
  const stops = [
    friend.data.watchShoppingList((v) => shopping.push(v), { listId }),
    jo.data.watchCookPlanList(planId, (v) => planViews.push(v)),
  ];
  const lastOf = <V>(views: V[]) => views[views.length - 1];
  await vi.waitFor(() => expect(lastOf(shopping)).toMatchObject({ status: 'loaded', live: true }), { timeout: 10_000 });
  await vi.waitFor(() => expect(lastOf(planViews)).toMatchObject({ status: 'loaded', live: true }), { timeout: 10_000 });

  await sam.data.editRecipe(bread, { title: 'Garlic bread', lines: breadAfter, steps: [] });

  await vi.waitFor(() => {
    const shown = lastOf(shopping);
    expect(shown?.status === 'loaded' ? view(shown.list) : null).toEqual(editedShoppingList);
  }, { timeout: 5_000 });
  await vi.waitFor(() => {
    const shown = lastOf(planViews);
    expect(shown?.status === 'loaded' ? shown.list.items.map((i) => i.ingredient.name) : null).toEqual([
      'butter', 'garlic', 'lemon', 'milk', 'paprika', 'salt',
    ]);
  }, { timeout: 5_000 });
  for (const stop of stops) stop();
});

/** A user signed in on one phone (with its own clock and signal), with a username. */
async function phoneWithUsername(label: string): Promise<TestPhone & { username: string }> {
  const [phone] = await signInOnPhones(label, 1);
  const username = uniqueUsername(label);
  const chosen = await phone.data.setUsername(username);
  if (chosen.status !== 'set') throw new Error(`Couldn't choose a username: ${chosen.status}`);
  return { ...phone, username };
}

test('offline: a check-off queued for a Shopping List line an edit deleted meanwhile is dropped as gone', async () => {
  const [phone, other] = await signInOnPhones('owner', 2);
  const bread: RecipeId = await other.data.createRecipe({ title: 'Garlic bread', lines: breadBefore, steps: [] });
  await other.data.addRecipeToShoppingList(bread);
  const parsley = named(await phone.data.getShoppingList(), 'parsley');
  phone.goOffline();
  await phone.data.checkOff(parsley);

  await other.data.editRecipe(bread, { title: 'Garlic bread', lines: breadAfter, steps: [] });
  phone.goOnline();

  expect(await phone.data.syncListChanges()).toEqual({ status: 'idle', waiting: 0 });
  const edited = [
    { ingredient: 'butter', recipes: [['Garlic bread', '5 tbsp']], checked: false },
    { ingredient: 'garlic', recipes: [['Garlic bread', '3 cloves']], checked: false },
    { ingredient: 'lemon', recipes: [['Garlic bread', '1']], checked: false },
    { ingredient: 'milk', recipes: [['Garlic bread', '1 cup']], checked: false },
    { ingredient: 'paprika', recipes: [['Garlic bread', '1 tsp']], checked: false },
  ];
  expect(view(await phone.data.getShoppingList())).toEqual(edited);
  expect(view(await other.data.getShoppingList())).toEqual(edited);
  expect(await pantryNames(other)).toEqual([]);
});

test('offline: a check-off queued for a Cook Plan line an edit deleted meanwhile is dropped as gone', async () => {
  const sam = await signInWithUsername('sam');
  const jo = await phoneWithUsername('jo');
  await befriend(sam, jo);
  const { planId } = await sam.data.createCookPlan({ cookOn: null, friends: [jo.userId] });
  const bread = await sam.data.createRecipe({ title: 'Garlic bread', lines: breadBefore, steps: [] });
  expect(await sam.data.addRecipeToCookPlan(planId, bread)).toEqual({ status: 'added' });
  const flour = planLine(await jo.data.getCookPlanList(planId), 'flour');
  jo.goOffline();
  await jo.data.checkOffCookPlanItem(planId, flour);

  await sam.data.editRecipe(bread, { title: 'Garlic bread', lines: breadAfter, steps: [] });
  jo.goOnline();

  expect(await jo.data.syncListChanges()).toEqual({ status: 'idle', waiting: 0 });
  const names = (await jo.data.getCookPlanList(planId)).items.map((i) => i.ingredient.name);
  expect(names).toEqual(['butter', 'garlic', 'lemon', 'milk', 'paprika', 'salt']);
  expect(await pantryNames(jo)).toEqual([]);
});
