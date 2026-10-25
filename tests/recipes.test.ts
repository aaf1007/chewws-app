import { expect, test } from 'vitest';

import type { RecipeInput } from '../src/data';
import { signInTestUser } from './harness';

const garlicBread: RecipeInput = {
  title: 'Garlic bread',
  lines: [
    { originalText: '2 cloves garlic, minced', amountText: '2 cloves', ingredientName: 'Garlic' },
    { originalText: '4 tbsp butter, softened', amountText: '4 tbsp', ingredientName: 'butter' },
    { originalText: '', amountText: '', ingredientName: '' },
    { originalText: '', amountText: '1', ingredientName: 'Baguettes' },
  ],
  steps: ['Mash the garlic into the butter.', '  ', 'Spread on the bread and bake for 10 minutes.'],
};

test('a user creates a Recipe with lines and steps, and it appears in their library', async () => {
  const a = await signInTestUser('a');

  const id = await a.data.createRecipe(garlicBread);

  const recipe = await a.data.getRecipe(id);
  expect(recipe).toMatchObject({
    id,
    ownerId: a.userId,
    title: 'Garlic bread',
    status: 'reviewed',
    recipeFound: true,
    steps: ['Mash the garlic into the butter.', 'Spread on the bread and bake for 10 minutes.'],
  });
  expect(recipe?.lines.map((l) => [l.originalText, l.amountText, l.ingredient.name])).toEqual([
    ['2 cloves garlic, minced', '2 cloves', 'garlic'],
    ['4 tbsp butter, softened', '4 tbsp', 'butter'],
    ['1 Baguettes', '1', 'baguette'],
  ]);

  expect(await a.data.listMyRecipes()).toEqual([
    { id, title: 'Garlic bread', lineCount: 3, stepCount: 2, createdAt: recipe?.createdAt },
  ]);
});

test('each ingredient line links to a plain Ingredient, and the user can change which one', async () => {
  const a = await signInTestUser('a');
  const id = await a.data.createRecipe({
    title: 'Aglio e olio',
    lines: [{ originalText: '2 cloves garlic, minced', amountText: '2 cloves', ingredientName: 'garlic' }],
    steps: ['Fry the garlic gently in oil.'],
  });
  const before = await a.data.getRecipe(id);
  expect(before?.lines.map((l) => l.ingredient.name)).toEqual(['garlic']);

  await a.data.editRecipe(id, {
    title: 'Aglio e olio',
    lines: [{ originalText: '2 cloves garlic, minced', amountText: '2 cloves', ingredientName: 'Shallots' }],
    steps: ['Fry the garlic gently in oil.'],
  });

  const after = await a.data.getRecipe(id);
  expect(after?.lines.map((l) => [l.originalText, l.ingredient.name])).toEqual([
    ['2 cloves garlic, minced', 'shallot'],
  ]);
  expect(after?.lines[0].ingredient.id).not.toEqual(before?.lines[0].ingredient.id);
});

test('the Ingredient matcher gives one Ingredient whatever the spelling or casing', async () => {
  const a = await signInTestUser('a');
  const b = await signInTestUser('b');
  const line = (ingredientName: string) => ({ originalText: ingredientName, ingredientName });

  const fromA = await a.data.createRecipe({
    title: 'Spellings',
    lines: ['Garlic', 'garlic ', 'garlics', 'Tomatoes', '  Olive   Oil ', 'hummus', 'molasses', 'couscous'].map(
      line,
    ),
    steps: [],
  });
  const fromB = await b.data.createRecipe({
    title: 'Shouting',
    lines: ['GARLIC,', 'tomato', 'olive oils'].map(line),
    steps: [],
  });

  const linesA = (await a.data.getRecipe(fromA))?.lines ?? [];
  const linesB = (await b.data.getRecipe(fromB))?.lines ?? [];
  expect(linesA.map((l) => l.ingredient.name)).toEqual([
    'garlic',
    'garlic',
    'garlic',
    'tomato',
    'olive oil',
    'hummus',
    'molasses',
    'couscous',
  ]);
  expect(linesB.map((l) => l.ingredient.name)).toEqual(['garlic', 'tomato', 'olive oil']);

  // Same Ingredient row, not a second one under another spelling, within and across users.
  const garlicIds = new Set([...linesA.slice(0, 3), linesB[0]].map((l) => l.ingredient.id));
  expect(garlicIds.size).toBe(1);
  expect(linesB[1].ingredient.id).toBe(linesA[3].ingredient.id);
  expect(linesB[2].ingredient.id).toBe(linesA[4].ingredient.id);
});

