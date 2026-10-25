// Access-rule tests: a stranger skips the data layer and calls PostgREST directly with the anon key
// and their own session, as an attacker would. RLS is what has to stop them.
import { expect, test } from 'vitest';

import { signInTestUser } from './harness';

async function ownerRecipeAndStranger() {
  const owner = await signInTestUser('owner');
  const stranger = await signInTestUser('stranger');
  const recipeId = await owner.data.createRecipe({
    title: 'Garlic bread',
    lines: [
      { originalText: '2 cloves garlic, minced', amountText: '2 cloves', ingredientName: 'garlic' },
      { originalText: '4 tbsp butter, softened', amountText: '4 tbsp', ingredientName: 'butter' },
    ],
    steps: ['Mash the garlic into the butter.'],
  });
  const original = await owner.data.getRecipe(recipeId);

  // Line ids aren't in the domain model; assume the attacker has learnt them anyway.
  const { data: ownerLines, error } = await owner.attackerClient
    .from('recipe_lines')
    .select('id, ingredient_id')
    .eq('recipe_id', recipeId)
    .order('position');
  if (error) throw error;
  expect(ownerLines).toHaveLength(2);

  async function expectOwnerStillSeesOriginalLines() {
    const now = await owner.data.getRecipe(recipeId);
    expect(now).toEqual(original);
    expect(now?.lines.map((l) => [l.originalText, l.amountText, l.ingredient.name])).toEqual([
      ['2 cloves garlic, minced', '2 cloves', 'garlic'],
      ['4 tbsp butter, softened', '4 tbsp', 'butter'],
    ]);
  }

  return { recipeId, ownerLines, stranger: stranger.attackerClient, expectOwnerStillSeesOriginalLines };
}

test("a stranger cannot add a line to someone else's Recipe", async () => {
  const { recipeId, ownerLines, stranger, expectOwnerStillSeesOriginalLines } = await ownerRecipeAndStranger();

  const { error } = await stranger.from('recipe_lines').insert({
    recipe_id: recipeId,
    position: 2,
    original_text: '1 jar of pickles',
    amount_text: '1 jar',
    ingredient_id: ownerLines[0].ingredient_id,
  });

  expect(error).toMatchObject({ code: '42501' });
  await expectOwnerStillSeesOriginalLines();
});

test("a stranger cannot change a line of someone else's Recipe", async () => {
  const { ownerLines, stranger, expectOwnerStillSeesOriginalLines } = await ownerRecipeAndStranger();

  const { data, error } = await stranger
    .from('recipe_lines')
    .update({ original_text: '1 jar of pickles' })
    .eq('id', ownerLines[0].id)
    .select();

  expect(data).toBeNull();
  expect(error).toMatchObject({ code: '42501' });
  await expectOwnerStillSeesOriginalLines();
});

test("a stranger cannot remove a line from someone else's Recipe", async () => {
  const { ownerLines, stranger, expectOwnerStillSeesOriginalLines } = await ownerRecipeAndStranger();

  const { data, error } = await stranger.from('recipe_lines').delete().eq('id', ownerLines[0].id).select();

  expect(error).toBeNull();
  expect(data).toEqual([]);
  await expectOwnerStillSeesOriginalLines();
});

test("a stranger cannot read the lines of someone else's Recipe", async () => {
  const { recipeId, ownerLines, stranger, expectOwnerStillSeesOriginalLines } = await ownerRecipeAndStranger();

  const byRecipe = await stranger.from('recipe_lines').select('*').eq('recipe_id', recipeId);
  const byId = await stranger.from('recipe_lines').select('*').eq('id', ownerLines[0].id);

  expect(byRecipe).toMatchObject({ data: [], error: null });
  expect(byId).toMatchObject({ data: [], error: null });
  await expectOwnerStillSeesOriginalLines();
});
