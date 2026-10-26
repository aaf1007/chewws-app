import { randomUUID } from 'node:crypto';

import { expect, test } from 'vitest';

import { parseShoppingListItemId, type RecipeLineInput, type ShoppingList, type ShoppingListItem } from '../src/data';
import { holdShoppingListLine, signInOnPhones, signInTestUser, type TestUser } from './harness';

/** The list as the user reads it: each line's name, its Recipes' amounts, and whether it's checked. */
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

async function recipe(user: TestUser, title: string, lines: RecipeLineInput[]) {
  return user.data.createRecipe({ title, lines, steps: [] });
}

/** A hand-added item, by its text. */
async function item(user: TestUser, text: string): Promise<ShoppingListItem> {
  const found = (await user.data.getShoppingList()).items.find((i) => i.kind === 'handAdded' && i.text === text);
  if (!found) throw new Error(`${text} is not on the Shopping List`);
  return found;
}

/** An Ingredient line, by its Ingredient's name. */
async function line(user: TestUser, name: string) {
  for (const i of (await user.data.getShoppingList()).items) {
    if (i.kind === 'ingredient' && i.ingredient.name === name) return i;
  }
  throw new Error(`${name} has no line on the Shopping List`);
}

const garlicBread: RecipeLineInput[] = [
  { originalText: '2 cloves garlic, minced', amountText: '2 cloves', ingredientName: 'garlic' },
  { originalText: '4 tbsp butter, softened', amountText: '4 tbsp', ingredientName: 'butter' },
  { originalText: 'Salt to taste', ingredientName: 'salt' },
  { originalText: '1 egg, beaten', amountText: '1', ingredientName: 'eggs' },
];

const aglioEOlio: RecipeLineInput[] = [
  { originalText: '200 g spaghetti', amountText: '200 g', ingredientName: 'spaghetti' },
  { originalText: '4 cloves garlic, sliced', amountText: ' 4 cloves ', ingredientName: 'Garlic' },
  { originalText: '1 more clove garlic, grated, to finish', amountText: '1 clove', ingredientName: 'garlics' },
  { originalText: 'Olive oil', amountText: '   ', ingredientName: 'olive oil' },
];

test('a new user has an empty Shopping List', async () => {
  const a = await signInTestUser('a');

  const list = await a.data.getShoppingList();

  expect(list.ownerId).toBe(a.userId);
  expect(list.items).toEqual([]);
  expect(list.recipes).toEqual([]);
});

test("adding a Recipe adds only the Ingredients the user doesn't have in their Pantry or Staples", async () => {
  const a = await signInTestUser('a');
  await a.data.addToPantry('egg');
  const id = await recipe(a, 'Garlic bread', garlicBread);

  const needed = await a.data.addRecipeToShoppingList(id);

  expect(needed.map((i) => i.name)).toEqual(['garlic', 'butter']);
  expect(view(await a.data.getShoppingList())).toEqual([
    { ingredient: 'butter', recipes: [['Garlic bread', '4 tbsp']], checked: false },
    { ingredient: 'garlic', recipes: [['Garlic bread', '2 cloves']], checked: false },
  ]);
  expect((await a.data.getShoppingList()).recipes).toEqual([{ id, title: 'Garlic bread' }]);
});

test('an Ingredient that goes into the Pantry while a Recipe is being added, after the app read what the user has, is not put on the list', async () => {
  const [phone, other] = await signInOnPhones('a', 2);
  const id = await recipe(phone, 'Garlic bread', garlicBread);
  const held = phone.holdNextRequest('add_recipe_to_shopping_list');
  const adding = phone.data.addRecipeToShoppingList(id);
  await held.reached;

  await other.data.addToPantry('garlic');
  held.release();

  expect((await adding).map((i) => i.name)).toEqual(['butter', 'egg']);
  expect(view(await phone.data.getShoppingList())).toEqual([
    { ingredient: 'butter', recipes: [['Garlic bread', '4 tbsp']], checked: false },
    { ingredient: 'egg', recipes: [['Garlic bread', '1']], checked: false },
  ]);
});

