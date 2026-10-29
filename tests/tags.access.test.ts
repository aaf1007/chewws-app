// Access-rule tests for Tags, search and Want to Cook (ticket 06): a stranger skips the data layer
// and calls PostgREST directly with their own session, as an attacker would. RLS is what has to stop
// them. Each test was checked to fail with the policy that guards it loosened to `true`, and the
// Want to Cook ones with set_want_to_cook's owner check taken out.
import { expect, test } from 'vitest';

import type { RecipeId, Tag } from '../src/data';
import { FULL_RECIPE } from '../supabase/functions/_shared/draft-fixtures';
import { signInAttacker, type Attacker } from './access-harness';

const permissionDenied = { code: '42501' };

type Setup = { owner: Attacker; stranger: Attacker; recipeId: RecipeId; italian: Tag; strangersTag: Tag };

/**
 * The owner's reviewed Recipe with their Tag "Italian" on it, marked Want to Cook; the stranger's
 * own Recipe and Tag beside it.
 */
async function ownerAndStranger(): Promise<Setup> {
  const owner = await signInAttacker('owner');
  const stranger = await signInAttacker('stranger');
  const recipeId = await owner.data.createRecipe({
    title: 'Garlic bread',
    lines: [{ originalText: '2 cloves garlic', amountText: '2 cloves', ingredientName: 'garlic' }],
    steps: ['Bake.'],
  });
  const italian = await owner.data.addTag(recipeId, 'Italian');
  await owner.data.setWantToCook(recipeId, true);
  const theirs = await stranger.data.createRecipe({ title: 'Toast', lines: [], steps: [] });
  const strangersTag = await stranger.data.addTag(theirs, 'Breakfast');
  return { owner, stranger, recipeId, italian, strangersTag };
}

/** What the owner sees of their Recipe, Tags and Want to Cook, to check nothing changed. */
async function ownersView({ owner, recipeId }: Setup) {
  return {
    recipe: await owner.data.getRecipe(recipeId),
    tags: await owner.data.listTags(),
    wantToCook: await owner.data.listWantToCook(),
  };
}

test("a stranger cannot read someone else's Tags or which Recipes they're on", async () => {
  const setup = await ownerAndStranger();
  const { stranger, recipeId, italian } = setup;

  const tags = await stranger.client.from('tags').select('*');
  const byId = await stranger.client.from('tags').select('*').eq('id', italian.id);
  const onRecipe = await stranger.client.from('recipe_tags').select('*').eq('recipe_id', recipeId);
  const allRecipeTags = await stranger.client.from('recipe_tags').select('*').eq('tag_id', italian.id);

  expect(tags).toMatchObject({ data: [{ name: 'Breakfast' }], error: null });
  expect(byId).toMatchObject({ data: [], error: null });
  expect(onRecipe).toMatchObject({ data: [], error: null });
  expect(allRecipeTags).toMatchObject({ data: [], error: null });
});

test("a stranger cannot put Tags on someone else's Recipe, or someone else's Tag on their own", async () => {
  const setup = await ownerAndStranger();
  const { stranger, recipeId, italian, strangersTag } = setup;
  const before = await ownersView(setup);
  const theirRecipe = (await stranger.data.listMyRecipes())[0].id;

  const theirTagOnOwnersRecipe = await stranger.client
    .from('recipe_tags')
    .insert({ recipe_id: recipeId, tag_id: strangersTag.id });
  const ownersTagOnTheirRecipe = await stranger.client
    .from('recipe_tags')
    .insert({ recipe_id: theirRecipe, tag_id: italian.id });
  const throughAddTag = await stranger.client.rpc('add_tag', { recipe_id: recipeId, name: 'Mine now' });

  expect(theirTagOnOwnersRecipe.error).toMatchObject(permissionDenied);
  expect(ownersTagOnTheirRecipe.error).toMatchObject(permissionDenied);
  expect(throughAddTag).toMatchObject({ data: null, error: null });
  expect(await ownersView(setup)).toEqual(before);
  expect((await stranger.data.listTags()).map((t) => t.name)).toEqual(['Breakfast']);
});

test("a stranger cannot take Tags off someone else's Recipe", async () => {
  const setup = await ownerAndStranger();
  const { stranger, recipeId, italian } = setup;
  const before = await ownersView(setup);

  const one = await stranger.client
    .from('recipe_tags')
    .delete()
    .eq('recipe_id', recipeId)
    .eq('tag_id', italian.id)
    .select();
  const all = await stranger.client.from('recipe_tags').delete().eq('recipe_id', recipeId).select();

  expect(one).toMatchObject({ data: [], error: null });
  expect(all).toMatchObject({ data: [], error: null });
  expect(await ownersView(setup)).toEqual(before);
});

test("a stranger cannot delete or rename someone else's Tag, or make one in their name", async () => {
  const setup = await ownerAndStranger();
  const { owner, stranger, italian } = setup;
  const before = await ownersView(setup);

  const remove = await stranger.client.from('tags').delete().eq('id', italian.id).select();
  const rename = await stranger.client.from('tags').update({ name: 'Hacked' }).eq('id', italian.id);
  const asOwner = await stranger.client.from('tags').insert({ owner_id: owner.userId, name: 'Planted' });

  expect(remove).toMatchObject({ data: [], error: null });
  expect(rename.error).toMatchObject(permissionDenied);
  expect(asOwner.error).toMatchObject(permissionDenied);
  expect(await ownersView(setup)).toEqual(before);
});

