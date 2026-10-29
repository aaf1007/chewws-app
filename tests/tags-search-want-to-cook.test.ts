// Ticket 06: Tags, search and Want to Cook, through the data layer as real signed-in users. Drafts
// build in-process with the canned sources and Claude answers (draft-fixtures.ts): no network.
import { expect, test } from 'vitest';

import { searchWords, tidyTagNames, type Recipe, type RecipeId, type RecipeInput } from '../src/data';
import { EXTRACTION_SCHEMA, parseExtraction, type Extract } from '../supabase/functions/_shared/claude-extractor';
import { FULL_RECIPE, PLAIN_PAGE, fixtureExtract } from '../supabase/functions/_shared/draft-fixtures';
import { signInTestUser, type TestUser } from './harness';

const tagNames = (recipe: Recipe | null) => (recipe?.status === 'reviewed' ? recipe.tags.map((t) => t.name) : null);

const suggestedOf = (recipe: Recipe | null) => (recipe?.status === 'draft' ? recipe.suggestedTags : null);

const wantToCookOf = (recipe: Recipe | null) => (recipe?.status === 'reviewed' ? recipe.wantToCookSince : undefined);

const titles = (recipes: { title: string }[]) => recipes.map((r) => r.title);

async function savedAndBuilt(user: TestUser, url: string): Promise<RecipeId> {
  const { recipeId } = await user.data.saveFromLink({ url });
  await user.drafts.settled();
  return recipeId;
}

/** The Draft as the user leaves it on review: its lines and steps as built. */
function asBuilt(recipe: Recipe | null): RecipeInput {
  if (!recipe) throw new Error('No Recipe.');
  return {
    title: recipe.title,
    lines: recipe.lines.map((l) => ({ originalText: l.originalText, amountText: l.amountText, ingredientName: l.ingredient.name })),
    steps: recipe.steps,
  };
}

const garlicBread: RecipeInput = {
  title: 'Garlic bread',
  lines: [
    { originalText: '2 cloves garlic, minced', amountText: '2 cloves', ingredientName: 'garlic' },
    { originalText: '1 baguette', amountText: '1', ingredientName: 'baguette' },
  ],
  steps: ['Spread and bake.'],
};

const shakshuka: RecipeInput = {
  title: "Rosa's Shakshuka",
  lines: [
    { originalText: '1 can crushed tomatoes', amountText: '1 can', ingredientName: 'crushed tomatoes' },
    { originalText: '4 eggs', amountText: '4', ingredientName: 'eggs' },
  ],
  steps: ['Simmer, then crack in the eggs.'],
};

const cremeBrulee: RecipeInput = {
  title: 'Crème brûlée',
  lines: [
    { originalText: '4 egg yolks', amountText: '4', ingredientName: 'egg yolk' },
    { originalText: "a splash of Grand Marnier's", amountText: 'a splash', ingredientName: "Grand Marnier's" },
  ],
  steps: ['Bake.'],
};

const tomatoSoup: RecipeInput = {
  title: 'Soup of the day',
  lines: [{ originalText: '6 tomatoes', amountText: '6', ingredientName: 'tomatoes' }],
  steps: ['Blend.'],
};

test('the Draft builder suggests Tags, shown on the Draft and kept only as the user reviews it', async () => {
  const a = await signInTestUser('a');
  const id = await savedAndBuilt(a, FULL_RECIPE.url);

  expect(suggestedOf(await a.data.getRecipe(id))).toEqual(['Italian', 'Dinner', 'quick']);
  // Suggestions aren't Tags: an unreviewed Draft never fills the Tag list, and search skips it.
  expect(await a.data.listTags()).toEqual([]);
  expect(await a.data.searchRecipes('pasta')).toEqual([]);

  // The user removes "Dinner", keeps the rest and adds one of their own.
  const draft = await a.data.getRecipe(id);
  await a.data.reviewDraft(id, asBuilt(draft), ['Italian', 'quick', ' Date  night ']);

  const recipe = await a.data.getRecipe(id);
  expect(tagNames(recipe)).toEqual(['Date night', 'Italian', 'quick']);
  expect((await a.data.listTags()).map((t) => t.name)).toEqual(['Date night', 'Italian', 'quick']);
  expect(titles(await a.data.searchRecipes('quick'))).toEqual(['Creamy garlic pasta']);
});