test('Recipes needing the same Ingredient share one line, each with its own amounts, never added up', async () => {
  const a = await signInTestUser('a');
  const bread = await recipe(a, 'Garlic bread', garlicBread);
  const pasta = await recipe(a, 'Aglio e olio', aglioEOlio);

  await a.data.addRecipeToShoppingList(bread);
  await a.data.addRecipeToShoppingList(pasta);

  // Olive oil isn't a Staple (oil is): it's needed, with no amount.
  expect(view(await a.data.getShoppingList())).toEqual([
    { ingredient: 'butter', recipes: [['Garlic bread', '4 tbsp']], checked: false },
    { ingredient: 'egg', recipes: [['Garlic bread', '1']], checked: false },
    {
      ingredient: 'garlic',
      recipes: [
        ['Garlic bread', '2 cloves'],
        ['Aglio e olio', '4 cloves', '1 clove'],
      ],
      checked: false,
    },
    { ingredient: 'olive oil', recipes: [['Aglio e olio']], checked: false },
    { ingredient: 'spaghetti', recipes: [['Aglio e olio', '200 g']], checked: false },
  ]);
  expect((await a.data.getShoppingList()).recipes).toEqual([
    { id: pasta, title: 'Aglio e olio' },
    { id: bread, title: 'Garlic bread' },
  ]);
});

test('adding a Recipe that is already on the list changes nothing, even twice at once', async () => {
  const a = await signInTestUser('a');
  const bread = await recipe(a, 'Garlic bread', garlicBread);
  await a.data.addRecipeToShoppingList(bread);
  const before = await a.data.getShoppingList();

  await a.data.addRecipeToShoppingList(bread);
  expect(await a.data.getShoppingList()).toEqual(before);

  const b = await signInTestUser('b');
  const again = await recipe(b, 'Garlic bread', garlicBread);
  await Promise.all([b.data.addRecipeToShoppingList(again), b.data.addRecipeToShoppingList(again)]);
  expect(view(await b.data.getShoppingList())).toEqual([
    { ingredient: 'butter', recipes: [['Garlic bread', '4 tbsp']], checked: false },
    { ingredient: 'egg', recipes: [['Garlic bread', '1']], checked: false },
    { ingredient: 'garlic', recipes: [['Garlic bread', '2 cloves']], checked: false },
  ]);
});

test('two Recipes sharing Ingredients, added at the same moment, both land on the shared lines', async () => {
  const a = await signInTestUser('a');
  const one = await recipe(a, 'Garlic butter', [
    { originalText: 'garlic', amountText: '3 cloves', ingredientName: 'garlic' },
    { originalText: 'butter', amountText: '50 g', ingredientName: 'butter' },
  ]);
  const two = await recipe(a, 'Butter garlic', [
    { originalText: 'butter', amountText: '1 stick', ingredientName: 'butter' },
    { originalText: 'garlic', amountText: '1 head', ingredientName: 'garlic' },
  ]);

  await Promise.all([a.data.addRecipeToShoppingList(one), a.data.addRecipeToShoppingList(two)]);

  // The two adds can land in either order, so each line's Recipes are compared by title.
  const lines = view(await a.data.getShoppingList()).map((l) => ({ ...l, recipes: [...(l.recipes ?? [])].sort() }));
  expect(lines).toEqual([
    {
      ingredient: 'butter',
      recipes: [
        ['Butter garlic', '1 stick'],
        ['Garlic butter', '50 g'],
      ],
      checked: false,
    },
    {
      ingredient: 'garlic',
      recipes: [
        ['Butter garlic', '1 head'],
        ['Garlic butter', '3 cloves'],
      ],
      checked: false,
    },
  ]);
});

/**
 * Two Ingredients (shallot, parsley), ordered by id, and a user with two Recipes: Soup needs the
 * first, Stew needs both. Soup is on the user's list.
 */