test("a stranger cannot mark or unmark someone else's Recipe Want to Cook", async () => {
  const setup = await ownerAndStranger();
  const { stranger, recipeId } = setup;
  const before = await ownersView(setup);

  const unmark = await stranger.client.rpc('set_want_to_cook', { recipe_id: recipeId, want_to_cook: false });
  const direct = await stranger.client.from('recipes').update({ want_to_cook_at: null }).eq('id', recipeId);

  expect(unmark).toMatchObject({ data: 'gone', error: null });
  expect(direct.error).toMatchObject(permissionDenied);
  expect(await ownersView(setup)).toEqual(before);
});

test("search never finds someone else's Recipes, by title, Ingredient, Tag or Want to Cook", async () => {
  const { stranger } = await ownerAndStranger();
  const words = (...texts: string[]) => texts.map((text) => ({ text, ingredient: text }));

  const searches = await Promise.all([
    stranger.client.rpc('search_recipes', { words: words('garlic') }).select('title'),
    stranger.client.rpc('search_recipes', { words: words('bread') }).select('title'),
    stranger.client.rpc('search_recipes', { words: words('italian') }).select('title'),
    stranger.client.rpc('search_recipes', { words: [], want_to_cook_only: true }).select('title'),
    stranger.client.rpc('search_recipes', {}).select('title'),
  ]);

  expect(searches.map((s) => s.error)).toEqual([null, null, null, null, null]);
  expect(searches.map((s) => s.data)).toEqual([[], [], [], [], [{ title: 'Toast' }]]);
});

test('a user cannot put a Tag on, or mark Want to Cook, their own Draft before reviewing it', async () => {
  const owner = await signInAttacker('owner');
  const { recipeId } = await owner.data.saveFromLink({ url: FULL_RECIPE.url });
  await owner.drafts.settled();
  const bread = await owner.data.createRecipe({ title: 'Garlic bread', lines: [], steps: [] });
  const tag = await owner.data.addTag(bread, 'Italian');
  const before = await owner.data.getRecipe(recipeId);

  const attach = await owner.client.from('recipe_tags').insert({ recipe_id: recipeId, tag_id: tag.id });
  const viaRpc = await owner.client.rpc('add_tag', { recipe_id: recipeId, name: 'Italian' });
  const mark = await owner.client
    .from('recipes')
    .update({ want_to_cook_at: new Date().toISOString() })
    .eq('id', recipeId);

  expect(attach.error).toMatchObject(permissionDenied);
  expect(viaRpc).toMatchObject({ data: null, error: null });
  expect(mark.error).toMatchObject(permissionDenied);
  expect(await owner.data.getRecipe(recipeId)).toEqual(before);
});

test('a Tag name with control or invisible format characters, or not composed, is refused however it is sent', async () => {
  const owner = await signInAttacker('owner');
  const bread = await owner.data.createRecipe({ title: 'Garlic bread', lines: [], steps: [] });
  const checkViolation = { code: '23514' };

  const names = ['Ital\u200Bian', '\u202Eevil', 'bell\u0007', 'tag\u{E0041}', 'cre\u0300me', 'soft\u00ADhyphen'];
  for (const name of names) {
    const viaRpc = await owner.client.rpc('add_tag', { recipe_id: bread, name });
    const direct = await owner.client.from('tags').insert({ name });
    expect([name, viaRpc.error]).toMatchObject([name, checkViolation]);
    expect([name, direct.error]).toMatchObject([name, checkViolation]);
  }
  expect(await owner.data.listTags()).toEqual([]);
});

test('nobody sets want_to_cook_at directly, not even on their own Recipe: only through set_want_to_cook', async () => {
  const owner = await signInAttacker('owner');
  const bread = await owner.data.createRecipe({ title: 'Garlic bread', lines: [], steps: [] });
  const before = await owner.data.getRecipe(bread);

  // A time of their choosing would put it anywhere in the Want to Cook list.
  const backdate = await owner.client
    .from('recipes')
    .update({ want_to_cook_at: '2001-01-01T00:00:00Z' })
    .eq('id', bread);

  expect(backdate.error).toMatchObject(permissionDenied);
  expect(await owner.data.getRecipe(bread)).toEqual(before);
});

test('review_draft refuses more than 20 Tag names, sent however they are', async () => {
  const owner = await signInAttacker('owner');
  const { recipeId } = await owner.data.saveFromLink({ url: FULL_RECIPE.url });
  await owner.drafts.settled();
  const before = await owner.data.getRecipe(recipeId);

  const review = await owner.client.rpc('review_draft', {
    recipe_id: recipeId,
    title: 'Pasta',
    steps: [],
    lines: [],
    tags: Array.from({ length: 21 }, (_, i) => `Tag ${i + 1}`),
  });

  expect(review.error).toMatchObject({ code: '22023' });
  expect(await owner.data.getRecipe(recipeId)).toEqual(before);
  expect(await owner.data.listTags()).toEqual([]);
});
