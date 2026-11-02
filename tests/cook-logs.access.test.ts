// Access-rule tests for ticket 16: Cook Logs (decisions 16). A stranger, an unfriended user and a
// Friend skip the data layer and call PostgREST and Storage directly with their own session, as an
// attacker would. RLS, the table grants, the checks inside the Cook Log functions and the two rules
// (private.can_read_cook_logs_of, private.can_be_cook_log_companion) are what have to stop them.
import { expect, inject, test } from 'vitest';

import type { CookLogId, RecipeId } from '../src/data';
import { FULL_RECIPE } from '../supabase/functions/_shared/draft-fixtures';
import { createTestClient, signInAttacker, type Attacker } from './access-harness';
import {
  cookLogCompanionWriters,
  cookLogPolicies,
  functionsRestatingTheCompanionRule,
  functionsRestatingTheCookLogReadRule,
  functionsRestatingTheFriendRule,
  functionsRestatingTheMembershipRule,
  storedCookLogPhotos,
  uniqueUsername,
} from './harness';
import { SCREENSHOT_BASE64, screenshotBytes } from './screenshot-fixture';

const permissionDenied = { code: '42501' };
const BUCKET = 'cook-log-photos';

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

/**
 * kim's Cook Log of her shakshuka, with jo as companion and a photo. sam is her Friend; ex was her
 * Friend until she unfriended him after logging; stranger is nobody to her. jo stays her Friend.
 */
async function logged() {
  const kim = await named('kim');
  const sam = await named('sam');
  const jo = await named('jo');
  const ex = await named('ex');
  const stranger = await named('stranger');
  await befriend(kim, sam);
  await befriend(kim, jo);
  await befriend(kim, ex);
  const recipe = await kim.data.createRecipe({ title: 'Shakshuka', lines: [], steps: [] });
  const result = await kim.data.addCookLog(recipe, {
    cookedOn: '2026-10-30',
    notes: 'Spicy',
    companions: [jo.userId],
    photos: [{ kind: 'new', jpeg: screenshotBytes() }],
  });
  if (result.status !== 'added') throw new Error(`No Cook Log: ${result.status}`);
  const logId = result.cookLogId;
  const [log] = await kim.data.listCookLogs(recipe);
  const photoPath = `${kim.userId}/${logId}/${log.photos[0].id}.jpg`;
  await kim.data.unfriend(ex.userId);
  const before = await kim.data.listCookLogs(recipe);
  /** kim's log is as it was (but for its photo's freshly signed link). */
  async function expectUnchanged() {
    const now = await kim.data.listCookLogs(recipe);
    const unsigned = (logs: typeof now) => logs.map((l) => ({ ...l, photos: l.photos.map((p) => p.id) }));
    expect(unsigned(now)).toEqual(unsigned(before));
    expect(await storedCookLogPhotos(kim)).toEqual([`${logId}/${log.photos[0].id}.jpg`]);
  }
  return { kim, sam, jo, ex, stranger, recipe, logId, photoPath, expectUnchanged };
}

/** The bytes at `path` in the bucket, downloaded as `who`, base64; null when they can't. */
async function downloaded(who: Attacker, path: string): Promise<string | null> {
  const { data, error } = await who.client.storage.from(BUCKET).download(path);
  return error ? null : Buffer.from(await data.arrayBuffer()).toString('base64');
}

/** Everything `user` could read of a log and its photo straight from the API. */
async function readsOf(user: Attacker, owner: Attacker, recipe: RecipeId, logId: CookLogId, photoPath: string) {
  const [logs, byRecipe, companions, photos, named, signed, listed] = await Promise.all([
    user.client.from('cook_logs').select('id, notes').eq('id', logId),
    user.client.from('cook_logs').select('id').eq('recipe_id', recipe),
    user.client.from('cook_log_companions').select('user_id').eq('cook_log_id', logId),
    user.client.from('cook_log_photos').select('id').eq('cook_log_id', logId),
    user.client.rpc('cook_log_companion_list', { cook_log_ids: [logId] }),
    user.client.storage.from(BUCKET).createSignedUrl(photoPath, 3600),
    user.client.storage.from(BUCKET).list(`${owner.userId}/${logId}`),
  ]);
  return {
    logs: logs.data,
    byRecipe: byRecipe.data,
    companions: companions.data,
    photos: photos.data,
    named: named.data,
    photo: await downloaded(user, photoPath),
    signed: signed.data?.signedUrl ? 'signed' : null,
    listed: (listed.data ?? []).map((file) => file.name),
  };
}