async function soupOnTheListThenStew() {
  const other = await signInTestUser('other');
  await other.data.addToPantry('shallots');
  await other.data.addToPantry('parsley');
  const [first, second] = (await other.data.getPantry()).ingredients.sort((x, y) => (x.id < y.id ? -1 : 1));
  const a = await signInTestUser('a');
  const soup = await recipe(a, 'Soup', [{ originalText: '1 shallot', amountText: '1', ingredientName: first.name }]);
  const stew = await recipe(a, 'Stew', [
    { originalText: '2 shallots', amountText: '2', ingredientName: 'shallot' },
    { originalText: 'a bunch of parsley', amountText: 'a bunch', ingredientName: 'parsley' },
  ]);
  await a.data.addRecipeToShoppingList(soup);
  return { a, soup, stew, second };
}

/** Each line, by Ingredient, with its Recipes' amounts. */
const linesByName = async (user: TestUser) =>
  Object.fromEntries(view(await user.data.getShoppingList()).map((l) => [l.ingredient, l.recipes]));

test("a Recipe added while another is taken off its lines keeps all its amounts", async () => {
  const { a, soup, stew, second } = await soupOnTheListThenStew();
  // Pause the add between its lines: another session holds the user's uncommitted line for the
  // Ingredient that sorts second, so the add stops there, after passing Soup's line, until released.
  const held = await holdShoppingListLine(a, second.id);
  const adding = a.data.addRecipeToShoppingList(stew);
  await held.waitForWaiting(1);

  // Taking Soup off now either waits for the add or finishes; then the add carries on.
  const removing = a.data.removeRecipeFromShoppingList(soup);
  await Promise.race([removing, held.waitForWaiting(2)]);
  await held.release();
  await Promise.all([adding, removing]);

  expect(await linesByName(a)).toEqual({ parsley: [['Stew', 'a bunch']], shallot: [['Stew', '2']] });
});

test('20 times over, a Recipe added while another is taken off at the same moment keeps all its amounts', async () => {
  const { a, soup, stew } = await soupOnTheListThenStew();

  for (let round = 0; round < 20; round++) {
    await Promise.all([a.data.addRecipeToShoppingList(stew), a.data.removeRecipeFromShoppingList(soup)]);
    expect(await linesByName(a)).toEqual({ parsley: [['Stew', 'a bunch']], shallot: [['Stew', '2']] });

    await a.data.removeRecipeFromShoppingList(stew);
    await a.data.addRecipeToShoppingList(soup);
  }
});

test('the user adds hand-written items, linked to an Ingredient only when one of that name exists', async () => {
  const a = await signInTestUser('a');
  const other = await signInTestUser('other');
  await other.data.addToPantry('Crème fraîche'); // Ingredients are shared, so this one now exists

  await a.data.addManualItem('  Paper towels ');
  await a.data.addManualItem('CRÈME FRAÎCHE');
  await a.data.addManualItem('🧻');
  for (const typed of ['', '   ']) {
    await expect(a.data.addManualItem(typed)).rejects.toMatchObject({ code: 'item_text_required' });
  }

  expect(view(await a.data.getShoppingList())).toEqual([
    { handAdded: 'CRÈME FRAÎCHE', ingredient: 'crème fraîche', checked: false },
    { handAdded: 'Paper towels', ingredient: null, checked: false },
    { handAdded: '🧻', ingredient: null, checked: false },
  ]);
  // Hand-added items make no Ingredient: "paper towels" is still nobody's Ingredient.
  await expect(other.data.addManualItem('paper towel')).resolves.toBeTruthy();
  expect((await item(other, 'paper towel')).ingredient).toBeNull();
});

