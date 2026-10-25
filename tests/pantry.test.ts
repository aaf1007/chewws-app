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

  await a.data.removeStaple(pepper.id);
  const oliveOil = await a.data.addStaple('Olive Oil');
  expect(await a.data.addStaple('olive oils')).toEqual(oliveOil);
  expect((await a.data.addStaple("Za'atar")).name).toBe('zaatar');
  expect((await a.data.addStaple('oil')).name).toBe('oil'); // already one: still one Staple

  expect(oliveOil.name).toBe('olive oil');
  expect(names(await a.data.getPantry())).toEqual({ ingredients: [], staples: ['oil', 'olive oil', 'salt', 'zaatar'] });
  expect(await a.data.hasIngredient(pepper.id)).toBe(false);
  expect(await a.data.hasIngredient(oliveOil.id)).toBe(true);

  for (const typed of ['', '   ', '?!']) {
    await expect(a.data.addStaple(typed)).rejects.toMatchObject({ code: 'ingredient_required' });
  }
  expect(names(await a.data.getPantry()).staples).toEqual(['oil', 'olive oil', 'salt', 'zaatar']);

  const salt = await staple(a, 'salt');
  for (const s of (await a.data.getPantry()).staples) await a.data.removeStaple(s.id);
  expect((await a.data.getPantry()).staples).toEqual([]);
  expect(await a.data.hasIngredient(salt.id)).toBe(false);

  // Removing one that's already gone is fine.
  await a.data.removeStaple(salt.id);
  expect((await a.data.getPantry()).staples).toEqual([]);
});

test('Staple changes made at the same moment all land, and none undoes another', async () => {
  const a = await signInTestUser('a');
  const pepper = await staple(a, 'pepper');
  const oil = await staple(a, 'oil');

  // Two quick Removes: both stay removed.
  await Promise.all([a.data.removeStaple(pepper.id), a.data.removeStaple(oil.id)]);
  expect(names(await a.data.getPantry()).staples).toEqual(['salt']);

  // The same new Staple added twice at once, another added, and a Remove repeated, all at once.
  await Promise.all([
    a.data.addStaple('Butter'),
    a.data.addStaple('butter'),
    a.data.addStaple('Sumac'),
    a.data.removeStaple(pepper.id),
  ]);
  expect(names(await a.data.getPantry()).staples).toEqual(['butter', 'salt', 'sumac']);
});

test('Pantry and Staples are visible only to their owner', async () => {
  const owner = await signInTestUser('owner');
  const other = await signInTestUser('other');
  const garlic = await owner.data.addToPantry('garlic');
  await owner.data.removeStaple((await staple(owner, 'pepper')).id);
  await owner.data.removeStaple((await staple(owner, 'oil')).id);
  await owner.data.addStaple('butter');
  await owner.data.addStaple('sumac');
  const ownerSalt = await staple(owner, 'salt');
  const ownerSumac = await staple(owner, 'sumac');

  // The other user sees only their own defaults, and doesn't have the owner's Ingredients.
  expect(names(await other.data.getPantry())).toEqual({ ingredients: [], staples: ['oil', 'pepper', 'salt'] });
  expect(await other.data.hasIngredient(garlic.id)).toBe(false);

  // What they do to their own Pantry and Staples leaves the owner's alone.
  await other.data.markUsedUp(garlic.id);
  await other.data.removeStaple(ownerSumac.id);
  await other.data.removeStaple(ownerSalt.id);
  expect(await other.data.hasIngredient(ownerSumac.id)).toBe(false);
  expect(await other.data.hasIngredient(ownerSalt.id)).toBe(false);

  expect(names(await owner.data.getPantry())).toEqual({ ingredients: ['garlic'], staples: ['butter', 'salt', 'sumac'] });
  expect(await owner.data.hasIngredient(garlic.id)).toBe(true);
});

test("listIngredientsIHave gives each Ingredient in the user's Pantry or Staples once, and only theirs", async () => {
  const a = await signInTestUser('a');
  const other = await signInTestUser('other');
  const [oil, pepper, salt] = (await a.data.getPantry()).staples;
  const garlic = await a.data.addToPantry('garlic');
  await a.data.addToPantry('salt'); // in the Pantry and a Staple: listed once
  const sumac = await other.data.addToPantry('sumac');
  const butter = await other.data.addStaple('butter');

  expect([oil.name, pepper.name, salt.name]).toEqual(['oil', 'pepper', 'salt']);
  expect(await a.data.listIngredientsIHave()).toEqual([garlic.id, oil.id, pepper.id, salt.id].sort());
  expect(await other.data.listIngredientsIHave()).toEqual([butter.id, oil.id, pepper.id, salt.id, sumac.id].sort());

  // Used up and no longer a Staple: gone from the list.
  await a.data.markUsedUp(garlic.id);
  await a.data.removeStaple(pepper.id);
  expect(await a.data.listIngredientsIHave()).toEqual([oil.id, salt.id].sort());
});
