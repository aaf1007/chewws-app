// Access-rule tests for Shopping Lists: a stranger skips the data layer and calls PostgREST directly
// with the anon key and their own session, as an attacker would. RLS, the table grants and the
// checks inside the list functions are what have to stop them.
import { expect, inject, test } from 'vitest';

import { signInAttacker, type Attacker } from './access-harness';

/**
 * An owner whose Shopping List has garlic (unchecked) and butter (checked off, so in their Pantry)
 * from a Recipe, plus "Paper towels" by hand; and a stranger.
 */
async function ownerListAndStranger() {
  const owner = await signInAttacker('owner');
  const stranger = await signInAttacker('stranger');
  const recipeId = await owner.data.createRecipe({
    title: 'Garlic bread',
    lines: [
      { originalText: '2 cloves garlic', amountText: '2 cloves', ingredientName: 'garlic' },
      { originalText: '4 tbsp butter', amountText: '4 tbsp', ingredientName: 'butter' },
    ],
    steps: [],
  });
  await owner.data.addRecipeToShoppingList(recipeId);
  const towelsId = await owner.data.addManualItem('Paper towels');
  const list = await owner.data.getShoppingList();
  const [butter, garlic] = list.items;
  if (butter.kind !== 'ingredient' || garlic.kind !== 'ingredient') throw new Error('unexpected list');
  await owner.data.checkOff(butter.id);
  const before = await owner.data.getShoppingList();

  async function expectOwnerListUnchanged() {
    const now = await owner.data.getShoppingList();
    expect(now).toEqual(before);
    expect(
      now.items.map((i) => [i.kind === 'ingredient' ? i.ingredient.name : i.text, i.check.status]),
    ).toEqual([
      ['butter', 'checked'],
      ['garlic', 'unchecked'],
      ['Paper towels', 'unchecked'],
    ]);
    expect((await owner.data.getPantry()).ingredients.map((i) => i.name)).toEqual(['butter']);
  }

  return {
    owner,
    listId: list.id,
    recipeId,
    garlic,
    butter,
    towelsId,
    stranger: stranger.client,
    strangerAttacker: stranger,
    expectOwnerListUnchanged,
  };
}

