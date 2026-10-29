// Ticket 07: the "Draft ready" push and the daily limit of 30 link saves (decisions 07). Builds run
// in-process with the fixtures and a recording push sender: no network, and no push really goes.
import { expect, test } from 'vitest';

import { DailyLimitError, parseDraftReadyPush, type RecipeId } from '../src/data';
import { ExtractError, type Extract } from '../supabase/functions/_shared/claude-extractor';
import {
  FULL_RECIPE,
  LINK_IN_BIO,
  PLAIN_PAGE,
  UNREADABLE,
  YOUTUBE_SHORT,
  fixtureAdapters,
  fixtureExtract,
} from '../supabase/functions/_shared/draft-fixtures';
import {
  backdateDraftBuild,
  backdateLinkSaves,
  countLinkSaves,
  holdLinkSave,
  seedLinkSaves,
  signInOnPhones,
  signInTestUser,
  type TestUser,
} from './harness';

const TOKEN_1 = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]';
const TOKEN_2 = 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]';
const REEL = 'https://www.instagram.com/reel/C1a2b3c4d5e/';
const HOUR = 60 * 60 * 1000;

const draftReady = (to: string, body: string, recipeId: RecipeId) => ({
  to,
  title: 'Draft ready',
  body,
  data: { kind: 'draftReady', recipeId },
});

async function savedAndBuilt(user: Pick<TestUser, 'data' | 'drafts'>, url: string): Promise<RecipeId> {
  const { recipeId } = await user.data.saveFromLink({ url });
  await user.drafts.settled();
  return recipeId;
}

/** `count` link saves the user made `hoursAgo` hours ago, a second apart. */
const savesAt = (count: number, hoursAgo: number, now = Date.now()) =>
  Array.from({ length: count }, (_, i) => new Date(now - hoursAgo * HOUR + i * 1000));

/** What a save the daily limit refused throws. */
async function refusal(saving: Promise<unknown>): Promise<{ code: string; limit: number; retryAt: string }> {
  const error = await saving.then(
    () => null,
    (e: unknown) => e,
  );
  if (!(error instanceof DailyLimitError)) throw new Error(`Expected the daily limit, got ${String(error)}`);
  return { code: error.code, limit: error.limit, retryAt: error.retryAt };
}

// The daily limit

test('the 30th link save in a day succeeds and the 31st is refused, with no Draft made or built for it', async () => {
  const a = await signInTestUser('a');
  const started = Date.now();

  const saved: RecipeId[] = [];
  for (let i = 0; i < 30; i += 1) saved.push((await a.data.saveFromLink({ url: FULL_RECIPE.url })).recipeId);
  await a.drafts.settled();
  const finished = Date.now();
  expect(saved).toHaveLength(30);
  expect(await a.data.getRecipe(saved[29])).toMatchObject({ status: 'draft', build: { status: 'built' } });

  const draftId = a.data.newDraftId();
  const refused = await refusal(a.data.saveFromLink({ url: FULL_RECIPE.url, draftId }));
  await a.drafts.settled();

  expect(refused).toMatchObject({ code: 'daily_limit_reached', limit: 30 });
  // When the first save turns 24 hours old.
  const retryAt = Date.parse(refused.retryAt);
  expect(retryAt).toBeGreaterThanOrEqual(started + 24 * HOUR - 1000);
  expect(retryAt).toBeLessThanOrEqual(finished + 24 * HOUR);
  expect(await a.data.getRecipe(draftId)).toBeNull();
  expect(await countLinkSaves(a)).toBe(30);
  expect(await a.data.listDrafts()).toHaveLength(30);
  expect(a.drafts.pushesSent()).toEqual([]);
});

test('the limit is a rolling 24 hours: a save counts until it is 24 hours old, and the refusal says when that is', async () => {
  const a = await signInTestUser('a');
  const now = Date.now();
  // Over 24 hours ago, so not counted; then 1 save 23 hours ago and 29 an hour ago.
  await seedLinkSaves(a, [new Date(now - 25 * HOUR), new Date(now - 23 * HOUR), ...savesAt(29, 1, now)]);

  expect(await refusal(a.data.saveFromLink({ url: FULL_RECIPE.url }))).toEqual({
    code: 'daily_limit_reached',
    limit: 30,
    retryAt: new Date(now + HOUR).toISOString(),
  });

  // An hour later the save from 23 hours ago is 24 hours old: there's room for one more.
  await backdateLinkSaves(a, 1);
  const id = await savedAndBuilt(a, FULL_RECIPE.url);
  expect(await a.data.getRecipe(id)).toMatchObject({ title: 'Creamy garlic pasta', build: { status: 'built' } });

  // Full again, until the oldest of the 29 (now 2 hours old) turns 24 hours old.
  expect(await refusal(a.data.saveFromLink({ url: FULL_RECIPE.url }))).toEqual({
    code: 'daily_limit_reached',
    limit: 30,
    retryAt: new Date(now - 2 * HOUR + 24 * HOUR).toISOString(),
  });
});

