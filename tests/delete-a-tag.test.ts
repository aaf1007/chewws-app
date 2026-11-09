// Ticket 22: Delete a Tag, through the data layer as real signed-in users. The user lists their
// Tags with the Recipes each is on (one read) and deletes one, which takes it off every Recipe. A
// Tag already gone answers `gone`. Races hold one side in a second database session
// (CODING_STANDARDS.md); each ends in a state the test spells out. The first race fails every time
// with ticket 06's attach_tag (the add errors on the foreign key); the others hold on the
// database's own waits (the unique name, the foreign key's lock on the Tag, the row lock), which
// have nothing of ours to take out.
import { expect, test } from 'vitest';

import type { Recipe, RecipeId, RecipeInput, TagWithRecipes } from '../src/data';
import { holdRecipeRow, holdTagAdd, holdTagDelete, signInTestUser, signInWithUsername, type TestUser } from './harness';

const recipe = (title: string, ingredientName: string): RecipeInput => ({
  title,
  lines: [{ originalText: `1 ${ingredientName}`, amountText: '1', ingredientName }],
  steps: ['Cook it.'],
});

const tagNames = (r: Recipe | null) => (r?.status === 'reviewed' ? r.tags.map((t) => t.name) : null);

const titles = (recipes: { title: string }[]) => recipes.map((r) => r.title);

/** The user's Tags as the Tags screen shows them: name, then the Recipes' titles. */
const shown = (tags: TagWithRecipes[]) => tags.map((t) => [t.name, titles(t.recipes)]);

/**
 * The user's kitchen: Garlic bread, "Nonna's ragù" and Crème brûlée. Weeknight is on all three,
 * Italian on the first two, and Leftovers on none (it was taken off its only Recipe).
 */
async function kitchen(user: TestUser) {
  const bread = await user.data.createRecipe(recipe('Garlic bread', 'garlic'));
  const ragu = await user.data.createRecipe(recipe("Nonna's ragù", 'beef mince'));
  const brulee = await user.data.createRecipe(recipe('Crème brûlée', 'egg yolk'));
  const weeknight = await user.data.addTag(bread, 'Weeknight');
  await user.data.addTag(ragu, 'weeknight');
  await user.data.addTag(brulee, 'WEEKNIGHT');
  const italian = await user.data.addTag(ragu, 'Italian');
  await user.data.addTag(bread, 'Italian');
  const leftovers = await user.data.addTag(brulee, 'Leftovers');
  await user.data.removeTag(brulee, leftovers.id);
  return { bread, ragu, brulee, weeknight, italian, leftovers };
}

test('the user’s Tags, by name, each with the Recipes it’s on by title; a Tag on none is listed with none', async () => {
  const a = await signInTestUser('a');
  expect(await a.data.listTagsWithRecipes()).toEqual([]);
  const { bread, ragu, brulee, weeknight, italian, leftovers } = await kitchen(a);

  expect(await a.data.listTagsWithRecipes()).toEqual([
    {
      id: italian.id,
      name: 'Italian',
      recipes: [
        { id: bread, title: 'Garlic bread' },
        { id: ragu, title: "Nonna's ragù" },
      ],
    },
    { id: leftovers.id, name: 'Leftovers', recipes: [] },
    {
      id: weeknight.id,
      name: 'Weeknight',
      recipes: [
        { id: brulee, title: 'Crème brûlée' },
        { id: bread, title: 'Garlic bread' },
        { id: ragu, title: "Nonna's ragù" },
      ],
    },
  ]);
});

