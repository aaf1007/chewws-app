// Access-rule tests for ticket 19: Friend profiles (decisions 19, user decision 5). A stranger, a
// user unfriended since, and a Friend skip the data layer and call PostgREST and Storage directly
// with their own session, as an attacker would. What has to stop them: the Friend rule
// (private.are_friends, through list_friends and private.can_see_activity_of), the Recipe read rule
// (private.can_read_recipe, widened to Recipes a Friend ranked or logged), and the owner-only
// policies on Recipe rows, Source Video rows, Tags and the screenshots' bucket.
import { expect, inject, test } from 'vitest';

import type { RecipeId } from '../src/data';
import { FULL_RECIPE, PASTED_CAPTION } from '../supabase/functions/_shared/draft-fixtures';
import { createTestClient, signInAttacker, type Attacker } from './access-harness';
import {
  friendshipReadersNotAllowed,
  functionsAskingTheActivityRule,
  functionsAskingTheRecipeReadRule,
  functionsRestatingTheActivityRule,
  functionsRestatingTheFriendRule,
  functionsRestatingTheRecipeReadRule,
  recipePartReadPolicies,
  uniqueUsername,
} from './harness';
import { SCREENSHOT_BASE64, screenshotBytes } from './screenshot-fixture';

const permissionDenied = { code: '42501' };
const REEL = 'https://www.instagram.com/reel/C1a2b3c4d5e/';

async function named(label: string): Promise<Attacker> {
  const user = await signInAttacker(label);
  const result = await user.data.setUsername(uniqueUsername(label));
  if (result.status !== 'set') throw new Error(`Couldn't choose a username: ${result.status}`);
  return user;
}

async function befriend(a: Attacker, b: Attacker) {
  expect(await a.data.sendFriendRequest(b.userId)).toEqual({ status: 'requested' });
  expect(await b.data.respondToFriendRequest(a.userId, true)).toEqual({ status: 'accepted' });
}

/** A Draft of `owner`'s, built and reviewed with `tags`, as its builder made it. */
async function reviewed(owner: Attacker, saved: Promise<{ recipeId: RecipeId }>, tags: string[]): Promise<RecipeId> {
  const { recipeId } = await saved;
  await owner.drafts.settled();
  const draft = await owner.data.getRecipe(recipeId);
  if (!draft) throw new Error('No Draft.');
  const lines = draft.lines.map((l) => ({ originalText: l.originalText, amountText: l.amountText, ingredientName: l.ingredient.name }));
  await owner.data.reviewDraft(recipeId, { title: draft.title, lines, steps: draft.steps }, tags);
  return recipeId;
}

/**
 * sam's activity. He saved an Instagram Reel with his screenshot and a pasted caption, Tagged it,
 * marked it Want to Cook, logged it (with jo and a photo) and ranked it Liked. He logged a TikTok
 * Recipe without ranking it. He also has a Recipe he never cooked and a Draft. kim and jo are his
 * Friends; ex was until sam unfriended him; declined asked to be his Friend and sam declined;
 * stranger is nobody to him.
 */
async function samsActivity() {
  const [sam, kim, jo, ex, declined, stranger] = await Promise.all(['sam', 'kim', 'jo', 'ex', 'declined', 'stranger'].map(named));
  for (const friend of [kim, jo, ex]) await befriend(sam, friend);
  expect(await declined.data.sendFriendRequest(sam.userId)).toEqual({ status: 'requested' });
  expect(await sam.data.respondToFriendRequest(declined.userId, false)).toEqual({ status: 'declined' });
  const reel = await reviewed(
    sam,
    sam.data.saveFromLink({ url: REEL, screenshot: screenshotBytes(), caption: PASTED_CAPTION.text }),
    ['Weeknight'],
  );
  await sam.data.setWantToCook(reel, true);
  const added = await sam.data.addCookLog(reel, {
    cookedOn: '2026-10-30',
    notes: 'Crispy skin',
    companions: [jo.userId],
    photos: [{ kind: 'new', jpeg: screenshotBytes() }],
  });
  if (added.status !== 'added') throw new Error(`No Cook Log: ${added.status}`);
  const logId = added.cookLogId;
  const placed = await sam.data.placeInRanking(sam.data.skipComparisons(await sam.data.startRanking(reel, 'liked')));
  expect(placed.status).toBe('placed');
  const pasta = await reviewed(sam, sam.data.saveFromLink({ url: FULL_RECIPE.url }), []);
  expect((await sam.data.addCookLog(pasta, { cookedOn: '2026-10-31' })).status).toBe('added');
  const uncooked = await sam.data.createRecipe({
    title: 'Secret stew',
    lines: [{ originalText: '1 onion', amountText: '1', ingredientName: 'onion' }],
    steps: [],
  });
  const { recipeId: draft } = await sam.data.saveFromLink({ url: FULL_RECIPE.url });
  await sam.drafts.settled();
  const [log] = await sam.data.listCookLogs(reel);
  const photoPath = `${sam.userId}/${logId}/${log.photos[0].id}.jpg`;
  await sam.data.unfriend(ex.userId);
  return { sam, kim, jo, ex, declined, stranger, reel, pasta, uncooked, draft, logId, photoPath };
}