test('adding the same hand-written item twice with one id adds it once; different ones all land', async () => {
  const a = await signInTestUser('a');
  // The phone chose this id; sending the add twice at once is one item.
  const id = parseShoppingListItemId(randomUUID());
  await Promise.all([a.data.addManualItem('Bin bags', { id }), a.data.addManualItem('Bin bags', { id })]);
  await expect(a.data.addManualItem('Bin bags', { id })).resolves.toBe(id);
  await Promise.all([a.data.addManualItem('Foil'), a.data.addManualItem('Foil'), a.data.addManualItem('Tea')]);

  expect(view(await a.data.getShoppingList())).toEqual([
    { handAdded: 'Bin bags', ingredient: null, checked: false },
    { handAdded: 'Foil', ingredient: null, checked: false },
    { handAdded: 'Foil', ingredient: null, checked: false },
    { handAdded: 'Tea', ingredient: null, checked: false },
  ]);
  expect((await item(a, 'Bin bags')).id).toBe(id);
});

test("checking off a Recipe Ingredient, or a hand-added item that matches one, puts it in the user's Pantry", async () => {
  const a = await signInTestUser('a');
  await a.data.addRecipeToShoppingList(await recipe(a, 'Garlic bread', garlicBread));
  await a.data.addManualItem('Butter'); // matches the Ingredient the Recipe made
  await signInTestUser('other').then((other) => other.data.addToPantry("Hellmann's"));
  await a.data.addManualItem('Hellmann’s'); // a curly apostrophe still matches
  await a.data.addManualItem('Paper towels');
  const garlic = await line(a, 'garlic');
  const butter = await item(a, 'Butter');
  const hellmanns = await item(a, 'Hellmann’s');
  const towels = await item(a, 'Paper towels');

  await a.data.checkOff(garlic.id);
  expect(await pantryNames(a)).toEqual(['garlic']);
  await a.data.checkOff(butter.id);
  await a.data.checkOff(hellmanns.id);
  expect(await pantryNames(a)).toEqual(['butter', 'garlic', 'hellmann']);
  await a.data.checkOff(towels.id);
  expect(await pantryNames(a)).toEqual(['butter', 'garlic', 'hellmann']);

  const checkedOff = [
    { ingredient: 'butter', recipes: [['Garlic bread', '4 tbsp']], checked: false },
    { handAdded: 'Butter', ingredient: 'butter', checked: true },
    { ingredient: 'egg', recipes: [['Garlic bread', '1']], checked: false },
    { ingredient: 'garlic', recipes: [['Garlic bread', '2 cloves']], checked: true },
    { handAdded: 'Hellmann’s', ingredient: 'hellmann', checked: true },
    { handAdded: 'Paper towels', ingredient: null, checked: true },
  ];
  expect(view(await a.data.getShoppingList())).toEqual(checkedOff);
  expect((await line(a, 'garlic')).check).toMatchObject({ status: 'checked', checkedBy: a.userId });

  // What's now in the Pantry isn't needed again: a Recipe needing only garlic adds nothing.
  const soup = await recipe(a, 'Garlic soup', [{ originalText: 'garlic', amountText: '1 head', ingredientName: 'garlic' }]);
  expect(await a.data.addRecipeToShoppingList(soup)).toEqual([]);
  expect(view(await a.data.getShoppingList())).toEqual(checkedOff);
});

test('checking off twice, or twice at once, checks it once and adds it to the Pantry once', async () => {
  const a = await signInTestUser('a');
  await a.data.addRecipeToShoppingList(await recipe(a, 'Garlic bread', garlicBread));
  const garlic = await line(a, 'garlic');
  const butter = await line(a, 'butter');

  await Promise.all([a.data.checkOff(garlic.id), a.data.checkOff(garlic.id), a.data.checkOff(butter.id)]);
  await a.data.checkOff(garlic.id);

  expect(await pantryNames(a)).toEqual(['butter', 'garlic']);
  expect(view(await a.data.getShoppingList())).toEqual([
    { ingredient: 'butter', recipes: [['Garlic bread', '4 tbsp']], checked: true },
    { ingredient: 'egg', recipes: [['Garlic bread', '1']], checked: false },
    { ingredient: 'garlic', recipes: [['Garlic bread', '2 cloves']], checked: true },
  ]);

  // Checking off an item that's already checked doesn't put it back after it's used up.
  await a.data.markUsedUp(garlic.ingredient.id);
  await a.data.checkOff(garlic.id);
  expect(await pantryNames(a)).toEqual(['butter']);
});