const nothing = {
  logs: [],
  byRecipe: [],
  companions: [],
  photos: [],
  named: [],
  photo: null,
  signed: null,
  listed: [],
};

test('a stranger, and a user unfriended since, read nothing of a Cook Log: not it, its companions or its photos', async () => {
  const { kim, sam, jo, ex, stranger, recipe, logId, photoPath, expectUnchanged } = await logged();

  for (const outsider of [stranger, ex]) {
    expect(await readsOf(outsider, kim, recipe, logId, photoPath)).toEqual(nothing);
    expect(await outsider.data.listCookLogs(recipe)).toEqual([]);
  }

  // A Friend reads all of it, through the same calls: they aren't refused for everyone.
  const samReads = await readsOf(sam, kim, recipe, logId, photoPath);
  expect(samReads).toEqual({
    logs: [{ id: logId, notes: 'Spicy' }],
    byRecipe: [{ id: logId }],
    companions: [{ user_id: jo.userId }],
    photos: [{ id: photoPath.split('/')[2].replace('.jpg', '') }],
    named: [{ cook_log_id: logId, user_id: jo.userId, username: expect.any(String) }],
    photo: SCREENSHOT_BASE64,
    signed: 'signed',
    listed: [photoPath.split('/')[2]],
  });
  // So does the owner.
  expect((await readsOf(kim, kim, recipe, logId, photoPath)).photo).toBe(SCREENSHOT_BASE64);
  await expectUnchanged();
});

test('the photos bucket is private: no public link and nothing signed out', async () => {
  const { kim, recipe, logId, photoPath } = await logged();
  const anon = createTestClient();

  const publicLink = kim.client.storage.from(BUCKET).getPublicUrl(photoPath).data.publicUrl;
  expect((await fetch(publicLink)).ok).toBe(false);
  expect((await anon.storage.from(BUCKET).download(photoPath)).data).toBeNull();
  const upload = await anon.storage.from(BUCKET).upload(`${kim.userId}/${logId}/${crypto.randomUUID()}.jpg`, screenshotBytes(), {
    contentType: 'image/jpeg',
  });
  expect(upload.error).not.toBeNull();

  for (const table of ['cook_logs', 'cook_log_companions', 'cook_log_photos'] as const) {
    expect((await anon.from(table).select('*')).error).toMatchObject(permissionDenied);
  }
  const signedOut = [
    await anon.rpc('add_cook_log', { id: crypto.randomUUID(), recipe_id: recipe, cooked_on: '2026-10-30' }),
    await anon.rpc('edit_cook_log', { id: logId, notes: 'x' }),
    await anon.rpc('delete_cook_log', { id: logId }),
    await anon.rpc('cook_log_companion_list', { cook_log_ids: [logId] }),
  ];
  for (const { error } of signedOut) expect(error).toMatchObject(permissionDenied);
});

test("nobody else adds, edits or deletes a Cook Log on someone's Recipe, a Friend included", async () => {
  const { kim, sam, ex, stranger, recipe, logId, photoPath, expectUnchanged } = await logged();

  for (const other of [stranger, ex, sam]) {
    const answers = {
      add: (await other.client.rpc('add_cook_log', { id: crypto.randomUUID(), recipe_id: recipe, cooked_on: '2026-10-31' })).data,
      edit: (await other.client.rpc('edit_cook_log', { id: logId, notes: 'Mine now', remove_companions: [kim.userId] })).data,
      delete: (await other.client.rpc('delete_cook_log', { id: logId })).data,
      // Taking the log's id for a log of their own is refused too.
      takeId: (await other.client.rpc('add_cook_log', { id: logId, recipe_id: await other.data.createRecipe({ title: 'Toast', lines: [], steps: [] }), cooked_on: '2026-10-31' })).error?.code,
    };
    expect(answers).toEqual({ add: { status: 'noSuchRecipe' }, edit: { status: 'notFound' }, delete: { status: 'notFound' }, takeId: '23505' });

    // The tables take no writes at all, not even of one's own.
    const insert = await other.client.from('cook_logs').insert({ id: crypto.randomUUID(), user_id: other.userId, recipe_id: recipe, cooked_on: '2026-10-31' });
    const update = await other.client.from('cook_logs').update({ notes: 'Mine now' }).eq('id', logId);
    const remove = await other.client.from('cook_logs').delete().eq('id', logId);
    const companion = await other.client.from('cook_log_companions').insert({ cook_log_id: logId, user_id: other.userId });
    const unCompanion = await other.client.from('cook_log_companions').delete().eq('cook_log_id', logId);
    const photo = await other.client.from('cook_log_photos').insert({ id: crypto.randomUUID(), cook_log_id: logId, position: 2 });
    for (const write of [insert, update, remove, companion, unCompanion, photo]) expect(write.error).toMatchObject(permissionDenied);

    // In Storage: no upload into kim's folder, no overwrite and no delete of her photo.
    const plant = await other.client.storage.from(BUCKET).upload(`${kim.userId}/${logId}/${crypto.randomUUID()}.jpg`, screenshotBytes(), {
      contentType: 'image/jpeg',
    });
    const overwrite = await other.client.storage.from(BUCKET).upload(photoPath, screenshotBytes(), { contentType: 'image/jpeg', upsert: true });
    await other.client.storage.from(BUCKET).remove([photoPath]);
    expect(plant.error).not.toBeNull();
    expect(overwrite.error).not.toBeNull();
  }
  expect((await sam.client.storage.from(BUCKET).download(photoPath)).error).toBeNull();
  await expectUnchanged();
});