test('deleting a Tag takes it off every Recipe it was on and nothing else; deleting it again answers gone', async () => {
  const a = await signInTestUser('a');
  const { bread, ragu, brulee, weeknight, leftovers } = await kitchen(a);

  expect(await a.data.deleteTag(weeknight.id)).toEqual({ status: 'deleted' });
  expect(await a.data.deleteTag(weeknight.id)).toEqual({ status: 'gone' });
  expect(await a.data.deleteTag(leftovers.id)).toEqual({ status: 'deleted' });

  expect(shown(await a.data.listTagsWithRecipes())).toEqual([['Italian', ['Garlic bread', "Nonna's ragù"]]]);
  expect(tagNames(await a.data.getRecipe(bread))).toEqual(['Italian']);
  expect(tagNames(await a.data.getRecipe(ragu))).toEqual(['Italian']);
  expect(tagNames(await a.data.getRecipe(brulee))).toEqual([]);
  expect(titles(await a.data.listMyRecipes())).toEqual(['Crème brûlée', "Nonna's ragù", 'Garlic bread']);
});

test('after a delete the name typed again makes a fresh Tag in its new spelling; search and Want to Cook are otherwise unchanged', async () => {
  const a = await signInTestUser('a');
  const { bread, ragu, weeknight } = await kitchen(a);
  await a.data.setWantToCook(ragu, true);
  expect(titles(await a.data.searchRecipes('weeknight'))).toEqual(['Crème brûlée', "Nonna's ragù", 'Garlic bread']);

  await a.data.deleteTag(weeknight.id);

  // Searching the old name no longer finds a Recipe by that Tag; title and Ingredient still do.
  expect(await a.data.searchRecipes('weeknight')).toEqual([]);
  expect(titles(await a.data.searchRecipes('garlic'))).toEqual(['Garlic bread']);
  expect(titles(await a.data.searchRecipes('mince'))).toEqual(["Nonna's ragù"]);
  expect(titles(await a.data.searchRecipes('italian'))).toEqual(["Nonna's ragù", 'Garlic bread']);
  expect(titles(await a.data.listWantToCook())).toEqual(["Nonna's ragù"]);

  // Typed again, in another spelling: a new Tag, spelled the new way, which is then that name's.
  const fresh = await a.data.addTag(bread, '  weeknight ');
  expect(fresh).toEqual({ id: expect.any(String), name: 'weeknight' });
  expect(fresh.id).not.toBe(weeknight.id);
  expect(await a.data.addTag(ragu, 'WEEKNIGHT')).toEqual(fresh);
  expect(shown(await a.data.listTagsWithRecipes())).toEqual([
    ['Italian', ['Garlic bread', "Nonna's ragù"]],
    ['Leftovers', []],
    ['weeknight', ['Garlic bread', "Nonna's ragù"]],
  ]);
  expect(titles(await a.data.searchRecipes('weeknight'))).toEqual(["Nonna's ragù", 'Garlic bread']);
});

test('the counts are of the user’s own Recipes: a Friend’s Tags, even on a copy of the user’s Recipe, never show', async () => {
  const [sam, kim] = await Promise.all([signInWithUsername('sam'), signInWithUsername('kim')]);
  expect(await sam.data.sendFriendRequest(kim.userId)).toEqual({ status: 'requested' });
  expect(await kim.data.respondToFriendRequest(sam.userId, true)).toEqual({ status: 'accepted' });
  const shakshuka = await sam.data.createRecipe(recipe('Shakshuka', 'eggs'));
  await sam.data.addTag(shakshuka, 'Weeknight');
  expect(await sam.data.addCookLog(shakshuka, { cookedOn: '2026-11-01' })).toMatchObject({ status: 'added' });

  // kim reads sam's logged Recipe (ticket 19), without its Tags, and Tags his own copy of it.
  const seen = await kim.data.getRecipe(shakshuka);
  expect(seen?.status).toBe('someoneElses');
  expect(Object.keys(seen ?? {})).not.toContain('tags');
  const copied = await kim.data.copyRecipe(shakshuka);
  if (copied.status !== 'copied') throw new Error(`Couldn't copy: ${copied.status}`);
  await kim.data.addTag(copied.recipeId, 'Weeknight');
  await kim.data.addTag(copied.recipeId, 'Brunch');

  expect(shown(await sam.data.listTagsWithRecipes())).toEqual([['Weeknight', ['Shakshuka']]]);
  expect(shown(await kim.data.listTagsWithRecipes())).toEqual([
    ['Brunch', ['Shakshuka']],
    ['Weeknight', ['Shakshuka']],
  ]);
  const [kimsWeeknight] = (await kim.data.listTagsWithRecipes()).filter((t) => t.name === 'Weeknight');
  expect(kimsWeeknight.recipes).toEqual([{ id: copied.recipeId, title: 'Shakshuka' }]);
});

