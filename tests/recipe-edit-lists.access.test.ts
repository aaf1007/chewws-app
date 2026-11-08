// Access-rule tests for ticket 21: an edit changes the lists its Recipe is on. A stranger, a Friend
// the owner's Shopping List is shared with, and a member of a plan the Recipe is in skip the data
// layer and call PostgREST directly with their own session, as an attacker would. Only the owner's
// update of the Recipe row passes RLS, so only the owner's edit reaches a list; and an edit lets
// nobody read anything of the Recipe they couldn't before. The add and remove rules stay written
// once: adding, removing and editing call the same functions.
import { expect, inject, test } from 'vitest';

import type { CookPlanList, ShoppingList } from '../src/data';
import type { Json } from '../src/data/database.types';
import { createTestClient, signInAttacker, type Attacker } from './access-harness';
import {
  cookPlanListFunctionsNotAskingMembership,
  functionsAskingTheRecipeReadRule,
  functionsReadingPantries,
  functionsRestatingTheRecipeReadRule,
  functionsWritingListAmounts,
  uniqueUsername,
} from './harness';

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

const shoppingView = (list: ShoppingList) =>
  list.items.map((item) =>
    item.kind === 'ingredient' ? [item.ingredient.name, ...item.recipes.flatMap((r) => [r.recipe.title, ...r.amountTexts])] : [item.text],
  );

const planView = (list: CookPlanList) =>
  list.items.map((item) => [item.ingredient.name, ...item.recipes.flatMap((r) => [r.recipe.title, ...r.amountTexts])]);

/** edit_recipe's arguments as an attacker would send them: the bread made theirs, with its list lines. */
const takeover = (recipeId: string) => ({
  recipe_id: recipeId,
  title: 'Mine now',
  steps: [],
  lines: [{ original_text: 'Caviar', amount_text: '1 tin', ingredient_name: 'caviar' }],
  list_lines: [{ ingredient_name: 'caviar', amount_texts: ['1 tin'] }],
});

/**
 * sam's Garlic bread (garlic, butter) is on his Shopping List, shared with amy, his Friend, and in
 * his plan with jo. stranger is nobody to them.
 */
async function setting() {
  const sam = await named('sam');
  const amy = await named('amy');
  const jo = await named('jo');
  const stranger = await named('stranger');
  await befriend(sam, amy);
  await befriend(sam, jo);
  const bread = await sam.data.createRecipe({
    title: 'Garlic bread',
    lines: [
      { originalText: '2 cloves garlic', amountText: '2 cloves', ingredientName: 'garlic' },
      { originalText: '4 tbsp butter', amountText: '4 tbsp', ingredientName: 'butter' },
    ],
    steps: ['Bake.'],
  });
  await sam.data.addRecipeToShoppingList(bread);
  expect(await sam.data.shareShoppingList(amy.userId)).toEqual({ status: 'shared' });
  const { planId } = await sam.data.createCookPlan({ cookOn: null, friends: [jo.userId] });
  expect(await sam.data.addRecipeToCookPlan(planId, bread)).toEqual({ status: 'added' });
  const listId = (await sam.data.getShoppingList()).id;
  return { sam, amy, jo, stranger, bread, planId, listId };
}

const listsBefore = {
  shopping: [
    ['butter', 'Garlic bread', '4 tbsp'],
    ['garlic', 'Garlic bread', '2 cloves'],
  ],
  plan: [
    ['butter', 'Garlic bread', '4 tbsp'],
    ['garlic', 'Garlic bread', '2 cloves'],
  ],
};

test("a stranger, a Friend on the shared list and a plan member can't edit the Recipe, so its lists don't change", async () => {
  const { sam, amy, jo, stranger, bread, planId } = await setting();

  for (const attacker of [stranger, amy, jo]) {
    expect(await attacker.client.rpc('edit_recipe', takeover(bread))).toMatchObject({ data: null, error: null });
  }

  const recipe = await sam.data.getRecipe(bread);
  expect([recipe?.title, recipe?.lines.map((l) => l.ingredient.name)]).toEqual(['Garlic bread', ['garlic', 'butter']]);
  expect(shoppingView(await sam.data.getShoppingList())).toEqual(listsBefore.shopping);
  expect(planView(await sam.data.getCookPlanList(planId))).toEqual(listsBefore.plan);
});

