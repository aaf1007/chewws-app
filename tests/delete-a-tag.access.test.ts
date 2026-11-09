// Access-rule tests for ticket 22: the Tags list, its counts and deleting a Tag. A stranger and a
// Friend (who reads the owner's logged Recipe, ticket 19) skip the data layer and call PostgREST
// directly with their own session, as an attacker would. What stops them is ticket 06's owner-only
// policies on `tags` and `recipe_tags`. Each read test was checked to fail with its table's select
// policy loosened to `true`. A delete's filter has to read the row, so a delete is held by the
// table's select policy and its delete policy both (safeupdate refuses a delete with no filter):
// each delete test was checked to fail with the two loosened together, and to pass with either.
import { expect, test } from 'vitest';

import type { RecipeId, Tag } from '../src/data';
import { signInAttacker, type Attacker } from './access-harness';
import { uniqueUsername } from './harness';

async function named(label: string): Promise<Attacker> {
  const user = await signInAttacker(label);
  const result = await user.data.setUsername(uniqueUsername(label));
  if (result.status !== 'set') throw new Error(`Couldn't choose a username: ${result.status}`);
  return user;
}

type Setup = {
  owner: Attacker;
  friend: Attacker;
  stranger: Attacker;
  shakshuka: RecipeId;
  weeknight: Tag;
  leftovers: Tag;
};

/**
 * The owner's Shakshuka and Dal, both Tagged Weeknight, and Leftovers on neither. Shakshuka is
 * logged, so the owner's Friend reads it (ticket 19). The Friend and the stranger each have a
 * Weeknight Tag of their own, on a Recipe of theirs.
 */
async function ownersTags(): Promise<Setup> {
  const [owner, friend, stranger] = await Promise.all(['owner', 'friend', 'stranger'].map(named));
  expect(await owner.data.sendFriendRequest(friend.userId)).toEqual({ status: 'requested' });
  expect(await friend.data.respondToFriendRequest(owner.userId, true)).toEqual({ status: 'accepted' });
  const shakshuka = await owner.data.createRecipe({ title: 'Shakshuka', lines: [], steps: ['Cook it.'] });
  const dal = await owner.data.createRecipe({ title: 'Dal', lines: [], steps: ['Cook it.'] });
  const weeknight = await owner.data.addTag(shakshuka, 'Weeknight');
  await owner.data.addTag(dal, 'Weeknight');
  const leftovers = await owner.data.addTag(dal, 'Leftovers');
  await owner.data.removeTag(dal, leftovers.id);
  expect(await owner.data.addCookLog(shakshuka, { cookedOn: '2026-11-01' })).toMatchObject({ status: 'added' });
  expect((await friend.data.getRecipe(shakshuka))?.status).toBe('someoneElses');
  for (const other of [friend, stranger]) {
    await other.data.addTag(await other.data.createRecipe({ title: 'Toast', lines: [], steps: [] }), 'Weeknight');
  }
  return { owner, friend, stranger, shakshuka, weeknight, leftovers };
}

/** What the owner sees on their Tags screen, to check nothing changed. */
async function ownersTagsScreen({ owner }: Setup) {
  return (await owner.data.listTagsWithRecipes()).map((t) => [t.name, t.recipes.map((r) => r.title)]);
}