test('unchecking leaves the Pantry alone, and works twice at once', async () => {
  const a = await signInTestUser('a');
  await a.data.addRecipeToShoppingList(await recipe(a, 'Garlic bread', garlicBread));
  const garlic = await line(a, 'garlic');
  const butter = await line(a, 'butter');
  await a.data.checkOff(garlic.id);
  await a.data.checkOff(butter.id);

  await Promise.all([a.data.uncheck(garlic.id), a.data.uncheck(garlic.id), a.data.uncheck(butter.id)]);
  await a.data.uncheck(garlic.id);

  expect(await pantryNames(a)).toEqual(['butter', 'garlic']);
  expect(view(await a.data.getShoppingList())).toEqual([
    { ingredient: 'butter', recipes: [['Garlic bread', '4 tbsp']], checked: false },
    { ingredient: 'egg', recipes: [['Garlic bread', '1']], checked: false },
    { ingredient: 'garlic', recipes: [['Garlic bread', '2 cloves']], checked: false },
  ]);
  expect((await line(a, 'garlic')).check).toEqual({ status: 'unchecked' });
});

test('a checked-off line a newly added Recipe needs is needed again', async () => {
  const a = await signInTestUser('a');
  await a.data.addRecipeToShoppingList(await recipe(a, 'Garlic bread', garlicBread));
  const garlic = await line(a, 'garlic');
  await a.data.checkOff(garlic.id);
  await a.data.markUsedUp(garlic.ingredient.id);

  await a.data.addRecipeToShoppingList(await recipe(a, 'Aglio e olio', aglioEOlio));

  expect(view(await a.data.getShoppingList()).find((l) => 'ingredient' in l && l.ingredient === 'garlic')).toEqual({
    ingredient: 'garlic',
    recipes: [
      ['Garlic bread', '2 cloves'],
      ['Aglio e olio', '4 cloves', '1 clove'],
    ],
    checked: false,
  });
});

test('the user removes items, one at a time or at once; removing one twice is fine', async () => {
  const a = await signInTestUser('a');
  await a.data.addRecipeToShoppingList(await recipe(a, 'Garlic bread', garlicBread));
  await a.data.addManualItem('Paper towels');
  const garlic = await line(a, 'garlic');
  const butter = await line(a, 'butter');
  const towels = await item(a, 'Paper towels');
  await a.data.checkOff(butter.id);

  await a.data.removeFromShoppingList(garlic.id);
  await a.data.removeFromShoppingList(garlic.id);
  await Promise.all([
    a.data.removeFromShoppingList(butter.id),
    a.data.removeFromShoppingList(towels.id),
    a.data.removeFromShoppingList(towels.id),
  ]);

  expect(view(await a.data.getShoppingList())).toEqual([
    { ingredient: 'egg', recipes: [['Garlic bread', '1']], checked: false },
  ]);
  expect(await pantryNames(a)).toEqual(['butter']); // removing a checked item leaves the Pantry alone
  await expect(a.data.checkOff(garlic.id)).rejects.toMatchObject({ code: 'shopping_list_item_not_found' });
  await expect(a.data.uncheck(garlic.id)).rejects.toMatchObject({ code: 'shopping_list_item_not_found' });
});

