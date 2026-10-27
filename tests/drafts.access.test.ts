// Access-rule tests for Drafts (ticket 03): users call PostgREST directly with their own session,
// as an attacker would. Only the Draft builder (the service role) builds, finishes or fails a
// Draft and writes Source Videos; users can't touch the build columns or the link saves, and
// strangers can't see anyone else's Drafts.
import { expect, test } from 'vitest';

import type { RecipeId } from '../src/data';
import { FULL_RECIPE, UNREADABLE } from '../supabase/functions/_shared/draft-fixtures';
import { signInAttacker, type Attacker } from './access-harness';

async function builtDraft(owner: Attacker, url = FULL_RECIPE.url): Promise<RecipeId> {
  const { recipeId } = await owner.data.saveFromLink({ url });
  await owner.drafts.settled();
  return recipeId;
}

const permissionDenied = { code: '42501' };

test('a user cannot run the Draft builder’s functions, even on their own Draft', async () => {
  const owner = await signInAttacker('owner');
  const id = await builtDraft(owner, UNREADABLE.url);
  const before = await owner.data.getRecipe(id);

  const claim = await owner.client.rpc('claim_draft_build', { recipe_id: id });
  const finish = await owner.client.rpc('finish_draft', {
    recipe_id: id,
    result: { title: 'Free lunch', recipeFound: true, lines: [], steps: ['Eat.'] },
  });
  const failDraft = await owner.client.rpc('fail_draft', { recipe_id: id, reason: 'timed_out' });

  expect(claim.error).toMatchObject(permissionDenied);
  expect(finish.error).toMatchObject(permissionDenied);
  expect(failDraft.error).toMatchObject(permissionDenied);
  expect(await owner.data.getRecipe(id)).toEqual(before);
});

test('a user cannot write the build columns, status or recipeFound of their own Recipe', async () => {
  const owner = await signInAttacker('owner');
  const id = await builtDraft(owner, UNREADABLE.url);
  const before = await owner.data.getRecipe(id);

  const changes = [
    { build_status: 'built' as const, build_failure: null },
    { build_attempts: 0 },
    { build_started_at: null },
    { status: 'reviewed' as const },
    { recipe_found: false },
  ];
  for (const change of changes) {
    const { error } = await owner.client.from('recipes').update(change).eq('id', id);
    expect(error).toMatchObject(permissionDenied);
  }
  expect(await owner.data.getRecipe(id)).toEqual(before);
});

test('a user cannot add a Recipe that is a Draft, or one already building, by hand', async () => {
  const owner = await signInAttacker('owner');

  const draft = await owner.client.from('recipes').insert({ title: 'Sneaky', status: 'draft' });
  const building = await owner.client.from('recipes').insert({ title: 'Sneaky', build_status: 'building' });
  const attempts = await owner.client.from('recipes').insert({ title: 'Sneaky', build_attempts: -5 });

  expect(draft.error).toMatchObject(permissionDenied);
  expect(building.error).toMatchObject(permissionDenied);
  expect(attempts.error).toMatchObject(permissionDenied);
  expect(await owner.data.listDrafts()).toEqual([]);
});

test('a user cannot write Source Videos, even their own Recipe’s', async () => {
  const owner = await signInAttacker('owner');
  const id = await builtDraft(owner);
  const before = await owner.data.getRecipe(id);

  const insert = await owner.client
    .from('source_videos')
    .insert({ recipe_id: id, platform: 'tiktok', original_url: 'https://www.tiktok.com/@x/video/1' });
  const update = await owner.client
    .from('source_videos')
    .update({ thumbnail_url: 'https://evil.example/tracker.png' })
    .eq('recipe_id', id);
  const remove = await owner.client.from('source_videos').delete().eq('recipe_id', id);

  expect(insert.error).toMatchObject(permissionDenied);
  expect(update.error).toMatchObject(permissionDenied);
  expect(remove.error).toMatchObject(permissionDenied);
  expect(await owner.data.getRecipe(id)).toEqual(before);
});

test('a user cannot read, add or remove link saves', async () => {
  const owner = await signInAttacker('owner');
  await builtDraft(owner);

  const read = await owner.client.from('link_saves').select('*');
  const insert = await owner.client.from('link_saves').insert({ user_id: owner.userId });
  const remove = await owner.client.from('link_saves').delete().eq('user_id', owner.userId);

  expect(read.error).toMatchObject(permissionDenied);
  expect(insert.error).toMatchObject(permissionDenied);
  expect(remove.error).toMatchObject(permissionDenied);
});

test("a stranger cannot read someone else's Drafts or Source Videos", async () => {
  const owner = await signInAttacker('owner');
  const stranger = await signInAttacker('stranger');
  const id = await builtDraft(owner);

  const recipes = await stranger.client.from('recipes').select('*').eq('id', id);
  const sources = await stranger.client.from('source_videos').select('*').eq('recipe_id', id);
  const allSources = await stranger.client.from('source_videos').select('*');

  expect(recipes).toMatchObject({ data: [], error: null });
  expect(sources).toMatchObject({ data: [], error: null });
  expect(allSources).toMatchObject({ data: [], error: null });
});

test("a stranger cannot retry or review someone else's Draft", async () => {
  const owner = await signInAttacker('owner');
  const stranger = await signInAttacker('stranger');
  const id = await builtDraft(owner, UNREADABLE.url);
  const before = await owner.data.getRecipe(id);

  const retry = await stranger.client.rpc('retry_draft', { recipe_id: id });
  const review = await stranger.client.rpc('review_draft', {
    recipe_id: id,
    title: 'Mine now',
    steps: [],
    lines: [],
  });

  expect(retry).toMatchObject({ data: 'gone', error: null });
  expect(review).toMatchObject({ data: 'gone', error: null });
  expect(await owner.data.getRecipe(id)).toEqual(before);
});

test("saving a link under someone else's Recipe id is refused and changes nothing", async () => {
  const owner = await signInAttacker('owner');
  const stranger = await signInAttacker('stranger');
  const id = await builtDraft(owner);
  const before = await owner.data.getRecipe(id);

  const { error } = await stranger.client.rpc('save_from_link', {
    recipe_id: id,
    url: 'https://www.tiktok.com/@x/video/1',
    platform: 'tiktok',
  });

  expect(error).toMatchObject({ code: '23505' });
  expect(await owner.data.getRecipe(id)).toEqual(before);
  expect(await stranger.data.listDrafts()).toEqual([]);
});

test('saving something that is not a web link is refused', async () => {
  const owner = await signInAttacker('owner');

  const { error } = await owner.client.rpc('save_from_link', {
    recipe_id: crypto.randomUUID(),
    url: 'javascript:alert(1)',
    platform: 'web',
  });

  expect(error).toMatchObject({ code: '22023' });
  expect(await owner.data.listDrafts()).toEqual([]);
});