test('suggested Tags take the spelling of the user’s own Tag of that name, and review finds it rather than making another', async () => {
  const a = await signInTestUser('a');
  const bread = await a.data.createRecipe(garlicBread);
  const mine = await a.data.addTag(bread, 'ITALIAN');
  const id = await savedAndBuilt(a, FULL_RECIPE.url);

  expect(suggestedOf(await a.data.getRecipe(id))).toEqual(['ITALIAN', 'Dinner', 'quick']);

  await a.data.reviewDraft(id, asBuilt(await a.data.getRecipe(id)), ['italian', 'Dinner', 'DINNER']);

  const recipe = await a.data.getRecipe(id);
  expect(recipe?.status === 'reviewed' && recipe.tags).toEqual([
    { id: expect.any(String), name: 'Dinner' },
    { id: mine.id, name: 'ITALIAN' },
  ]);
  expect((await a.data.listTags()).map((t) => t.name)).toEqual(['Dinner', 'ITALIAN']);
});

test('Claude is asked for Tags, and an answer with Tags of the wrong shape is unreadable', () => {
  const answer = (tags: unknown) => ({
    stop_reason: 'end_turn' as const,
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ title: 'Pad thai', recipeFound: false, lines: [], steps: [], tags }),
        citations: null,
      },
    ],
  });

  expect(EXTRACTION_SCHEMA.required).toContain('tags');
  expect(EXTRACTION_SCHEMA.properties.tags).toEqual({ type: 'array', items: { type: 'string' } });
  expect(parseExtraction(answer(['Thai', 'quick']))).toEqual({
    title: 'Pad thai',
    recipeFound: false,
    lines: [],
    steps: [],
    tags: ['Thai', 'quick'],
  });
  expect(() => parseExtraction(answer('Thai'))).toThrow(expect.objectContaining({ reason: 'unreadable' }));
  expect(() => parseExtraction(answer(['Thai', 3]))).toThrow(expect.objectContaining({ reason: 'unreadable' }));
});

test('the builder tidies Claude’s suggestions: trimmed, each once, none blank or too long, at most 5', async () => {
  const messy: Extract = async (material, signal) => ({
    ...(await fixtureExtract(material, signal)),
    tags: ['  Thai ', 'thai', '', '   ', 'x'.repeat(41), 'Street\tfood', 'Dinner', 'quick', 'Spicy', 'Noodles', 'Extra'],
  });
  const a = await signInTestUser('a', { extract: messy });
  const id = await savedAndBuilt(a, FULL_RECIPE.url);

  expect(suggestedOf(await a.data.getRecipe(id))).toEqual(['Thai', 'Street food', 'Dinner', 'quick', 'Spicy']);
});

test('a Draft with nothing for Claude to read suggests no Tags; built again, it takes the new suggestions', async () => {
  const a = await signInTestUser('a');
  const page = await savedAndBuilt(a, PLAIN_PAGE.url);
  expect(suggestedOf(await a.data.getRecipe(page))).toEqual([]);

  // An answer from before Tags (no `tags`) suggests none.
  const noTags: Extract = async (material, signal) => {
    const { tags: _ignored, ...rest } = await fixtureExtract(material, signal);
    return rest;
  };
  const b = await signInTestUser('b', { extract: noTags });
  const id = await savedAndBuilt(b, FULL_RECIPE.url);
  expect(suggestedOf(await b.data.getRecipe(id))).toEqual([]);
});