test('creating, editing and deleting a Recipe is reflected in the owner library', async () => {
  const a = await signInTestUser('a');
  expect(await a.data.listMyRecipes()).toEqual([]);

  const soup = await a.data.createRecipe({
    title: 'Tomato soup',
    lines: [{ originalText: '6 tomatoes', amountText: '6', ingredientName: 'tomatoes' }],
    steps: ['Simmer.', 'Blend.'],
  });
  const salad = await a.data.createRecipe({ title: 'Green salad', lines: [], steps: ['Toss.'] });
  expect((await a.data.listMyRecipes()).map((r) => [r.id, r.title])).toEqual([
    [salad, 'Green salad'],
    [soup, 'Tomato soup'],
  ]);

  await a.data.editRecipe(soup, {
    title: 'Roast tomato soup',
    lines: [
      { originalText: '6 tomatoes, halved', amountText: '6', ingredientName: 'tomato' },
      { originalText: '1 onion', amountText: '1', ingredientName: 'onion' },
    ],
    steps: ['Roast.', 'Simmer.', 'Blend.'],
  });
  expect(
    (await a.data.listMyRecipes()).map((r) => [r.title, r.lineCount, r.stepCount]),
  ).toEqual([
    ['Green salad', 0, 1],
    ['Roast tomato soup', 2, 3],
  ]);
  const edited = await a.data.getRecipe(soup);
  expect(edited?.lines.map((l) => [l.originalText, l.amountText, l.ingredient.name])).toEqual([
    ['6 tomatoes, halved', '6', 'tomato'],
    ['1 onion', '1', 'onion'],
  ]);
  expect(edited?.steps).toEqual(['Roast.', 'Simmer.', 'Blend.']);

  await a.data.deleteRecipe(salad);
  expect((await a.data.listMyRecipes()).map((r) => r.title)).toEqual(['Roast tomato soup']);
  expect(await a.data.getRecipe(salad)).toBeNull();
});

test('another signed-in user cannot read, edit or delete the Recipe', async () => {
  const owner = await signInTestUser('owner');
  const stranger = await signInTestUser('stranger');
  const id = await owner.data.createRecipe(garlicBread);
  const original = await owner.data.getRecipe(id);

  expect(await stranger.data.getRecipe(id)).toBeNull();
  expect(await stranger.data.listMyRecipes()).toEqual([]);

  await expect(
    stranger.data.editRecipe(id, { title: 'Mine now', lines: [], steps: [] }),
  ).rejects.toMatchObject({ name: 'DataError', code: 'recipe_not_found' });
  await expect(stranger.data.deleteRecipe(id)).rejects.toMatchObject({
    name: 'DataError',
    code: 'recipe_not_found',
  });

  expect(await owner.data.getRecipe(id)).toEqual(original);
  expect((await owner.data.listMyRecipes()).map((r) => r.title)).toEqual(['Garlic bread']);
});

test('a Recipe needs a title, and every ingredient line needs an Ingredient', async () => {
  const a = await signInTestUser('a');

  await expect(a.data.createRecipe({ title: '  ', lines: [], steps: [] })).rejects.toMatchObject({
    code: 'title_required',
  });
  await expect(
    a.data.createRecipe({
      title: 'Mystery',
      lines: [{ originalText: 'a pinch of something', ingredientName: ' ?! ' }],
      steps: [],
    }),
  ).rejects.toMatchObject({ code: 'ingredient_required' });
  expect(await a.data.listMyRecipes()).toEqual([]);
});

test('an apostrophe in an Ingredient name vanishes, so "Hellmann\'s" and "hellmanns" are one Ingredient', async () => {
  const a = await signInTestUser('a');
  const line = (ingredientName: string) => ({ originalText: ingredientName, ingredientName });

  const id = await a.data.createRecipe({
    title: 'Sandwich',
    lines: ["Hellmann's", 'hellmanns', 'Hellmann’s', "M&M's"].map(line),
    steps: [],
  });

  const lines = (await a.data.getRecipe(id))?.lines ?? [];
  expect(lines.map((l) => l.ingredient.name)).toEqual(['hellmann', 'hellmann', 'hellmann', 'm m']);
  expect(new Set(lines.slice(0, 3).map((l) => l.ingredient.id)).size).toBe(1);

  await a.data.editRecipe(id, { title: 'Sandwich', lines: [line("Hellmann's")], steps: [] });
  expect((await a.data.getRecipe(id))?.lines.map((l) => l.ingredient.id)).toEqual([lines[0].ingredient.id]);
});
