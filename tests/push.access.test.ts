// Access-rule tests for ticket 07: push tokens and the daily limit. Users call PostgREST directly
// with their own session, as an attacker would. A user reads only their own push tokens and writes
// them only through register_push_token and forget_push_token; only the Draft builder (the service
// role) reads anyone's tokens to send a push, or forgets a token Expo reports gone. The daily limit
// holds for a raw call of save_from_link too.
import { expect, test } from 'vitest';

import { FULL_RECIPE } from '../supabase/functions/_shared/draft-fixtures';
import { createTestClient, signInAttacker, type Attacker } from './access-harness';
import { screenshotBytes } from './screenshot-fixture';

const TOKEN = 'ExponentPushToken[ownerownerownerowner01]';
const OTHER = 'ExponentPushToken[strangerstranger0001]';
const permissionDenied = { code: '42501' };

/** The push tokens `who` can see. */
async function tokensSeenBy(who: Attacker) {
  const { data, error } = await who.client.from('push_tokens').select('token, user_id');
  if (error) throw error;
  return data;
}

test('a user reads their own push tokens; a stranger sees none of them', async () => {
  const owner = await signInAttacker('owner');
  const stranger = await signInAttacker('stranger');
  await owner.data.registerPushToken(TOKEN);

  expect(await tokensSeenBy(owner)).toEqual([{ token: TOKEN, user_id: owner.userId }]);
  expect(await tokensSeenBy(stranger)).toEqual([]);
  const byToken = await stranger.client.from('push_tokens').select('*').eq('token', TOKEN);
  expect(byToken).toMatchObject({ data: [], error: null });
});

test('a user cannot add, change or delete push tokens directly, even their own', async () => {
  const owner = await signInAttacker('owner');
  const stranger = await signInAttacker('stranger');
  await owner.data.registerPushToken(TOKEN);

  const insert = await stranger.client.from('push_tokens').insert({ token: OTHER, user_id: owner.userId });
  const steal = await stranger.client.from('push_tokens').update({ user_id: stranger.userId }).eq('token', TOKEN);
  const ownUpdate = await owner.client.from('push_tokens').update({ last_seen_at: '2020-01-01' }).eq('token', TOKEN);
  const remove = await owner.client.from('push_tokens').delete().eq('token', TOKEN);

  expect(insert.error).toMatchObject(permissionDenied);
  expect(steal.error).toMatchObject(permissionDenied);
  expect(ownUpdate.error).toMatchObject(permissionDenied);
  expect(remove.error).toMatchObject(permissionDenied);
  expect(await tokensSeenBy(owner)).toEqual([{ token: TOKEN, user_id: owner.userId }]);
});

test("a stranger cannot forget someone else's push token", async () => {
  const owner = await signInAttacker('owner');
  const stranger = await signInAttacker('stranger');
  await owner.data.registerPushToken(TOKEN);

  const forget = await stranger.client.rpc('forget_push_token', { token: TOKEN });

  expect(forget.error).toBeNull();
  expect(await tokensSeenBy(owner)).toEqual([{ token: TOKEN, user_id: owner.userId }]);
});

test('no one signed out can register or forget a push token', async () => {
  const owner = await signInAttacker('owner');
  await owner.data.registerPushToken(TOKEN);
  const anon = createTestClient();

  const register = await anon.rpc('register_push_token', { token: OTHER });
  const forget = await anon.rpc('forget_push_token', { token: TOKEN });

  expect(register.error).toMatchObject(permissionDenied);
  expect(forget.error).toMatchObject(permissionDenied);
  expect(await tokensSeenBy(owner)).toEqual([{ token: TOKEN, user_id: owner.userId }]);
});

test("a user cannot read anyone's push tokens for a Draft, nor make the server forget tokens", async () => {
  const owner = await signInAttacker('owner');
  const stranger = await signInAttacker('stranger');
  await owner.data.registerPushToken(TOKEN);
  const { recipeId } = await owner.data.saveFromLink({ url: FULL_RECIPE.url });
  await owner.drafts.settled();

  const ownTargets = await owner.client.rpc('draft_ready_push', { recipe_id: recipeId });
  const targets = await stranger.client.rpc('draft_ready_push', { recipe_id: recipeId });
  const forget = await stranger.client.rpc('forget_push_tokens', { tokens: [TOKEN] });

  expect(ownTargets.error).toMatchObject(permissionDenied);
  expect(targets.error).toMatchObject(permissionDenied);
  expect(forget.error).toMatchObject(permissionDenied);
  expect(await tokensSeenBy(owner)).toEqual([{ token: TOKEN, user_id: owner.userId }]);
});

test('a raw save_from_link at the limit makes nothing, and a screenshot uploaded for it is removed', async () => {
  const owner = await signInAttacker('owner');
  for (let i = 0; i < 30; i += 1) await owner.data.saveFromLink({ url: FULL_RECIPE.url });
  await owner.drafts.settled();
  const recipeId = owner.data.newDraftId();

  const raw = await owner.client.rpc('save_from_link', { recipe_id: recipeId, url: FULL_RECIPE.url, platform: 'tiktok' });
  const withScreenshot = owner.data.saveFromLink({
    url: 'https://www.instagram.com/reel/C1a2b3c4d5e/',
    screenshot: screenshotBytes(),
  });

  expect(raw.error).toBeNull();
  expect(raw.data).toMatchObject({ status: 'dailyLimitReached', limit: 30 });
  await expect(withScreenshot).rejects.toMatchObject({ code: 'daily_limit_reached' });
  const recipes = await owner.client.from('recipes').select('id').eq('id', recipeId);
  expect(recipes).toMatchObject({ data: [], error: null });
  const folder = await owner.client.storage.from('recipe-images').list(owner.userId);
  expect(folder).toMatchObject({ data: [], error: null });
  expect(await owner.data.listDrafts()).toHaveLength(30);
});