test('Tag names are tidied, and the same name in any case is the same Tag', () => {
  expect(tidyTagNames(['Crème', 'CRÈME', 'crème', '  Nonna’s   favourites ', 'Nonna’s favourites', '🌶️ hot'])).toEqual([
    'Crème',
    'Nonna’s favourites',
    '🌶️ hot',
  ]);
  expect(tidyTagNames([' ', '\n', ''])).toEqual([]);
  // 40 characters is the most: an emoji counts as one.
  expect(tidyTagNames(['🍝'.repeat(40), 'y'.repeat(41)])).toEqual(['🍝'.repeat(40)]);
});

test('the user adds, removes and creates Tags on any Recipe; a removed Tag stays theirs until they delete it', async () => {
  const a = await signInTestUser('a');
  const bread = await a.data.createRecipe(garlicBread);
  const brulee = await a.data.createRecipe(cremeBrulee);

  const weeknight = await a.data.addTag(bread, 'Weeknight');
  expect(await a.data.addTag(bread, '  weeknight ')).toEqual(weeknight);
  const french = await a.data.addTag(brulee, 'Crème  de la crème');
  // Decomposed accents and another case are still that Tag.
  expect(await a.data.addTag(bread, 'CRÈME DE LA CRÈME')).toEqual(french);
  await a.data.addTag(brulee, "Nonna's");

  expect(tagNames(await a.data.getRecipe(bread))).toEqual(['Crème de la crème', 'Weeknight']);
  expect(tagNames(await a.data.getRecipe(brulee))).toEqual(['Crème de la crème', "Nonna's"]);

  await a.data.removeTag(bread, weeknight.id);
  await a.data.removeTag(bread, weeknight.id);
  expect(tagNames(await a.data.getRecipe(bread))).toEqual(['Crème de la crème']);
  expect((await a.data.listTags()).map((t) => t.name)).toEqual(['Crème de la crème', "Nonna's", 'Weeknight']);

  // Editing the Recipe leaves its Tags alone.
  await a.data.editRecipe(brulee, { ...cremeBrulee, title: 'Crème brûlée for four' });
  expect(tagNames(await a.data.getRecipe(brulee))).toEqual(['Crème de la crème', "Nonna's"]);

  // Deleting a Tag takes it off every Recipe.
  await a.data.deleteTag(french.id);
  await a.data.deleteTag(french.id);
  expect(tagNames(await a.data.getRecipe(bread))).toEqual([]);
  expect(tagNames(await a.data.getRecipe(brulee))).toEqual(["Nonna's"]);
  expect((await a.data.listTags()).map((t) => t.name)).toEqual(["Nonna's", 'Weeknight']);
});

test('a Tag needs a name of at most 40 characters, and a Draft gets its Tags only on review', async () => {
  const a = await signInTestUser('a');
  const bread = await a.data.createRecipe(garlicBread);
  const draft = await savedAndBuilt(a, FULL_RECIPE.url);

  await expect(a.data.addTag(bread, ' \t ')).rejects.toMatchObject({ name: 'DataError', code: 'tag_required' });
  await expect(a.data.addTag(bread, 'x'.repeat(41))).rejects.toMatchObject({ code: 'tag_too_long' });
  expect(await a.data.addTag(bread, '🍞'.repeat(40))).toMatchObject({ name: '🍞'.repeat(40) });
  await expect(a.data.addTag(draft, 'Italian')).rejects.toMatchObject({ code: 'draft_not_reviewed' });
  await expect(
    a.data.reviewDraft(draft, asBuilt(await a.data.getRecipe(draft)), ['y'.repeat(41)]),
  ).rejects.toMatchObject({ code: 'tag_too_long' });

  expect((await a.data.listTags()).map((t) => t.name)).toEqual(['🍞'.repeat(40)]);
  expect((await a.data.getRecipe(draft))?.status).toBe('draft');
});