test('every link save counts: TikTok, YouTube, an Instagram Reel with nothing added and a plain page', async () => {
  const a = await signInTestUser('a');
  await seedLinkSaves(a, savesAt(26, 2));

  for (const url of [FULL_RECIPE.url, YOUTUBE_SHORT.url, REEL, PLAIN_PAGE.url]) await savedAndBuilt(a, url);

  expect(await countLinkSaves(a)).toBe(30);
  await expect(a.data.saveFromLink({ url: PLAIN_PAGE.url })).rejects.toBeInstanceOf(DailyLimitError);
});

test('deleting a Draft does not give its save back', async () => {
  const a = await signInTestUser('a');
  await seedLinkSaves(a, savesAt(29, 2));
  const id = await savedAndBuilt(a, FULL_RECIPE.url);

  await a.data.deleteRecipe(id);

  expect(await a.data.listDrafts()).toEqual([]);
  await expect(a.data.saveFromLink({ url: FULL_RECIPE.url })).rejects.toMatchObject({ code: 'daily_limit_reached' });
});

test('hand-written Recipes and Retries do not count toward the limit', async () => {
  const a = await signInTestUser('a');
  await seedLinkSaves(a, savesAt(28, 2));
  await a.data.createRecipe({
    title: 'Toast',
    lines: [{ originalText: '1 slice bread', amountText: '1 slice', ingredientName: 'bread' }],
    steps: ['Toast it.'],
  });
  const failed = await savedAndBuilt(a, UNREADABLE.url);
  await a.data.retryDraft(failed);
  await a.drafts.settled();

  expect(await countLinkSaves(a)).toBe(29);
  await savedAndBuilt(a, LINK_IN_BIO.url);
  await expect(a.data.saveFromLink({ url: LINK_IN_BIO.url })).rejects.toMatchObject({ code: 'daily_limit_reached' });
});

test('a save sent again after its answer was lost is never refused: it was counted the first time', async () => {
  const a = await signInTestUser('a');
  await seedLinkSaves(a, savesAt(29, 2));
  const draftId = a.data.newDraftId();

  const first = await a.data.saveFromLink({ url: FULL_RECIPE.url, draftId });
  const again = await a.data.saveFromLink({ url: FULL_RECIPE.url, draftId });
  await a.drafts.settled();

  expect(first).toEqual({ status: 'saved', recipeId: draftId });
  expect(again).toEqual({ status: 'saved', recipeId: draftId });
  expect(await countLinkSaves(a)).toBe(30);
  expect((await a.data.listDrafts()).map((d) => d.id)).toEqual([draftId]);
});

test('two saves at once cannot both be the 30th', async () => {
  const a = await signInTestUser('a');
  await seedLinkSaves(a, savesAt(29, 2));

  const results = await Promise.allSettled([
    a.data.saveFromLink({ url: FULL_RECIPE.url }),
    a.data.saveFromLink({ url: LINK_IN_BIO.url }),
  ]);
  await a.drafts.settled();

  expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
  const rejected = results.find((r) => r.status === 'rejected');
  expect(rejected?.reason).toBeInstanceOf(DailyLimitError);
  expect(await countLinkSaves(a)).toBe(30);
  expect(await a.data.listDrafts()).toHaveLength(1);
});

test('a save made while another is saving the 30th waits for it, then is refused', async () => {
  const a = await signInTestUser('a');
  await seedLinkSaves(a, savesAt(29, 2));
  const held = await holdLinkSave(a, LINK_IN_BIO.url); // the 30th, not committed yet

  const refused = expect(a.data.saveFromLink({ url: FULL_RECIPE.url })).rejects.toBeInstanceOf(DailyLimitError);
  await held.waitForWaiting(1);
  await held.commit();

  await refused;
  await a.drafts.settled();
  expect(await countLinkSaves(a)).toBe(30);
  expect(await a.data.listDrafts()).toHaveLength(1);
});

test('five saves at once with two left in the day make exactly two Drafts', async () => {
  const a = await signInTestUser('a');
  await seedLinkSaves(a, savesAt(28, 2));

  const results = await Promise.allSettled(Array.from({ length: 5 }, () => a.data.saveFromLink({ url: FULL_RECIPE.url })));
  await a.drafts.settled();

  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
  expect(results.filter((r) => r.status === 'rejected' && r.reason instanceof DailyLimitError)).toHaveLength(3);
  expect(await countLinkSaves(a)).toBe(30);
  expect(await a.data.listDrafts()).toHaveLength(2);
});