test('race: an add of a deleted Tag that found its id before the delete makes a fresh Tag, not an error', async () => {
  const a = await signInTestUser('a');
  const bread = await a.data.createRecipe(recipe('Garlic bread', 'garlic'));
  const ragu = await a.data.createRecipe(recipe("Nonna's ragù", 'beef mince'));
  const italian = await a.data.addTag(ragu, 'Italian');

  // The add finds Italian and stops at its check of the Garlic bread row, held here.
  const held = await holdRecipeRow(bread);
  const adding = a.data.addTag(bread, 'italian');
  await held.waitForWaiting(1);
  // Meanwhile the user deletes Italian on another phone; nothing of the add's holds it.
  expect(await a.data.deleteTag(italian.id)).toEqual({ status: 'deleted' });
  await held.release();

  const added = await adding;
  expect(added).toEqual({ id: expect.any(String), name: 'italian' });
  expect(added.id).not.toBe(italian.id);
  expect(shown(await a.data.listTagsWithRecipes())).toEqual([['italian', ['Garlic bread']]]);
  expect(tagNames(await a.data.getRecipe(bread))).toEqual(['italian']);
  expect(tagNames(await a.data.getRecipe(ragu))).toEqual([]);
});

test('race: an add waiting on a delete of its Tag makes a fresh Tag once the delete commits', async () => {
  const a = await signInTestUser('a');
  const bread = await a.data.createRecipe(recipe('Garlic bread', 'garlic'));
  const ragu = await a.data.createRecipe(recipe("Nonna's ragù", 'beef mince'));
  const italian = await a.data.addTag(ragu, 'Italian');

  const deleting = await holdTagDelete(a, italian.id);
  const adding = a.data.addTag(bread, 'ITALIAN');
  await deleting.waitForWaiting(1);
  await deleting.commit();

  const added = await adding;
  expect(added).toEqual({ id: expect.any(String), name: 'ITALIAN' });
  expect(added.id).not.toBe(italian.id);
  expect(shown(await a.data.listTagsWithRecipes())).toEqual([['ITALIAN', ['Garlic bread']]]);
  expect(tagNames(await a.data.getRecipe(ragu))).toEqual([]);
});

test('race: a delete waiting on an add of its Tag takes the Tag off that Recipe too', async () => {
  const a = await signInTestUser('a');
  const bread = await a.data.createRecipe(recipe('Garlic bread', 'garlic'));
  const ragu = await a.data.createRecipe(recipe("Nonna's ragù", 'beef mince'));
  const italian = await a.data.addTag(ragu, 'Italian');

  const adding = await holdTagAdd(a, bread, 'italian');
  const deleting = a.data.deleteTag(italian.id);
  await adding.waitForWaiting(1);
  await adding.commit();

  expect(await deleting).toEqual({ status: 'deleted' });
  expect(await a.data.listTagsWithRecipes()).toEqual([]);
  expect(tagNames(await a.data.getRecipe(bread))).toEqual([]);
  expect(tagNames(await a.data.getRecipe(ragu))).toEqual([]);
});

test('race: two deletes of one Tag answer deleted once and gone once', async () => {
  const a = await signInTestUser('a');
  const bread: RecipeId = await a.data.createRecipe(recipe('Garlic bread', 'garlic'));
  const italian = await a.data.addTag(bread, 'Italian');

  const first = await holdTagDelete(a, italian.id);
  const second = a.data.deleteTag(italian.id);
  await first.waitForWaiting(1);
  await first.commit();

  expect(await second).toEqual({ status: 'gone' });
  expect(await a.data.listTagsWithRecipes()).toEqual([]);
  expect(tagNames(await a.data.getRecipe(bread))).toEqual([]);
});
