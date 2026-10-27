// Access-rule tests for Ingredients, which are global: any signed-in user can read and add one,
// nobody can rename or remove one. A user skips the data layer and calls PostgREST directly.
import { randomUUID } from 'node:crypto';

import { expect, test } from 'vitest';

import { signInAttacker } from './access-harness';

/** A name no other test uses, so this test's Ingredient is its own. */
const uniqueName = () => `saffron ${randomUUID().replaceAll('-', '')}`;

test("a signed-in user cannot rename an Ingredient under someone else's Recipe", async () => {
  const owner = await signInAttacker('owner');
  const other = await signInAttacker('other');
  const name = uniqueName();
  const recipeId = await owner.data.createRecipe({
    title: 'Paella',
    lines: [{ originalText: 'a pinch of saffron', ingredientName: name }],
    steps: [],
  });
  const [line] = (await owner.data.getRecipe(recipeId))?.lines ?? [];
  expect(line.ingredient.name).toBe(name);

  const { data, error } = await other.client
    .from('ingredients')
    .update({ name: 'pickle' })
    .eq('id', line.ingredient.id)
    .select();

  expect(data).toBeNull();
  expect(error).toMatchObject({ code: '42501' });
  expect((await owner.data.getRecipe(recipeId))?.lines).toEqual([
    { originalText: 'a pinch of saffron', amountText: null, ingredient: { id: line.ingredient.id, name } },
  ]);
});

test('a signed-in user cannot remove an Ingredient, even one no Recipe uses any more', async () => {
  const owner = await signInAttacker('owner');
  const other = await signInAttacker('other');
  const name = uniqueName();
  const recipeId = await owner.data.createRecipe({
    title: 'Paella',
    lines: [{ originalText: 'a pinch of saffron', ingredientName: name }],
    steps: [],
  });
  const [line] = (await owner.data.getRecipe(recipeId))?.lines ?? [];
  // Unlinked, so only a policy (not the lines' foreign key) stands between it and a delete.
  await owner.data.editRecipe(recipeId, { title: 'Paella', lines: [], steps: [] });

  const { data, error } = await other.client.from('ingredients').delete().eq('id', line.ingredient.id).select();

  expect(data).toBeNull();
  expect(error).toMatchObject({ code: '42501' });
  // Still there: linking the same name again finds the same Ingredient rather than making a new one.
  await owner.data.editRecipe(recipeId, {
    title: 'Paella',
    lines: [{ originalText: 'a pinch of saffron', ingredientName: name }],
    steps: [],
  });
  expect((await owner.data.getRecipe(recipeId))?.lines).toEqual([
    { originalText: 'a pinch of saffron', amountText: null, ingredient: { id: line.ingredient.id, name } },
  ]);
});