test("one user's saves don't count toward another's limit", async () => {
  const a = await signInTestUser('a');
  const b = await signInTestUser('b');
  await seedLinkSaves(a, savesAt(30, 2));

  await expect(a.data.saveFromLink({ url: FULL_RECIPE.url })).rejects.toBeInstanceOf(DailyLimitError);
  const id = await savedAndBuilt(b, FULL_RECIPE.url);

  expect(await b.data.getRecipe(id)).toMatchObject({ ownerId: b.userId, title: 'Creamy garlic pasta' });
});

// "Draft ready"

test('a finished Draft sends exactly one "Draft ready" push to each of the owner’s phones; kicking it again adds none', async () => {
  const a = await signInTestUser('a');
  await a.data.registerPushToken(TOKEN_2);
  await a.data.registerPushToken(TOKEN_1);

  const id = await savedAndBuilt(a, FULL_RECIPE.url);
  expect(await a.drafts.build(id)).toEqual({ status: 'notClaimed' });
  await a.data.resumeDraftBuilds();
  await a.drafts.settled();

  expect(a.drafts.pushesSent()).toEqual([
    draftReady(TOKEN_1, 'Creamy garlic pasta', id),
    draftReady(TOKEN_2, 'Creamy garlic pasta', id),
  ]);
});

test('two kicks at once send one push', async () => {
  const a = await signInTestUser('a', { loseKicks: 1 });
  await a.data.registerPushToken(TOKEN_1);
  const { recipeId } = await a.data.saveFromLink({ url: FULL_RECIPE.url });

  const outcomes = await Promise.all([a.drafts.build(recipeId), a.drafts.build(recipeId)]);

  expect(outcomes.map((o) => o.status).sort()).toEqual(['built', 'notClaimed']);
  expect(a.drafts.pushesSent()).toEqual([draftReady(TOKEN_1, 'Creamy garlic pasta', recipeId)]);
});

test('a build claimed again after 3 minutes and the stuck first build both finish, and one push goes out', async () => {
  const reached = Promise.withResolvers<void>();
  const stuck = Promise.withResolvers<void>();
  let reads = 0;
  const a = await signInTestUser('a', {
    tiktok: async (url, signal) => {
      reads += 1;
      if (reads === 1) {
        reached.resolve();
        await stuck.promise;
      }
      return fixtureAdapters.tiktok(url, signal);
    },
  });
  await a.data.registerPushToken(TOKEN_1);
  const { recipeId } = await a.data.saveFromLink({ url: FULL_RECIPE.url });
  await reached.promise; // the first build claimed it, and is stuck reading TikTok

  await backdateDraftBuild(recipeId, 4);
  expect(await a.drafts.build(recipeId)).toEqual({ status: 'built', changed: true });
  stuck.resolve();
  await a.drafts.settled();

  expect(reads).toBe(2);
  expect(a.drafts.pushesSent()).toEqual([draftReady(TOKEN_1, 'Creamy garlic pasta', recipeId)]);
});

test('a recipe-not-in-caption Draft still gets "Draft ready"; a failed build gets none', async () => {
  const a = await signInTestUser('a');
  await a.data.registerPushToken(TOKEN_1);

  const notInCaption = await savedAndBuilt(a, LINK_IN_BIO.url);
  await savedAndBuilt(a, UNREADABLE.url);

  expect(a.drafts.pushesSent()).toEqual([draftReady(TOKEN_1, 'Crispy smash burgers', notInCaption)]);
});

test('a Retry that builds the Draft sends one push, after the failed build sent none', async () => {
  let calls = 0;
  const flaky: Extract = async (material, signal) => {
    calls += 1;
    if (calls === 1) throw new ExtractError('unreadable', 'Claude refused.');
    return fixtureExtract(material, signal);
  };
  const a = await signInTestUser('a', { extract: flaky });
  await a.data.registerPushToken(TOKEN_1);
  const id = await savedAndBuilt(a, FULL_RECIPE.url);
  expect(a.drafts.pushesSent()).toEqual([]);

  await a.data.retryDraft(id);
  await a.drafts.settled();

  expect(a.drafts.pushesSent()).toEqual([draftReady(TOKEN_1, 'Creamy garlic pasta', id)]);
});

test('with no push token the Draft is built and nothing is sent', async () => {
  const a = await signInTestUser('a');

  const id = await savedAndBuilt(a, FULL_RECIPE.url);

  expect(await a.data.getRecipe(id)).toMatchObject({ build: { status: 'built' }, title: 'Creamy garlic pasta' });
  expect(a.drafts.pushesSent()).toEqual([]);
});

test('a push the push service fails to send never fails the build', async () => {
  const a = await signInTestUser('a', { pushFails: true });
  await a.data.registerPushToken(TOKEN_1);

  const id = await savedAndBuilt(a, FULL_RECIPE.url);

  expect(await a.data.getRecipe(id)).toMatchObject({ build: { status: 'built' }, title: 'Creamy garlic pasta' });
});