test('the server refuses what the app never sends: a day past tomorrow, notes over 2000 characters, more than 4 photos', async () => {
  const { kim, recipe, logId } = await logged();
  const later = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  const tooLong = 'é'.repeat(2001);
  const fivePhotos = Array.from({ length: 5 }, () => crypto.randomUUID());
  const add = (args: { cooked_on?: string; notes?: string; photos?: string[] }) =>
    kim.client.rpc('add_cook_log', { id: crypto.randomUUID(), recipe_id: recipe, cooked_on: '2026-10-30', ...args });

  expect((await add({ cooked_on: later })).error?.code).toBe('22023');
  expect((await add({ cooked_on: '2999-01-01' })).error?.code).toBe('22023');
  expect((await add({ notes: tooLong })).error?.code).toBe('22001');
  expect((await add({ photos: fivePhotos })).error?.code).toBe('22023');

  const edit = (args: { cooked_on?: string; notes?: string; add_photos?: string[] }) =>
    kim.client.rpc('edit_cook_log', { id: logId, ...args });
  expect((await edit({ cooked_on: later })).error?.code).toBe('22023');
  expect((await edit({ notes: tooLong })).error?.code).toBe('22001');
  expect((await edit({ add_photos: fivePhotos })).data).toEqual({ status: 'tooManyPhotos' });

  // Exactly 2000 characters and tomorrow are fine, as the app allows them.
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  expect((await add({ cooked_on: tomorrow, notes: 'é'.repeat(2000) })).data).toEqual({ status: 'added' });
  expect((await kim.data.listCookLogs(recipe)).map((l) => l.cookedOn)).toEqual([tomorrow, '2026-10-30']);
});

test('a user can only log their own reviewed Recipes, with Friends as companions, and photos they uploaded', async () => {
  const { kim, jo, ex, stranger, recipe, photoPath } = await logged();
  const own = await stranger.data.createRecipe({ title: 'Toast', lines: [], steps: [] });
  const { recipeId: draft } = await stranger.data.saveFromLink({ url: FULL_RECIPE.url });
  await stranger.drafts.settled();
  const add = async (args: { recipe_id: string; companions?: string[]; photos?: string[]; cook_plan_id?: string }) =>
    (await stranger.client.rpc('add_cook_log', { id: crypto.randomUUID(), cooked_on: '2026-10-31', ...args })).data;

  expect(await add({ recipe_id: draft })).toEqual({ status: 'notReviewed' });
  expect(await add({ recipe_id: recipe })).toEqual({ status: 'noSuchRecipe' });
  expect(await add({ recipe_id: own, companions: [kim.userId] })).toEqual({ status: 'notCompanion', userId: kim.userId });
  expect(await add({ recipe_id: own, companions: [stranger.userId] })).toEqual({ status: 'notCompanion', userId: stranger.userId });
  // kim's photo isn't one the stranger uploaded, whatever its id.
  expect(await add({ recipe_id: own, photos: [photoPath.split('/')[2].replace('.jpg', '')] })).toEqual({ status: 'photoNotUploaded' });
  expect(await stranger.data.listCookLogs(own)).toEqual([]);
  expect(await stranger.data.listCookLogs(draft)).toEqual([]);

  // ex, unfriended, can't be added to a log of kim's any more: not on a new one, nor on an edit.
  const kimsNew = await kim.client.rpc('add_cook_log', { id: crypto.randomUUID(), recipe_id: recipe, cooked_on: '2026-10-31', companions: [ex.userId] });
  expect(kimsNew.data).toEqual({ status: 'notCompanion', userId: ex.userId });
  const [log] = await kim.data.listCookLogs(recipe);
  const kimsEdit = await kim.client.rpc('edit_cook_log', { id: log.id, add_companions: [ex.userId] });
  expect(kimsEdit.data).toEqual({ status: 'notCompanion', userId: ex.userId });
  expect((await kim.data.listCookLogs(recipe)).map((l) => l.companions.map((c) => c.id))).toEqual([[jo.userId]]);
});