/** Calls a function through PostgREST as this user, bypassing the typed client. */
async function callRpc(user: Attacker, name: string, args: object, schema = 'public') {
  const { url, anonKey } = inject('supabase');
  const { data } = await user.client.auth.getSession();
  if (!data.session) throw new Error('not signed in');
  const res = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${data.session.access_token}`,
      'Content-Type': 'application/json',
      'Content-Profile': schema,
    },
    body: JSON.stringify(args),
  });
  return { status: res.status, body: await res.json() };
}

test("a stranger cannot read someone else's Shopping List, its items or their Recipe amounts", async () => {
  const { owner, listId, recipeId, garlic, stranger, expectOwnerListUnchanged } = await ownerListAndStranger();

  const lists = await stranger.from('shopping_lists').select('*').eq('owner_id', owner.userId);
  const listById = await stranger.from('shopping_lists').select('*').eq('id', listId);
  const items = await stranger.from('shopping_list_items').select('*').eq('list_id', listId);
  const itemById = await stranger.from('shopping_list_items').select('*').eq('id', garlic.id);
  const amountsByItem = await stranger.from('shopping_list_amounts').select('*').eq('item_id', garlic.id);
  const amountsByRecipe = await stranger.from('shopping_list_amounts').select('*').eq('recipe_id', recipeId);

  for (const result of [lists, listById, items, itemById, amountsByItem, amountsByRecipe]) {
    expect(result).toMatchObject({ data: [], error: null });
  }
  await expectOwnerListUnchanged();
});

test('nobody writes list rows directly: a stranger cannot add to, and nobody can check off around, the Pantry rule', async () => {
  const { owner, listId, recipeId, garlic, stranger, strangerAttacker, expectOwnerListUnchanged } =
    await ownerListAndStranger();
  const strangerList = await strangerAttacker.data.getShoppingList();

  const list = await stranger.from('shopping_lists').insert({ owner_id: owner.userId });
  const item = await stranger.from('shopping_list_items').insert({ list_id: listId, hand_added_text: 'Snacks' });
  const ownItem = await stranger
    .from('shopping_list_items')
    .insert({ list_id: strangerList.id, hand_added_text: 'Snacks', checked_at: new Date().toISOString() });
  const amount = await stranger.from('shopping_list_amounts').insert({ item_id: garlic.id, recipe_id: recipeId });

  for (const result of [list, item, ownItem, amount]) {
    expect(result.error).toMatchObject({ code: '42501' });
  }
  await expectOwnerListUnchanged();
  expect((await strangerAttacker.data.getShoppingList()).items).toEqual([]);
});

test("a stranger cannot change someone else's Shopping List rows, and nobody updates them directly", async () => {
  const { owner, listId, garlic, butter, stranger, expectOwnerListUnchanged } = await ownerListAndStranger();
  const now = new Date().toISOString();

  const list = await stranger.from('shopping_lists').update({ owner_id: owner.userId }).eq('id', listId).select();
  const checked = await stranger.from('shopping_list_items').update({ checked_at: now }).eq('id', garlic.id).select();
  const unchecked = await stranger.from('shopping_list_items').update({ checked_at: null }).eq('id', butter.id).select();
  const amounts = await stranger
    .from('shopping_list_amounts')
    .update({ amount_texts: ['1 kg'] })
    .eq('item_id', garlic.id)
    .select();
  // Even the owner can't check an item off directly, skipping their Pantry.
  const ownCheck = await owner.client.from('shopping_list_items').update({ checked_at: now }).eq('id', garlic.id).select();

  for (const result of [list, checked, unchecked, amounts, ownCheck]) {
    expect(result).toMatchObject({ data: null, error: { code: '42501' } });
  }
  await expectOwnerListUnchanged();
});

test("a stranger cannot remove someone else's items, Recipe amounts or Shopping List", async () => {
  const { listId, recipeId, garlic, towelsId, stranger, expectOwnerListUnchanged } = await ownerListAndStranger();

  const item = await stranger.from('shopping_list_items').delete().eq('id', towelsId).select();
  const items = await stranger.from('shopping_list_items').delete().eq('list_id', listId).select();
  const amounts = await stranger.from('shopping_list_amounts').delete().eq('item_id', garlic.id).select();
  const byRecipe = await stranger.from('shopping_list_amounts').delete().eq('recipe_id', recipeId).select();
  const list = await stranger.from('shopping_lists').delete().eq('id', listId).select();

  for (const result of [item, items, amounts, byRecipe]) {
    expect(result).toMatchObject({ data: [], error: null });
  }
  expect(list).toMatchObject({ data: null, error: { code: '42501' } });
  await expectOwnerListUnchanged();
});

test("a stranger's list functions cannot touch someone else's list or Pantry", async () => {
  const { recipeId, garlic, butter, towelsId, stranger, strangerAttacker, expectOwnerListUnchanged } =
    await ownerListAndStranger();

  const checkOff = await stranger.rpc('check_off', { item_id: garlic.id });
  const uncheck = await stranger.rpc('uncheck', { item_id: butter.id });
  const addRecipe = await stranger.rpc('add_recipe_to_shopping_list', {
    recipe_id: recipeId,
    lines: [{ ingredient_id: garlic.ingredient.id, amount_texts: ['1 kg'] }],
  });
  const takeId = await stranger.rpc('add_manual_item', {
    item_text: 'Snacks',
    ingredient_name: 'snack',
    item_id: towelsId,
  });
  const removeRecipe = await stranger.rpc('remove_recipe_from_shopping_list', { recipe_id: recipeId });

  expect(checkOff).toMatchObject({ data: 'gone', error: null });
  expect(uncheck).toMatchObject({ data: 'gone', error: null });
  expect(addRecipe).toMatchObject({ data: null, error: null });
  expect(takeId).toMatchObject({ data: 'taken', error: null });
  expect(removeRecipe.error).toBeNull();
  await expectOwnerListUnchanged();
  // And none of it landed on the stranger's own list or Pantry.
  expect((await strangerAttacker.data.getShoppingList()).items).toEqual([]);
  expect((await strangerAttacker.data.getPantry()).ingredients).toEqual([]);
});

test("adding a Recipe can't put an Ingredient on the list that the Recipe doesn't have, even the owner's own", async () => {
  const { owner, recipeId, garlic, expectOwnerListUnchanged } = await ownerListAndStranger();
  const onion = await owner.data.createRecipe({
    title: 'Onion soup',
    lines: [{ originalText: '6 onions', amountText: '6', ingredientName: 'onion' }],
    steps: [],
  });
  const onionId = (await owner.data.getRecipe(onion))?.lines[0].ingredient.id;

  const added = await owner.client.rpc('add_recipe_to_shopping_list', {
    recipe_id: recipeId,
    lines: [
      { ingredient_id: garlic.ingredient.id, amount_texts: ['2 cloves'] },
      { ingredient_id: onionId, amount_texts: ['1 kg'] },
    ],
  });

  expect(added).toMatchObject({ data: null, error: { code: '22023' } });
  await expectOwnerListUnchanged();
});

test('the shared list rules are not exposed through the Data API', async () => {
  const { listId, strangerAttacker, expectOwnerListUnchanged } = await ownerListAndStranger();

  const canUse = await callRpc(strangerAttacker, 'can_use_shopping_list', { list_id: listId }, 'private');
  const mine = await callRpc(strangerAttacker, 'my_shopping_list', {}, 'private');
  const publicCanUse = await callRpc(strangerAttacker, 'can_use_shopping_list', { list_id: listId });

  expect(canUse).toMatchObject({ status: 406, body: { code: 'PGRST106' } });
  expect(mine).toMatchObject({ status: 406, body: { code: 'PGRST106' } });
  expect(publicCanUse).toMatchObject({ status: 404, body: { code: 'PGRST202' } });
  await expectOwnerListUnchanged();
});