test("the user removes all of one Recipe's lines; lines other Recipes need stay with their amounts", async () => {
  const a = await signInTestUser('a');
  const bread = await recipe(a, 'Garlic bread', garlicBread);
  const pasta = await recipe(a, 'Aglio e olio', aglioEOlio);
  await a.data.addRecipeToShoppingList(bread);
  await a.data.addRecipeToShoppingList(pasta);
  await a.data.addManualItem('Butter');
  await a.data.checkOff((await line(a, 'butter')).id); // checked off, and only the bread needs it

  await a.data.removeRecipeFromShoppingList(bread);
  await a.data.removeRecipeFromShoppingList(bread);

  expect(view(await a.data.getShoppingList())).toEqual([
    { handAdded: 'Butter', ingredient: 'butter', checked: false },
    { ingredient: 'garlic', recipes: [['Aglio e olio', '4 cloves', '1 clove']], checked: false },
    { ingredient: 'olive oil', recipes: [['Aglio e olio']], checked: false },
    { ingredient: 'spaghetti', recipes: [['Aglio e olio', '200 g']], checked: false },
  ]);
  expect((await a.data.getShoppingList()).recipes).toEqual([{ id: pasta, title: 'Aglio e olio' }]);
});

test('two Recipes removed at the same moment take every line only they needed', async () => {
  const a = await signInTestUser('a');
  const bread = await recipe(a, 'Garlic bread', garlicBread);
  const pasta = await recipe(a, 'Aglio e olio', aglioEOlio);
  await a.data.addRecipeToShoppingList(bread);
  await a.data.addRecipeToShoppingList(pasta);
  await a.data.addManualItem('Paper towels');
  await a.data.checkOff((await line(a, 'garlic')).id);

  await Promise.all([a.data.removeRecipeFromShoppingList(bread), a.data.removeRecipeFromShoppingList(pasta)]);

  expect(view(await a.data.getShoppingList())).toEqual([
    { handAdded: 'Paper towels', ingredient: null, checked: false },
  ]);
  expect((await a.data.getShoppingList()).recipes).toEqual([]);
});

test('deleting a Recipe removes its amounts and its unchecked lines no other Recipe needs; checked ones stay', async () => {
  const a = await signInTestUser('a');
  const bread = await recipe(a, 'Garlic bread', garlicBread);
  const pasta = await recipe(a, 'Aglio e olio', aglioEOlio);
  await a.data.addRecipeToShoppingList(bread);
  await a.data.addRecipeToShoppingList(pasta);
  await a.data.checkOff((await line(a, 'butter')).id);

  await a.data.deleteRecipe(bread);

  expect(view(await a.data.getShoppingList())).toEqual([
    { ingredient: 'butter', recipes: [], checked: true },
    { ingredient: 'garlic', recipes: [['Aglio e olio', '4 cloves', '1 clove']], checked: false },
    { ingredient: 'olive oil', recipes: [['Aglio e olio']], checked: false },
    { ingredient: 'spaghetti', recipes: [['Aglio e olio', '200 g']], checked: false },
  ]);
});

test("a Shopping List is visible only to its owner, and nobody else's actions touch it", async () => {
  const owner = await signInTestUser('owner');
  const other = await signInTestUser('other');
  const bread = await recipe(owner, 'Garlic bread', garlicBread);
  await owner.data.addRecipeToShoppingList(bread);
  await owner.data.addManualItem('Paper towels');
  const garlic = await line(owner, 'garlic');
  const towels = await item(owner, 'Paper towels');
  const before = await owner.data.getShoppingList();

  expect((await other.data.getShoppingList()).items).toEqual([]);
  await expect(other.data.addRecipeToShoppingList(bread)).rejects.toMatchObject({ code: 'recipe_not_found' });
  await expect(other.data.checkOff(garlic.id)).rejects.toMatchObject({ code: 'shopping_list_item_not_found' });
  await expect(other.data.uncheck(garlic.id)).rejects.toMatchObject({ code: 'shopping_list_item_not_found' });
  await expect(other.data.addManualItem('Snacks', { id: towels.id })).rejects.toMatchObject({
    code: 'shopping_list_item_id_taken',
  });
  await other.data.removeFromShoppingList(garlic.id);
  await other.data.removeRecipeFromShoppingList(bread);

  expect(await owner.data.getShoppingList()).toEqual(before);
  expect(await pantryNames(owner)).toEqual([]);
  expect((await other.data.getShoppingList()).items).toEqual([]);
});