test('a companion stays on the Cook Log after an unfriend', async () => {
  const { kim, jo, sam, recipe, logId } = await logged();
  await kim.data.unfriend(jo.userId);

  // kim still sees jo on it, by username; sam, still her Friend, too.
  for (const reader of [kim, sam]) {
    const { data } = await reader.client.from('cook_log_companions').select('user_id').eq('cook_log_id', logId);
    expect(data).toEqual([{ user_id: jo.userId }]);
    const named = await reader.client.rpc('cook_log_companion_list', { cook_log_ids: [logId] });
    expect(named.data).toEqual([{ cook_log_id: logId, user_id: jo.userId, username: expect.any(String) }]);
  }
  // jo, no longer kim's Friend, doesn't read the log he's on.
  expect((await jo.client.from('cook_logs').select('id').eq('id', logId)).data).toEqual([]);
  expect(await jo.data.listCookLogs(recipe)).toEqual([]);
});

test('the private rules are not exposed through the Data API', async () => {
  const { kim, jo, logId } = await logged();
  const { url, anonKey } = inject('supabase');
  const { data } = await jo.client.auth.getSession();
  const token = data.session?.access_token ?? '';
  for (const [fn, args] of [
    ['can_read_cook_logs_of', { owner: kim.userId }],
    ['can_be_cook_log_companion', { logger: jo.userId, companion: kim.userId, plan_id: null }],
    ['cook_log_photo_uploaded', { cook_log_id: logId, photo_id: logId }],
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
});

test('who reads Cook Logs, and whom a user may cook with, are each decided in one place', async () => {
  // Every policy on the Cook Log tables and photos asks the read rule; the photo writes are the owner's.
  expect(await cookLogPolicies()).toEqual([
    'cook_log_companions SELECT: private.can_read_cook_logs_of(( SELECT l.user_id FROM cook_logs l WHERE (l.id = cook_log_companions.cook_log_id)))',
    'cook_log_photos SELECT: private.can_read_cook_logs_of(( SELECT l.user_id FROM cook_logs l WHERE (l.id = cook_log_photos.cook_log_id)))',
    'cook_logs SELECT: private.can_read_cook_logs_of(user_id)',
    "objects DELETE: ((bucket_id = 'cook-log-photos'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text))",
    "objects INSERT: ((bucket_id = 'cook-log-photos'::text) AND (name ~ ((('^'::text || (( SELECT auth.uid() AS uid))::text) || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'::text) || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.jpg$'::text)))",
    "objects SELECT: ((bucket_id = 'cook-log-photos'::text) AND private.can_read_cook_logs_of( CASE WHEN (name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'::text) THEN (split_part(name, '/'::text, 1))::uuid ELSE NULL::uuid END))",
  ]);
  // Only the read rule itself asks are_friends about Cook Logs.
  expect(await functionsRestatingTheCookLogReadRule()).toEqual([]);
  // Companions are added in exactly these two places, and each asks the companion rule.
  expect(await cookLogCompanionWriters()).toEqual(['public.add_cook_log: asks', 'public.edit_cook_log: asks']);
  expect(await functionsRestatingTheCompanionRule()).toEqual([]);
  // And neither restates "is a Friend" or "is in the plan" (decisions 11 and 14).
  expect(await functionsRestatingTheFriendRule()).toEqual([]);
  expect(await functionsRestatingTheMembershipRule()).toEqual([]);
});