test('two adds of one Tag at once make one Tag, on the Recipe once; on two Recipes, one Tag on both', async () => {
  const a = await signInTestUser('a');
  const bread = await a.data.createRecipe(garlicBread);
  const soup = await a.data.createRecipe(tomatoSoup);

  // The same spelling both times: which of two spellings sent at once is kept is a race.
  const [first, second] = await Promise.all([a.data.addTag(bread, 'Vegetarian'), a.data.addTag(bread, 'Vegetarian')]);
  expect(second).toEqual(first);
  const [onBread, onSoup] = await Promise.all([a.data.addTag(bread, 'Lunch'), a.data.addTag(soup, 'Lunch')]);
  expect(onSoup.id).toBe(onBread.id);

  expect(tagNames(await a.data.getRecipe(bread))).toEqual(['Lunch', 'Vegetarian']);
  expect(tagNames(await a.data.getRecipe(soup))).toEqual(['Lunch']);
  expect((await a.data.listTags()).map((t) => t.name)).toEqual(['Lunch', 'Vegetarian']);

  await Promise.all([a.data.removeTag(bread, first.id), a.data.removeTag(bread, first.id)]);
  expect(tagNames(await a.data.getRecipe(bread))).toEqual(['Lunch']);
  await Promise.all([a.data.deleteTag(onBread.id), a.data.deleteTag(onBread.id)]);
  expect((await a.data.listTags()).map((t) => t.name)).toEqual(['Vegetarian']);
});

test('two reviews of a Draft at once put its Tags on it once', async () => {
  const a = await signInTestUser('a');
  const id = await savedAndBuilt(a, FULL_RECIPE.url);
  const input = asBuilt(await a.data.getRecipe(id));

  await Promise.all([
    a.data.reviewDraft(id, input, ['Italian', 'quick']),
    a.data.reviewDraft(id, input, ['Italian', 'quick']),
  ]);

  expect(tagNames(await a.data.getRecipe(id))).toEqual(['Italian', 'quick']);
  expect((await a.data.listTags()).map((t) => t.name)).toEqual(['Italian', 'quick']);
});

test('search finds Recipes by title, linked Ingredient or Tag, newest first', async () => {
  const a = await signInTestUser('a');
  const bread = await a.data.createRecipe(garlicBread);
  const shak = await a.data.createRecipe(shakshuka);
  await a.data.createRecipe(cremeBrulee);
  await a.data.createRecipe(tomatoSoup);
  await a.data.addTag(bread, 'Italian');
  await a.data.addTag(shak, 'Brunch');

  // Title, without regard to case, anywhere in it.
  expect(titles(await a.data.searchRecipes('BREAD'))).toEqual(['Garlic bread']);
  expect(titles(await a.data.searchRecipes('shak'))).toEqual(["Rosa's Shakshuka"]);
  // A linked Ingredient, by the word as the Ingredient matcher reads it.
  expect(titles(await a.data.searchRecipes('tomatoes'))).toEqual(['Soup of the day', "Rosa's Shakshuka"]);
  expect(titles(await a.data.searchRecipes('Tomato'))).toEqual(['Soup of the day', "Rosa's Shakshuka"]);
  expect(titles(await a.data.searchRecipes('garlic'))).toEqual(['Garlic bread']);
  expect(titles(await a.data.searchRecipes('eggs'))).toEqual(['Crème brûlée', "Rosa's Shakshuka"]);
  // A Tag, by part of its name.
  expect(titles(await a.data.searchRecipes('ital'))).toEqual(['Garlic bread']);
  expect(titles(await a.data.searchRecipes('brunch'))).toEqual(["Rosa's Shakshuka"]);
  // Every word has to match, each anywhere.
  expect(titles(await a.data.searchRecipes('  egg   brunch '))).toEqual(["Rosa's Shakshuka"]);
  expect(titles(await a.data.searchRecipes('egg italian'))).toEqual([]);
  expect(titles(await a.data.searchRecipes('chicken'))).toEqual([]);
  // Nothing typed: the whole library.
  expect(titles(await a.data.searchRecipes(''))).toEqual(titles(await a.data.listMyRecipes()));
  expect(titles(await a.data.searchRecipes('   '))).toHaveLength(4);
});