test('the owner’s edit must send list lines for exactly the edited Recipe’s Ingredients, or nothing changes', async () => {
  const { sam, bread, planId } = await setting();
  const edit = (listLines: Json | undefined) =>
    sam.client.rpc('edit_recipe', {
      recipe_id: bread,
      title: 'Garlic bread',
      steps: [],
      lines: [
        { original_text: '3 cloves garlic', amount_text: '3 cloves', ingredient_name: 'garlic' },
        { original_text: 'Paprika', amount_text: '1 tsp', ingredient_name: 'paprika' },
      ],
      list_lines: listLines,
    });

  for (const listLines of [
    undefined,
    [],
    [{ ingredient_name: 'garlic', amount_texts: ['3 cloves'] }],
    [
      { ingredient_name: 'garlic', amount_texts: ['3 cloves'] },
      { ingredient_name: 'paprika', amount_texts: ['1 tsp'] },
      { ingredient_name: 'caviar', amount_texts: ['1 tin'] },
    ],
    [
      { ingredient_name: 'garlic', amount_texts: ['3 cloves'] },
      { ingredient_name: 'garlic', amount_texts: ['1 clove'] },
      { ingredient_name: 'paprika', amount_texts: ['1 tsp'] },
    ],
  ]) {
    expect((await edit(listLines)).error, JSON.stringify(listLines)).toMatchObject({ code: '22023' });
  }

  expect((await sam.data.getRecipe(bread))?.lines.map((l) => l.amountText)).toEqual(['2 cloves', '4 tbsp']);
  expect(shoppingView(await sam.data.getShoppingList())).toEqual(listsBefore.shopping);
  expect(planView(await sam.data.getCookPlanList(planId))).toEqual(listsBefore.plan);
});

test('an edit gives nobody new read access: the Friend on the list and a stranger still read nothing of the Recipe', async () => {
  const { sam, amy, stranger, bread } = await setting();
  await sam.data.editRecipe(bread, {
    title: 'Garlic bread',
    lines: [{ originalText: 'Paprika', amountText: '1 tsp', ingredientName: 'paprika' }],
    steps: ['Bake hotter.'],
  });

  for (const outsider of [amy, stranger]) {
    expect(await outsider.client.from('recipes').select('id').eq('id', bread)).toMatchObject({ data: [], error: null });
    expect(await outsider.client.from('recipe_lines').select('id').eq('recipe_id', bread)).toMatchObject({ data: [], error: null });
    expect((await outsider.client.rpc('shared_recipe', { recipe_id: bread })).data).toEqual([]);
  }
  // The Friend on the list sees what the list shows, as before: the Recipe's title and amounts.
  expect(shoppingView(await amy.data.getShoppingList({ listId: (await sam.data.getShoppingList()).id }))).toEqual([
    ['paprika', 'Garlic bread', '1 tsp'],
  ]);
  expect(shoppingView(await stranger.data.getShoppingList())).toEqual([]);
});

test('the private edit functions are not exposed through the Data API', async () => {
  const { sam, bread, planId } = await setting();
  const { url, anonKey } = inject('supabase');
  const { data } = await sam.client.auth.getSession();
  const token = data.session?.access_token ?? '';
  for (const [fn, args] of [
    ['recipe_lines_edited', { recipe_id: bread, list_lines: [] }],
    ['put_recipe_on_shopping_list', { list: bread, recipe_id: bread, lines: [], editing: true }],
    ['put_recipe_on_cook_plan_list', { plan_id: planId, recipe_id: bread, recipe_title: 'x', lines: [] }],
    ['take_recipe_off_cook_plan_lines', { plan_id: planId, recipe_id: bread, keeping: [] }],
    ['check_recipe_list_lines', { recipe_id: bread, lines: [], whole: true }],
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
  expect((await anon.rpc('edit_recipe', takeover(bread))).error).toMatchObject({ code: '42501' });
});

test('the add and remove rules stay written once: adding, removing and editing share them; nothing restates who reads a Recipe or a Pantry', async () => {
  expect(await functionsWritingListAmounts()).toEqual([
    'private.put_recipe_on_cook_plan_list',
    'private.put_recipe_on_shopping_list',
    'private.take_recipe_off_cook_plan_lines',
    'public.remove_recipe_from_shopping_list',
  ]);
  expect(await cookPlanListFunctionsNotAskingMembership()).toEqual([]);
  expect(await functionsReadingPantries()).toEqual(['private.ingredients_had']);
  expect(await functionsRestatingTheRecipeReadRule()).toEqual([]);
  expect(await functionsAskingTheRecipeReadRule()).toEqual([
    'private.cook_plan_recipe_list',
    'public.copy_recipe',
    'public.recipe_titles',
    'public.shared_recipe',
  ]);
});