test('a token the push service says is no longer registered is forgotten', async () => {
  const a = await signInTestUser('a', { unregisteredPushTokens: [TOKEN_1] });
  await a.data.registerPushToken(TOKEN_1);
  await a.data.registerPushToken(TOKEN_2);

  const first = await savedAndBuilt(a, FULL_RECIPE.url);
  const second = await savedAndBuilt(a, LINK_IN_BIO.url);

  expect(a.drafts.pushesSent()).toEqual([
    draftReady(TOKEN_1, 'Creamy garlic pasta', first),
    draftReady(TOKEN_2, 'Creamy garlic pasta', first),
    draftReady(TOKEN_2, 'Crispy smash burgers', second),
  ]);
});

test('a phone that changes hands moves its token to the user who registers it last', async () => {
  const a = await signInTestUser('a');
  const b = await signInTestUser('b');
  await a.data.registerPushToken(TOKEN_1);
  await b.data.registerPushToken(TOKEN_1);

  await savedAndBuilt(a, FULL_RECIPE.url);
  const bs = await savedAndBuilt(b, LINK_IN_BIO.url);

  expect(a.drafts.pushesSent()).toEqual([]);
  expect(b.drafts.pushesSent()).toEqual([draftReady(TOKEN_1, 'Crispy smash burgers', bs)]);
});

test('signing out stops this phone getting the user’s pushes; their other phone still gets them', async () => {
  const [first, second] = await signInOnPhones('u', 2);
  await first.data.registerPushToken(TOKEN_1);
  await second.data.registerPushToken(TOKEN_2);

  await first.data.signOut();
  const id = await savedAndBuilt(second, FULL_RECIPE.url);

  expect(second.drafts.pushesSent()).toEqual([draftReady(TOKEN_2, 'Creamy garlic pasta', id)]);
});

test('signing out with no signal leaves the token registered (best effort)', async () => {
  const [first, second] = await signInOnPhones('u', 2);
  await first.data.registerPushToken(TOKEN_1);
  first.goOffline();

  await first.data.signOut();
  const id = await savedAndBuilt(second, FULL_RECIPE.url);

  expect(second.drafts.pushesSent()).toEqual([draftReady(TOKEN_1, 'Creamy garlic pasta', id)]);
});

test('registering the same token again, or twice at once, keeps one token', async () => {
  const a = await signInTestUser('a');

  await Promise.all([a.data.registerPushToken(TOKEN_1), a.data.registerPushToken(TOKEN_1)]);
  await a.data.registerPushToken(TOKEN_1);
  const id = await savedAndBuilt(a, FULL_RECIPE.url);

  expect(a.drafts.pushesSent()).toEqual([draftReady(TOKEN_1, 'Creamy garlic pasta', id)]);
});

test('only an Expo push token can be registered; spaces around it are trimmed', async () => {
  const a = await signInTestUser('a');
  for (const token of [
    '',
    '   ',
    'ExponentPushToken[]',
    'ExponentPushToken[abc',
    'ExponentPushToken[ab c]',
    "ExponentPushToken[ab'c]",
    'ExponentPushToken[café]',
    'ExponentPushToken[abc]extra',
    'abc',
    `ExponentPushToken[${'a'.repeat(200)}]`,
  ]) {
    await expect(a.data.registerPushToken(token), token).rejects.toMatchObject({ code: 'invalid_push_token' });
  }

  await a.data.registerPushToken('  ExpoPushToken[Ab-c_9]\n');
  const id = await savedAndBuilt(a, FULL_RECIPE.url);

  expect(a.drafts.pushesSent()).toEqual([draftReady('ExpoPushToken[Ab-c_9]', 'Creamy garlic pasta', id)]);
});

test('a tapped notification opens a Draft only when it is "Draft ready" with a Recipe id', () => {
  const id = '0b4a1d2e-3f40-4c5d-8e6f-708192a3b4c5';
  expect(parseDraftReadyPush({ kind: 'draftReady', recipeId: id })).toBe(id);
  expect(parseDraftReadyPush({ kind: 'draftReady', recipeId: id.toUpperCase() })).toBe(id.toUpperCase());
  for (const data of [
    null,
    undefined,
    'draftReady',
    {},
    { kind: 'draftReady' },
    { kind: 'draftReady', recipeId: '' },
    { kind: 'draftReady', recipeId: ` ${id}` },
    { kind: 'draftReady', recipeId: 'not-a-uuid' },
    { kind: 'draftReady', recipeId: 42 },
    { kind: 'somethingElse', recipeId: id },
    [id],
  ]) {
    expect(parseDraftReadyPush(data)).toBeNull();
  }
});