test('search copes with accents, apostrophes and characters a pattern would treat specially', async () => {
  const a = await signInTestUser('a');
  await a.data.createRecipe(shakshuka);
  await a.data.createRecipe(cremeBrulee);
  await a.data.createRecipe({ ...garlicBread, title: '100% rye_bread' });

  expect(titles(await a.data.searchRecipes('CRÈME'))).toEqual(['Crème brûlée']);
  expect(titles(await a.data.searchRecipes('crème'))).toEqual(['Crème brûlée']);
  // A phone types a curly apostrophe; the title has a straight one.
  expect(titles(await a.data.searchRecipes('Rosa’s'))).toEqual(["Rosa's Shakshuka"]);
  // "Grand Marnier's" is the Ingredient "grand marnier".
  expect(titles(await a.data.searchRecipes("marnier's"))).toEqual(['Crème brûlée']);
  // % and _ are only themselves.
  expect(titles(await a.data.searchRecipes('100%'))).toEqual(['100% rye_bread']);
  expect(titles(await a.data.searchRecipes('%'))).toEqual(['100% rye_bread']);
  expect(titles(await a.data.searchRecipes('e_b'))).toEqual(['100% rye_bread']);
  expect(titles(await a.data.searchRecipes('_'))).toEqual(['100% rye_bread']);
  // A word the matcher leaves nothing of still matches a title.
  expect(titles(await a.data.searchRecipes('&'))).toEqual([]);
});

test('search words are what the user typed, split on spaces, each also read as an Ingredient', () => {
  expect(searchWords('  Tomatoes  GARLIC\tRosa’s ')).toEqual([
    { text: 'tomatoes', ingredient: 'tomato' },
    { text: 'garlic', ingredient: 'garlic' },
    { text: "rosa's", ingredient: 'rosa' },
  ]);
  expect(searchWords('crème & M&M’s')).toEqual([
    { text: 'crème', ingredient: 'crème' },
    { text: '&', ingredient: '' },
    { text: "m&m's", ingredient: 'm ms' },
  ]);
  expect(searchWords('')).toEqual([]);
  expect(searchWords(' \n ')).toEqual([]);
});

test('the user marks and unmarks Recipes Want to Cook and sees that list, the most recently marked first', async () => {
  const a = await signInTestUser('a');
  const bread = await a.data.createRecipe(garlicBread);
  const shak = await a.data.createRecipe(shakshuka);
  const soup = await a.data.createRecipe(tomatoSoup);

  expect(wantToCookOf(await a.data.getRecipe(bread))).toBeNull();
  expect(await a.data.listWantToCook()).toEqual([]);

  await a.data.setWantToCook(shak, true);
  await a.data.setWantToCook(bread, true);
  const since = wantToCookOf(await a.data.getRecipe(bread));
  expect(since).toEqual(expect.any(String));
  // Marked again: it keeps when it was first marked, and its place.
  await a.data.setWantToCook(bread, true);
  expect(wantToCookOf(await a.data.getRecipe(bread))).toBe(since);

  expect(titles(await a.data.listWantToCook())).toEqual(['Garlic bread', "Rosa's Shakshuka"]);
  expect(await a.data.listWantToCook()).toEqual([
    { id: bread, title: 'Garlic bread', lineCount: 2, stepCount: 1, createdAt: expect.any(String) },
    { id: shak, title: "Rosa's Shakshuka", lineCount: 2, stepCount: 1, createdAt: expect.any(String) },
  ]);
  // Search within Want to Cook keeps its order.
  expect(titles(await a.data.searchRecipes('', { wantToCook: true }))).toEqual(['Garlic bread', "Rosa's Shakshuka"]);
  expect(titles(await a.data.searchRecipes('egg', { wantToCook: true }))).toEqual(["Rosa's Shakshuka"]);
  expect(titles(await a.data.searchRecipes('tomato', { wantToCook: true }))).toEqual(["Rosa's Shakshuka"]);

  await a.data.setWantToCook(shak, false);
  await a.data.setWantToCook(soup, false);
  expect(titles(await a.data.listWantToCook())).toEqual(['Garlic bread']);
  expect(wantToCookOf(await a.data.getRecipe(shak))).toBeNull();

  // Marked again after unmarking, it goes to the top.
  await a.data.setWantToCook(shak, true);
  expect(titles(await a.data.listWantToCook())).toEqual(["Rosa's Shakshuka", 'Garlic bread']);

  // A deleted Recipe leaves the list.
  await a.data.deleteRecipe(bread);
  expect(titles(await a.data.listWantToCook())).toEqual(["Rosa's Shakshuka"]);
});

