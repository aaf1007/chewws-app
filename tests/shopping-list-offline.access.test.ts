// Access-rule tests for the timestamped list changes of ticket 10: a stranger calls check_off,
// uncheck and add_manual_item directly, with change times of their choosing, as an attacker would.
// The checks inside those functions are what have to stop them; and nobody, the owner included,
// can stamp a change in the future to lock an item against later changes.
import { expect, test } from 'vitest';

import { signInAttacker } from './access-harness';

const longAgo = '2001-01-01T00:00:00Z';
const farFuture = '2999-01-01T00:00:00Z';

/** An owner whose list has garlic (unchecked), butter (checked off) and "Paper towels"; a stranger. */
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
  const [butter, garlic] = (await owner.data.getShoppingList()).items;
  await owner.data.checkOff(butter.id);
  const before = await owner.data.getShoppingList();

  async function expectOwnerListUnchanged() {
    expect(await owner.data.getShoppingList()).toEqual(before);
    expect((await owner.data.getPantry()).ingredients.map((i) => i.name)).toEqual(['butter']);
  }
  return { owner, stranger, garlic, butter, towelsId, expectOwnerListUnchanged };
}

test("a stranger's timestamped changes cannot check off, uncheck or take over someone else's items", async () => {
  const { stranger, garlic, butter, towelsId, expectOwnerListUnchanged } = await ownerListAndStranger();

  const results = [];
  for (const changedAt of [longAgo, new Date().toISOString(), farFuture]) {
    results.push(
      await stranger.client.rpc('check_off', { item_id: garlic.id, changed_at: changedAt }),
      await stranger.client.rpc('check_off', { item_id: towelsId, changed_at: changedAt }),
      await stranger.client.rpc('uncheck', { item_id: butter.id, changed_at: changedAt }),
    );
  }
  const takeId = await stranger.client.rpc('add_manual_item', {
    item_text: 'Snacks',
    ingredient_name: 'snack',
    item_id: towelsId,
    changed_at: farFuture,
  });

  for (const result of results) expect(result).toMatchObject({ data: false, error: null });
  expect(takeId).toMatchObject({ data: null, error: null });
  await expectOwnerListUnchanged();
  expect((await stranger.data.getShoppingList()).items).toEqual([]);
  expect((await stranger.data.getPantry()).ingredients).toEqual([]);
});

test('a change stamped in the future counts as made when it arrived, so it cannot lock an item', async () => {
  const { owner, garlic, towelsId } = await ownerListAndStranger();

  const checked = await owner.client.rpc('check_off', { item_id: garlic.id, changed_at: farFuture });
  const added = await owner.client.rpc('add_manual_item', {
    item_text: 'Foil',
    ingredient_name: 'foil',
    changed_at: farFuture,
  });
  expect(checked).toMatchObject({ data: true, error: null });
  expect(added.error).toBeNull();
  const soon = Date.now() + 60_000;
  for (const item of (await owner.data.getShoppingList()).items) {
    if (item.check.status === 'checked') expect(Date.parse(item.check.checkedAt)).toBeLessThan(soon);
  }

  // Changes made now still apply after it.
  await owner.data.uncheck(garlic.id);
  await owner.data.checkOff(towelsId);
  const list = await owner.data.getShoppingList();
  expect(list.items.map((i) => [i.kind === 'ingredient' ? i.ingredient.name : i.text, i.check.status])).toEqual([
    ['butter', 'checked'],
    ['Foil', 'unchecked'],
    ['garlic', 'unchecked'],
    ['Paper towels', 'checked'],
  ]);
});