type Activity = Awaited<ReturnType<typeof samsActivity>>;

/** Everything `user` could read of sam's profile, Recipes, Cook Logs and Ranking straight from the API. */
async function readsOf(user: Attacker, { sam, reel, pasta, uncooked, draft, logId, photoPath }: Activity) {
  const ids = [reel, pasta, uncooked, draft];
  const [friends, profile, shared, lines, titles, videos, rows, logs, companions, photos, named, signed, listed, ranking] =
    await Promise.all([
      user.client.rpc('list_friends'),
      user.client.rpc('get_profile', { user_id: sam.userId }),
      Promise.all(ids.map((id) => user.client.rpc('shared_recipe', { recipe_id: id }).select('id, title'))),
      user.client.from('recipe_lines').select('recipe_id').in('recipe_id', ids),
      user.client.rpc('recipe_titles', { recipe_ids: ids }),
      user.client.from('source_videos').select('recipe_id').in('recipe_id', ids),
      user.client.from('recipes').select('id').in('id', ids),
      user.client.from('cook_logs').select('id, recipe_id, notes').eq('user_id', sam.userId),
      user.client.from('cook_log_companions').select('user_id').eq('cook_log_id', logId),
      user.client.from('cook_log_photos').select('id').eq('cook_log_id', logId),
      user.client.rpc('cook_log_companion_list', { cook_log_ids: [logId] }),
      user.client.storage.from('cook-log-photos').createSignedUrl(photoPath, 3600),
      user.client.storage.from('cook-log-photos').list(`${sam.userId}/${logId}`),
      user.client.from('ranking_entries').select('recipe_id, band, position').eq('user_id', sam.userId),
    ]);
  const download = await user.client.storage.from('cook-log-photos').download(photoPath);
  return {
    profile: (friends.data ?? []).filter((f) => f.id === sam.userId).map((f) => f.id),
    username: (profile.data ?? []).map((p) => p.id),
    shared: shared.flatMap((s): unknown[] => s.data ?? [s.error?.code]),
    lines: [...new Set((lines.data ?? []).map((l) => l.recipe_id))].sort(),
    titles: (titles.data ?? []).map((t) => t.title).sort(),
    videos: videos.data,
    rows: rows.data,
    logs: (logs.data ?? []).map((l) => l.recipe_id).sort(),
    companions: companions.data,
    photos: (photos.data ?? []).length,
    named: (named.data ?? []).length,
    photo: download.error ? null : Buffer.from(await download.data.arrayBuffer()).toString('base64'),
    signed: signed.data?.signedUrl ? 'signed' : null,
    listed: (listed.data ?? []).length,
    ranking: ranking.data,
  };
}

const nothing = {
  profile: [],
  username: [],
  shared: [],
  lines: [],
  titles: [],
  videos: [],
  rows: [],
  logs: [],
  companions: [],
  photos: 0,
  named: 0,
  photo: null,
  signed: null,
  listed: 0,
  ranking: [],
};

