import { expect, test } from 'vitest';

import type { Pantry } from '../src/data';
import { signInTestUser, type TestUser } from './harness';

const names = (pantry: Pantry) => ({
  ingredients: pantry.ingredients.map((i) => i.name),
  staples: pantry.staples.map((i) => i.name),
});

async function staple(user: TestUser, name: string) {
  const found = (await user.data.getPantry()).staples.find((i) => i.name === name);
  if (!found) throw new Error(`${name} is not one of the user's Staples`);
  return found;
}

test('a new user starts with salt, pepper and oil as Staples and nothing in their Pantry', async () => {
  const a = await signInTestUser('a');

  expect(names(await a.data.getPantry())).toEqual({ ingredients: [], staples: ['oil', 'pepper', 'salt'] });
});

test('a user adds Ingredients to their Pantry, whatever the spelling, and marks them used up', async () => {
  const a = await signInTestUser('a');

  const eggs = await a.data.addToPantry('Eggs');
  const garlic = await a.data.addToPantry('  GARLIC ');
  const garlicAgain = await a.data.addToPantry('garlics');

  expect(eggs.name).toBe('egg');
  expect(garlicAgain).toEqual(garlic);
  expect(names(await a.data.getPantry())).toEqual({
    ingredients: ['egg', 'garlic'],
    staples: ['oil', 'pepper', 'salt'],
  });
  expect(await a.data.hasIngredient(eggs.id)).toBe(true);

  await a.data.markUsedUp(eggs.id);

  expect(names(await a.data.getPantry())).toEqual({ ingredients: ['garlic'], staples: ['oil', 'pepper', 'salt'] });
  expect(await a.data.hasIngredient(eggs.id)).toBe(false);
  expect(await a.data.hasIngredient(garlic.id)).toBe(true);

  // Used up twice is still used up.
  await a.data.markUsedUp(eggs.id);
  expect(names(await a.data.getPantry()).ingredients).toEqual(['garlic']);
});

test('awkward names go through the Ingredient matcher; one it leaves nothing of is refused', async () => {
  const a = await signInTestUser('a');

  await a.data.addToPantry('Crème Fraîche');
  await a.data.addToPantry("Hellmann's");
  await a.data.addToPantry('’Nduja');
  await a.data.addToPantry('  Olive   Oil ');

  for (const typed of ['', '   ', '?!', "'"]) {
    await expect(a.data.addToPantry(typed)).rejects.toMatchObject({ code: 'ingredient_required' });
  }
  expect(names(await a.data.getPantry()).ingredients).toEqual(['crème fraîche', 'hellmann', 'nduja', 'olive oil']);
});

test("the Pantry and a Recipe's lines refer to the same Ingredient", async () => {
  const a = await signInTestUser('a');
  const recipeId = await a.data.createRecipe({
    title: 'Aglio e olio',
    lines: [{ originalText: '4 cloves garlic, sliced', ingredientName: 'Garlic' }],
    steps: [],
  });
  const [line] = (await a.data.getRecipe(recipeId))?.lines ?? [];
  expect(await a.data.hasIngredient(line.ingredient.id)).toBe(false);

  const garlic = await a.data.addToPantry('garlic');

  expect(garlic).toEqual(line.ingredient);
  expect(await a.data.hasIngredient(line.ingredient.id)).toBe(true);
});

test('a Staple counts as present even if not in the Pantry', async () => {
  const a = await signInTestUser('a');
  const salt = await staple(a, 'salt');

  expect(names(await a.data.getPantry()).ingredients).toEqual([]);
  expect(await a.data.hasIngredient(salt.id)).toBe(true);

  // Using up salt from the Pantry leaves it a Staple, so still had.
  await a.data.addToPantry('salt');
  await a.data.markUsedUp(salt.id);

  expect(names(await a.data.getPantry())).toEqual({ ingredients: [], staples: ['oil', 'pepper', 'salt'] });
  expect(await a.data.hasIngredient(salt.id)).toBe(true);
});

test('a user edits their Staples, and only their Staples then count as had', async () => {
  const a = await signInTestUser('a');
  const pepper = await staple(a, 'pepper');

  const staples = await a.data.setStaples(['salt', 'Olive Oil', '  ', 'olive oils', "Za'atar", 'oil']);

  expect(staples.map((i) => i.name)).toEqual(['oil', 'olive oil', 'salt', 'zaatar']);
  expect(names(await a.data.getPantry())).toEqual({ ingredients: [], staples: ['oil', 'olive oil', 'salt', 'zaatar'] });
  expect(await a.data.hasIngredient(pepper.id)).toBe(false);
  expect(await a.data.hasIngredient(staples[1].id)).toBe(true);

  await expect(a.data.setStaples(['salt', '?!'])).rejects.toMatchObject({ code: 'ingredient_required' });
  expect(names(await a.data.getPantry()).staples).toEqual(['oil', 'olive oil', 'salt', 'zaatar']);

  expect(await a.data.setStaples([])).toEqual([]);
  expect(await a.data.hasIngredient(staples[2].id)).toBe(false);
});

test('Pantry and Staples are visible only to their owner', async () => {
  const owner = await signInTestUser('owner');
  const other = await signInTestUser('other');
  const garlic = await owner.data.addToPantry('garlic');
  await owner.data.setStaples(['salt', 'butter', 'sumac']);
  const ownerSumac = await staple(owner, 'sumac');

  // The other user sees only their own defaults, and doesn't have the owner's Ingredients.
  expect(names(await other.data.getPantry())).toEqual({ ingredients: [], staples: ['oil', 'pepper', 'salt'] });
  expect(await other.data.hasIngredient(garlic.id)).toBe(false);

  // What they do to their own Pantry and Staples leaves the owner's alone.
  await other.data.markUsedUp(garlic.id);
  await other.data.setStaples([]);
  expect(await other.data.hasIngredient(ownerSumac.id)).toBe(false);

  expect(names(await owner.data.getPantry())).toEqual({ ingredients: ['garlic'], staples: ['butter', 'salt', 'sumac'] });
  expect(await owner.data.hasIngredient(garlic.id)).toBe(true);
});