test("neither a stranger nor a Friend reads the owner's Tags, or their counts, by any read", async () => {
  const setup = await ownersTags();
  const { owner, weeknight, leftovers } = setup;

  for (const attacker of [setup.stranger, setup.friend]) {
    const all = await attacker.client.from('tags').select('id, name');
    const byOwner = await attacker.client.from('tags').select('id').eq('owner_id', owner.userId);
    const byId = await attacker.client.from('tags').select('id').in('id', [weeknight.id, leftovers.id]);
    const counted = await attacker.client.from('tags').select('name, recipe_tags(count)');
    const asTheScreenReads = await attacker.client.from('tags').select('name, recipe_tags(recipe:recipes(id, title))');

    expect(all).toMatchObject({ data: [{ name: 'Weeknight' }], error: null });
    expect(all.data?.[0].id).not.toBe(weeknight.id);
    expect(byOwner).toMatchObject({ data: [], error: null });
    expect(byId).toMatchObject({ data: [], error: null });
    expect(counted).toMatchObject({ data: [{ name: 'Weeknight', recipe_tags: [{ count: 1 }] }], error: null });
    expect(asTheScreenReads).toMatchObject({
      data: [{ name: 'Weeknight', recipe_tags: [{ recipe: { title: 'Toast' } }] }],
      error: null,
    });
    expect((await attacker.data.listTagsWithRecipes()).map((t) => [t.name, t.recipes.map((r) => r.title)])).toEqual([
      ['Weeknight', ['Toast']],
    ]);
  }
});

test("neither a stranger nor a Friend reads which of the owner's Recipes a Tag is on, or how many", async () => {
  const setup = await ownersTags();
  const { shakshuka, weeknight } = setup;

  for (const attacker of [setup.stranger, setup.friend]) {
    const byTag = await attacker.client.from('recipe_tags').select('recipe_id').eq('tag_id', weeknight.id);
    const onRecipe = await attacker.client.from('recipe_tags').select('tag_id').eq('recipe_id', shakshuka);
    const count = await attacker.client
      .from('recipe_tags')
      .select('*', { count: 'exact', head: true })
      .eq('tag_id', weeknight.id);
    const fromTheRecipe = await attacker.client.from('recipes').select('id, recipe_tags(tag_id)').eq('id', shakshuka);

    expect(byTag).toMatchObject({ data: [], error: null });
    expect(onRecipe).toMatchObject({ data: [], error: null });
    expect(count).toMatchObject({ count: 0, error: null });
    expect(fromTheRecipe).toMatchObject({ data: [], error: null });
  }
});

test("neither a stranger nor a Friend deletes the owner's Tag: deleteTag answers gone, and it stays on its Recipes", async () => {
  const setup = await ownersTags();
  const { weeknight, leftovers } = setup;
  const before = await ownersTagsScreen(setup);
  expect(before).toEqual([
    ['Leftovers', []],
    ['Weeknight', ['Dal', 'Shakshuka']],
  ]);

  for (const attacker of [setup.stranger, setup.friend]) {
    const direct = await attacker.client.from('tags').delete().eq('id', weeknight.id).select('id');
    const unused = await attacker.client.from('tags').delete().eq('id', leftovers.id).select('id');
    const everyWeeknight = await attacker.client.from('tags').delete().eq('name', 'Weeknight').select('owner_id');

    expect(direct).toMatchObject({ data: [], error: null });
    expect(unused).toMatchObject({ data: [], error: null });
    // Only their own Weeknight goes.
    expect(everyWeeknight).toMatchObject({ data: [{ owner_id: attacker.userId }], error: null });
    expect(await attacker.data.deleteTag(weeknight.id)).toEqual({ status: 'gone' });
    expect(await attacker.data.deleteTag(leftovers.id)).toEqual({ status: 'gone' });
  }
  expect(await ownersTagsScreen(setup)).toEqual(before);
});

test("neither a stranger nor a Friend takes the owner's Tag off the owner's Recipes", async () => {
  const setup = await ownersTags();
  const { shakshuka, weeknight } = setup;
  const before = await ownersTagsScreen(setup);

  for (const attacker of [setup.stranger, setup.friend]) {
    const one = await attacker.client
      .from('recipe_tags')
      .delete()
      .eq('recipe_id', shakshuka)
      .eq('tag_id', weeknight.id)
      .select();
    const everyRecipe = await attacker.client.from('recipe_tags').delete().eq('tag_id', weeknight.id).select();

    expect(one).toMatchObject({ data: [], error: null });
    expect(everyRecipe).toMatchObject({ data: [], error: null });
  }
  expect(await ownersTagsScreen(setup)).toEqual(before);
});