test('a stranger, a user unfriended since and one declined read nothing: not the profile, the Recipes, the Cook Logs, their photos or the Ranking', async () => {
  const activity = await samsActivity();
  const { sam, stranger, ex, declined, reel, pasta } = activity;

  // Someone declined still sees sam's username, as in search (decisions 11), and nothing more.
  expect(await readsOf(declined, activity)).toEqual({ ...nothing, username: [sam.userId] });
  for (const outsider of [stranger, ex, declined]) {
    if (outsider !== declined) expect(await readsOf(outsider, activity)).toEqual(nothing);
    for (const id of [reel, pasta]) {
      expect((await outsider.client.rpc('copy_recipe', { recipe_id: id })).data).toEqual({ status: 'notFound' });
    }
    expect(await outsider.client.from('recipes').select('id').eq('owner_id', outsider.userId)).toMatchObject({ data: [] });
  }
});

test('a Friend reads the profile, Cook Logs and Ranking, and only the Recipes ranked or logged', async () => {
  const activity = await samsActivity();
  const { sam, kim, jo, reel, pasta, uncooked, draft } = activity;

  const reelTitle = (await sam.data.getRecipe(reel))?.title ?? '';
  const pastaTitle = (await sam.data.getRecipe(pasta))?.title ?? '';
  expect(await readsOf(kim, activity)).toEqual({
    profile: [sam.userId],
    username: [sam.userId],
    // The ranked Reel and the logged pasta; never the uncooked Recipe or the Draft.
    shared: [
      { id: reel, title: reelTitle },
      { id: pasta, title: pastaTitle },
    ],
    lines: [reel, pasta].sort(),
    titles: [reelTitle, pastaTitle].sort(),
    // The Recipe and Source Video rows themselves stay sam's alone.
    videos: [],
    rows: [],
    logs: [reel, pasta].sort(),
    companions: [{ user_id: jo.userId }],
    photos: 1,
    named: 1,
    photo: SCREENSHOT_BASE64,
    signed: 'signed',
    listed: 1,
    ranking: [{ recipe_id: reel, band: 'liked', position: 1 }],
  });
  for (const id of [uncooked, draft]) {
    expect((await kim.client.rpc('copy_recipe', { recipe_id: id })).data).toEqual({ status: 'notFound' });
    expect((await kim.client.from('recipe_lines').select('recipe_id').eq('recipe_id', id)).data).toEqual([]);
  }
  expect((await kim.client.rpc('copy_recipe', { recipe_id: reel })).data).toMatchObject({ status: 'copied' });
});

test("a Friend can't read the owner's screenshot, pasted caption, Want to Cook or Tags, nor change the Recipe", async () => {
  const { sam, kim, reel } = await samsActivity();

  // sam has all four on his Reel: they're there, and only he reads them.
  const own = await sam.client.from('source_videos').select('screenshot_path, pasted_text').eq('recipe_id', reel).single();
  expect(own.data).toEqual({ screenshot_path: `${sam.userId}/${reel}.jpg`, pasted_text: expect.any(String) });
  expect((await sam.client.from('recipe_tags').select('tag_id').eq('recipe_id', reel)).data).toHaveLength(1);

  const video = await kim.client.from('source_videos').select('screenshot_path, pasted_text').eq('recipe_id', reel);
  const row = await kim.client.from('recipes').select('want_to_cook_at, suggested_tags').eq('id', reel);
  const tags = await kim.client.from('recipe_tags').select('*').eq('recipe_id', reel);
  const tagNames = await kim.client.from('tags').select('name').eq('owner_id', sam.userId);
  expect(video).toMatchObject({ data: [], error: null });
  expect(row).toMatchObject({ data: [], error: null });
  expect(tags).toMatchObject({ data: [], error: null });
  expect(tagNames).toMatchObject({ data: [], error: null });
  const shared = await kim.client.rpc('shared_recipe', { recipe_id: reel }).select('*').single();
  expect(Object.keys(shared.data ?? {}).sort()).toEqual([
    'created_at',
    'id',
    'owner_id',
    'owner_username',
    'recipe_found',
    'source_caption',
    'source_creator_name',
    'source_creator_url',
    'source_external_id',
    'source_platform',
    'source_thumbnail_url',
    'source_url',
    'steps',
    'title',
    'updated_at',
  ]);
  expect(shared.data?.source_caption ?? null).toBeNull();
  // The screenshot: no download, no signed link.
  const path = `${sam.userId}/${reel}.jpg`;
  expect((await sam.client.storage.from('recipe-images').download(path)).error).toBeNull();
  expect((await kim.client.storage.from('recipe-images').download(path)).data).toBeNull();
  expect((await kim.client.storage.from('recipe-images').createSignedUrl(path, 3600)).data).toBeNull();

  // Reading isn't writing.
  const edit = await kim.client.rpc('edit_recipe', { recipe_id: reel, title: 'Mine now', steps: [], lines: [], list_lines: [] });
  const update = await kim.client.from('recipes').update({ title: 'Mine now' }).eq('id', reel).select('id');
  const removeLines = await kim.client.from('recipe_lines').delete().eq('recipe_id', reel).select('recipe_id');
  const wantToCook = await kim.client.rpc('set_want_to_cook', { recipe_id: reel, want_to_cook: false });
  const place = await kim.client.from('ranking_entries').delete().eq('recipe_id', reel);
  expect(edit).toMatchObject({ data: null, error: null });
  expect(update).toMatchObject({ data: [], error: null });
  expect(removeLines).toMatchObject({ data: [], error: null });
  expect(wantToCook).toMatchObject({ data: 'gone', error: null });
  expect(place.error).toMatchObject(permissionDenied);
  expect((await sam.data.getRecipe(reel))?.title).not.toBe('Mine now');
  expect((await sam.data.getRanking()).liked.map((r) => r.recipeId)).toEqual([reel]);
});