test('two marks at once leave a Recipe marked once; a mark and an unmark at once leave one or the other', async () => {
  const a = await signInTestUser('a');
  const bread = await a.data.createRecipe(garlicBread);

  await Promise.all([a.data.setWantToCook(bread, true), a.data.setWantToCook(bread, true)]);
  expect(titles(await a.data.listWantToCook())).toEqual(['Garlic bread']);
  await Promise.all([a.data.setWantToCook(bread, false), a.data.setWantToCook(bread, false)]);
  expect(await a.data.listWantToCook()).toEqual([]);
});

test('a Draft cannot be marked Want to Cook until it is reviewed', async () => {
  const a = await signInTestUser('a');
  const id = await savedAndBuilt(a, FULL_RECIPE.url);

  await expect(a.data.setWantToCook(id, true)).rejects.toMatchObject({ code: 'draft_not_reviewed' });
  await a.data.reviewDraft(id, asBuilt(await a.data.getRecipe(id)));
  await a.data.setWantToCook(id, true);
  expect(titles(await a.data.listWantToCook())).toEqual(['Creamy garlic pasta']);
});

test("one user's Tags, Want to Cook and search results are invisible to another user", async () => {
  const owner = await signInTestUser('owner');
  const stranger = await signInTestUser('stranger');
  const bread = await owner.data.createRecipe(garlicBread);
  const italian = await owner.data.addTag(bread, 'Italian');
  await owner.data.setWantToCook(bread, true);
  const before = await owner.data.getRecipe(bread);

  expect(await stranger.data.listTags()).toEqual([]);
  expect(await stranger.data.listWantToCook()).toEqual([]);
  expect(await stranger.data.searchRecipes('garlic')).toEqual([]);
  expect(await stranger.data.searchRecipes('italian')).toEqual([]);
  expect(await stranger.data.searchRecipes('')).toEqual([]);
  expect(await stranger.data.searchRecipes('', { wantToCook: true })).toEqual([]);
  expect(await stranger.data.getRecipe(bread)).toBeNull();

  await expect(stranger.data.addTag(bread, 'Mine now')).rejects.toMatchObject({ code: 'recipe_not_found' });
  await expect(stranger.data.setWantToCook(bread, false)).rejects.toMatchObject({ code: 'recipe_not_found' });
  await stranger.data.removeTag(bread, italian.id);
  await stranger.data.deleteTag(italian.id);

  // A Tag of the same name is the stranger's own.
  const theirs = await stranger.data.addTag(await stranger.data.createRecipe(tomatoSoup), 'italian');
  expect(theirs.id).not.toBe(italian.id);
  expect(await stranger.data.listTags()).toEqual([theirs]);
  expect(titles(await stranger.data.searchRecipes('italian'))).toEqual(['Soup of the day']);

  expect(await owner.data.getRecipe(bread)).toEqual(before);
  expect(await owner.data.listTags()).toEqual([italian]);
  expect(titles(await owner.data.searchRecipes('italian'))).toEqual(['Garlic bread']);
  expect(titles(await owner.data.listWantToCook())).toEqual(['Garlic bread']);
});