test('who reads a Friend’s activity, and the Recipes in it, is decided once each and never restated', async () => {
  // The activity rule is asked by the Cook Log rule and the Recipe rule, and restated by nothing.
  expect(await functionsAskingTheActivityRule()).toEqual(['private.can_read_cook_logs_of', 'private.can_read_recipe']);
  expect(await functionsRestatingTheActivityRule()).toEqual([]);
  // Every way to read another user's Recipe asks the Recipe rule: nothing new had to be taught it.
  expect(await functionsAskingTheRecipeReadRule()).toEqual([
    'private.cook_plan_recipe_list',
    'public.copy_recipe',
    'public.recipe_titles',
    'public.shared_recipe',
  ]);
  expect(await recipePartReadPolicies()).toEqual([
    'recipe_lines: private.can_read_recipe(recipe_id)',
    'source_videos: (EXISTS ( SELECT 1 FROM recipes r WHERE ((r.id = source_videos.recipe_id) AND (r.owner_id = ( SELECT auth.uid() AS uid)))))',
  ]);
  expect(await functionsRestatingTheRecipeReadRule()).toEqual([]);
  // "Friends since" comes from list_friends; no new reader of friendships.
  expect(await friendshipReadersNotAllowed()).toEqual([]);
  expect(await functionsRestatingTheFriendRule()).toEqual([]);
});

test('recipe_titles answers for at most 200 Recipes a call, and refuses more', async () => {
  const { kim, reel } = await samsActivity();
  const others = (n: number) => Array.from({ length: n }, () => crypto.randomUUID());

  const at200 = await kim.client.rpc('recipe_titles', { recipe_ids: [reel, ...others(199)] });
  expect(at200.error).toBeNull();
  expect((at200.data ?? []).map((t) => t.id)).toEqual([reel]);
  const at201 = await kim.client.rpc('recipe_titles', { recipe_ids: [reel, ...others(200)] });
  expect(at201).toMatchObject({ data: null, error: { code: '22023' } });
});

test('the rules are not exposed through the Data API, and signed out nothing answers', async () => {
  const { sam, kim, reel } = await samsActivity();
  const { url, anonKey } = inject('supabase');
  const { data } = await kim.client.auth.getSession();
  const token = data.session?.access_token ?? '';
  for (const [fn, args] of [
    ['can_see_activity_of', { owner: sam.userId, who: kim.userId }],
    ['can_read_recipe', { recipe_id: reel, who: kim.userId }],
  ] as const) {
    const response = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Profile': 'private',
      },
      body: JSON.stringify(args),
    });
    expect(response.status, fn).toBe(406);
  }

  const anon = createTestClient();
  for (const { error } of [
    await anon.rpc('recipe_titles', { recipe_ids: [reel] }),
    await anon.rpc('list_friends'),
    await anon.rpc('copy_recipe', { recipe_id: reel }),
  ]) {
    expect(error).toMatchObject(permissionDenied);
  }
});
