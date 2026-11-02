// Ticket 19: Friend profiles (decisions 19, user decision 5), through the data layer as real
// signed-in users. A Friend's profile shows their username, "Friends since", their Ranking with
// Scores and their Cook Logs (20 at a time), and nothing else of theirs. A Friend reads, and saves
// their own copy of, any Recipe the other ranked or logged; unfriending ends that at once. A
// stranger, an unfriended user and an id nobody has all get the same notFound. Races hold the
// owner's side in a second database session (CODING_STANDARDS.md).
import { randomUUID } from 'node:crypto';

import { expect, test } from 'vitest';

import { parseCookLogId, parseUserId, type DataLayer, type FriendCookLog, type RecipeId, type UserId } from '../src/data';
import { FULL_RECIPE } from '../supabase/functions/_shared/draft-fixtures';
import {
  holdCookLogDelete,
  holdRecipeEdit,
  holdUnfriend,
  signInOnPhones,
  signInWithUsername,
  uniqueUsername,
  type TestUser,
} from './harness';
import { screenshotBytes } from './screenshot-fixture';

async function befriend(a: TestUser, b: TestUser) {
  expect(await a.data.sendFriendRequest(b.userId)).toEqual({ status: 'requested' });
  expect(await b.data.respondToFriendRequest(a.userId, true)).toEqual({ status: 'accepted' });
}

/** A Recipe of `user`'s with one line, logged on `cookedOn` with `log`. */
async function logged(
  user: TestUser,
  title: string,
  cookedOn: string,
  log: { notes?: string; companions?: UserId[]; photo?: boolean } = {},
): Promise<RecipeId> {
  const recipe = await user.data.createRecipe({
    title,
    lines: [{ originalText: '2 eggs', amountText: '2', ingredientName: 'eggs' }],
    steps: ['Cook it.'],
  });
  const added = await user.data.addCookLog(recipe, {
    cookedOn,
    notes: log.notes ?? null,
    companions: log.companions ?? [],
    photos: log.photo ? [{ kind: 'new', jpeg: screenshotBytes() }] : [],
  });
  if (added.status !== 'added') throw new Error(`Couldn't log ${title}: ${added.status}`);
  return recipe;
}

/** Places the Recipe alone in `band` (Skip, so no comparisons). */
async function ranked(user: TestUser, recipe: RecipeId, band: 'liked' | 'fine' | 'disliked') {
  const placed = await user.data.placeInRanking(user.data.skipComparisons(await user.data.startRanking(recipe, band)));
  if (placed.status !== 'placed') throw new Error(`Couldn't rank: ${placed.status}`);
}

/**
 * sam's kitchen, as kim (his Friend) sees it. sam ranked Shakshuka (Liked; Tagged, marked Want to
 * Cook) and Dal (Didn't like), and logged those and Toast; Shakshuka's log has jo with him and a
 * photo. He also has a Paella he wants to cook, a Secret stew he never cooked, a Draft, saffron in
 * his Pantry, sumac as a Staple and oat milk on his Shopping List; jo and alex are his Friends too.
 * ex was his Friend until he unfriended him; stranger is nobody to him.
 */
async function samsKitchen() {
  const [kim, sam, jo, alex, ex, stranger] = await Promise.all(
    ['kim', 'sam', 'jo', 'alex', 'ex', 'stranger'].map((stem) => signInWithUsername(stem)),
  );
  for (const friend of [kim, jo, alex, ex]) await befriend(sam, friend);
  const shakshuka = await logged(sam, 'Shakshuka', '2026-10-30', { notes: 'Spicy', companions: [jo.userId], photo: true });
  const dal = await logged(sam, 'Dal', '2026-10-28', { notes: 'Too salty' });
  const toast = await logged(sam, 'Toast', '2026-10-31');
  await ranked(sam, shakshuka, 'liked');
  await ranked(sam, dal, 'disliked');
  await sam.data.addTag(shakshuka, 'Weeknight');
  await sam.data.setWantToCook(shakshuka, true);
  const paella = await sam.data.createRecipe({ title: 'Paella', lines: [], steps: [] });
  await sam.data.setWantToCook(paella, true);
  const stew = await sam.data.createRecipe({ title: 'Secret stew', lines: [], steps: [] });
  const { recipeId: draft } = await sam.data.saveFromLink({ url: FULL_RECIPE.url });
  await sam.drafts.settled();
  await sam.data.addToPantry('saffron');
  await sam.data.addStaple('sumac');
  await sam.data.addManualItem('oat milk');
  await sam.data.unfriend(ex.userId);
  return { kim, sam, jo, alex, ex, stranger, shakshuka, dal, toast, paella, stew, draft };
}

/** A profile as one can read it at a glance: Ranking lines and Cook Log lines. */
async function shown(viewer: DataLayer, of: UserId) {
  const profile = await viewer.getFriendProfile(of);
  if (profile.status !== 'found') return profile;
  const rank = (r: { position: number; title: string | null; score: number }) =>
    `${r.position}. ${r.title ?? '?'} ${r.score.toFixed(1)}`;
  const log = (l: FriendCookLog) =>
    [
      l.cookedOn,
      l.recipeTitle ?? '?',
      l.notes ? `"${l.notes}"` : null,
      l.companions.length > 0 ? `with ${l.companions.map((c) => `@${c.username ?? '?'}`).join(', ')}` : null,
      l.photos.length > 0 ? `${l.photos.filter((p) => p.url !== null).length} photo` : null,
    ]
      .filter(Boolean)
      .join(' ');
  return {
    username: profile.username,
    ranking: {
      liked: profile.ranking.liked.map(rank),
      fine: profile.ranking.fine.map(rank),
      disliked: profile.ranking.disliked.map(rank),
    },
    cookLogs: profile.cookLogs.logs.map(log),
    more: profile.cookLogs.next !== null,
  };
}

test("a Friend's profile shows their username, Friends since, Ranking with Scores and Cook Logs, newest first", async () => {
  const { kim, sam, jo, shakshuka, dal, toast } = await samsKitchen();

  expect(await shown(kim.data, sam.userId)).toEqual({
    username: sam.username,
    ranking: { liked: ['1. Shakshuka 8.4'], fine: [], disliked: ['1. Dal 1.7'] },
    cookLogs: ['2026-10-31 Toast', `2026-10-30 Shakshuka "Spicy" with @${jo.username} 1 photo`, '2026-10-28 Dal "Too salty"'],
    more: false,
  });

  const profile = await kim.data.getFriendProfile(sam.userId);
  if (profile.status !== 'found') throw new Error(profile.status);
  // "Friends since" is when sam accepted, as kim's Friends list says.
  const [asFriend] = await kim.data.listFriends();
  expect(asFriend).toEqual({ id: sam.userId, username: sam.username, friendsSince: profile.friendsSince });
  expect(profile.id).toBe(sam.userId);
  expect(profile.ranking.liked).toEqual([
    { recipeId: shakshuka, title: 'Shakshuka', band: 'liked', position: 1, score: 8.4, rankedAt: expect.any(String) },
  ]);
  expect(profile.ranking.disliked.map((r) => r.recipeId)).toEqual([dal]);
  const [toastLog, shakshukaLog] = profile.cookLogs.logs;
  expect(toastLog).toEqual({
    id: expect.any(String),
    recipeId: toast,
    recipeTitle: 'Toast',
    userId: sam.userId,
    cookedOn: '2026-10-31',
    notes: null,
    companions: [],
    photos: [],
    cookPlanId: null,
    createdAt: expect.any(String),
    updatedAt: expect.any(String),
  });
  // The photo is a link signed for kim, to sam's own file.
  expect(shakshukaLog.photos).toEqual([{ id: expect.any(String), url: expect.stringContaining(`/cook-log-photos/${sam.userId}/`) }]);
  expect(shakshukaLog.companions).toEqual([{ id: jo.userId, username: jo.username }]);
});

test("a Friend's profile never shows their Pantry, Staples, Shopping List, Want to Cook, Tags, Drafts, other Recipes or Friends", async () => {
  const { kim, sam, jo, alex, shakshuka, paella, stew, draft } = await samsKitchen();
  const profile = await kim.data.getFriendProfile(sam.userId);
  const everything = JSON.stringify(profile);
  const draftTitle = (await sam.data.getRecipe(draft))?.title ?? '';
  expect(draftTitle).not.toBe('');

  // Nothing of any of them is anywhere in it, by name or by id.
  const kept = {
    pantry: 'saffron',
    staples: 'sumac',
    shoppingList: 'oat milk',
    wantToCook: 'Paella',
    wantToCookId: paella,
    tags: 'Weeknight',
    drafts: draftTitle,
    draftId: draft,
    unrankedUnlogged: 'Secret stew',
    unrankedUnloggedId: stew,
    friends: alex.username,
    friendId: alex.userId,
  };
  for (const [what, text] of Object.entries(kept)) expect(everything.includes(text), what).toBe(false);
  // jo shows only as Shakshuka's companion, not as one of sam's Friends.
  expect(everything.split(jo.username).length - 1).toBe(1);
  // The profile's fields are these and no others.
  expect(Object.keys(profile).sort()).toEqual(['cookLogs', 'friendsSince', 'id', 'ranking', 'status', 'username']);

  // Nor can kim open them: the Recipe he can open is the ranked one, without its Tags or Want to Cook.
  for (const id of [paella, stew, draft]) expect(await kim.data.getRecipe(id)).toBeNull();
  const seen = await kim.data.getRecipe(shakshuka);
  expect(seen?.status).toBe('someoneElses');
  expect(Object.keys(seen ?? {})).not.toContain('tags');
  expect(Object.keys(seen ?? {})).not.toContain('wantToCookSince');
});

test('a stranger, an unfriended user, yourself and an id nobody has all get the same notFound, by the same request', async () => {
  const { sam, ex, stranger } = await samsKitchen();
  const [viewer] = await signInOnPhones('viewer', 1);
  const set = await viewer.data.setUsername(uniqueUsername('viewer'));
  expect(set.status).toBe('set');
  const formerFriend = await signInWithUsername('former');
  await befriend(viewer, formerFriend);
  await viewer.data.unfriend(formerFriend.userId);
  const nobody = parseUserId(randomUUID());

  // From sam's side: stranger and ex.
  for (const outsider of [stranger, ex]) {
    expect(await outsider.data.getFriendProfile(sam.userId)).toEqual({ status: 'notFound' });
    const after = { cookedOn: '2026-11-01', createdAt: new Date().toISOString(), id: parseCookLogId(randomUUID()) };
    expect(await outsider.data.getFriendCookLogs(sam.userId, after)).toEqual({ status: 'notFound' });
  }

  // From one phone, each kind: the same answer, after the same one request, the viewer's own
  // Friends list, which never depends on who was asked about. So no timing can tell them apart.
  const asked: Record<string, unknown> = {};
  for (const [who, id] of [
    ['stranger', sam.userId],
    ['unfriended', formerFriend.userId],
    ['yourself', viewer.userId],
    ['nobody', nobody],
  ] as const) {
    const before = viewer.requestsMade().length;
    asked[who] = { answer: await viewer.data.getFriendProfile(id), sent: viewer.requestsMade().slice(before) };
  }
  const same = { answer: { status: 'notFound' }, sent: [{ user: viewer.userId, path: '/rest/v1/rpc/list_friends' }] };
  expect(asked).toEqual({ stranger: same, unfriended: same, yourself: same, nobody: same });

  // And measured: the medians of 15 rounds, each kind in turn, stay within a few milliseconds.
  const times: Record<string, number[]> = { stranger: [], unfriended: [], nobody: [] };
  for (let round = 0; round < 15; round++) {
    for (const [who, id] of [
      ['stranger', sam.userId],
      ['unfriended', formerFriend.userId],
      ['nobody', nobody],
    ] as const) {
      const started = performance.now();
      await viewer.data.getFriendProfile(id);
      times[who].push(performance.now() - started);
    }
  }
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const medians = Object.values(times).map(median);
  expect(Math.max(...medians) - Math.min(...medians)).toBeLessThan(15);
});

test("a Friend's Cook Logs come 20 at a time, newest first, each page picking up where the last left off", async () => {
  const kim = await signInWithUsername('kim');
  const sam = await signInWithUsername('sam');
  await befriend(sam, kim);
  const porridge = await sam.data.createRecipe({ title: 'Porridge', lines: [], steps: [] });
  // 23 logs, two to a day (the last alone): 1 Oct twice, 2 Oct twice, … 12 Oct once.
  for (let i = 0; i < 23; i++) {
    const day = `2026-10-${String(1 + Math.floor(i / 2)).padStart(2, '0')}`;
    const added = await sam.data.addCookLog(porridge, { cookedOn: day, notes: `Log ${i}` });
    expect(added.status).toBe('added');
  }

  const profile = await kim.data.getFriendProfile(sam.userId);
  if (profile.status !== 'found') throw new Error(profile.status);
  const notes = (logs: FriendCookLog[]) => logs.map((l) => `${l.cookedOn} ${l.notes ?? ''}`);
  // Newest day first; on one day, the one added later first. The page ends inside 2 Oct.
  expect(notes(profile.cookLogs.logs)).toEqual([
    '2026-10-12 Log 22',
    '2026-10-11 Log 21',
    '2026-10-11 Log 20',
    '2026-10-10 Log 19',
    '2026-10-10 Log 18',
    '2026-10-09 Log 17',
    '2026-10-09 Log 16',
    '2026-10-08 Log 15',
    '2026-10-08 Log 14',
    '2026-10-07 Log 13',
    '2026-10-07 Log 12',
    '2026-10-06 Log 11',
    '2026-10-06 Log 10',
    '2026-10-05 Log 9',
    '2026-10-05 Log 8',
    '2026-10-04 Log 7',
    '2026-10-04 Log 6',
    '2026-10-03 Log 5',
    '2026-10-03 Log 4',
    '2026-10-02 Log 3',
  ]);
  expect(profile.cookLogs.logs.every((l) => l.recipeTitle === 'Porridge')).toBe(true);
  const next = profile.cookLogs.next;
  if (next === null) throw new Error('No next page.');

  const second = await kim.data.getFriendCookLogs(sam.userId, next);
  if (second.status !== 'found') throw new Error(second.status);
  expect(notes(second.logs)).toEqual(['2026-10-02 Log 2', '2026-10-01 Log 1', '2026-10-01 Log 0']);
  expect(second.next).toBeNull();

  // Unfriended, the next page is notFound too, like the profile.
  await sam.data.unfriend(kim.userId);
  expect(await kim.data.getFriendCookLogs(sam.userId, next)).toEqual({ status: 'notFound' });
});

test('an empty profile: a Friend with no Ranking and no Cook Logs', async () => {
  const kim = await signInWithUsername('kim');
  const sam = await signInWithUsername('sam');
  await befriend(sam, kim);
  expect(await shown(kim.data, sam.userId)).toEqual({
    username: sam.username,
    ranking: { liked: [], fine: [], disliked: [] },
    cookLogs: [],
    more: false,
  });
});

test("from a Friend's profile, the user saves their own copy of a ranked Recipe, and is then offered it", async () => {
  const { kim, sam, shakshuka } = await samsKitchen();
  const profile = await kim.data.getFriendProfile(sam.userId);
  if (profile.status !== 'found') throw new Error(profile.status);
  const [top] = profile.ranking.liked;

  const before = await kim.data.getRecipe(top.recipeId);
  expect(before).toMatchObject({
    status: 'someoneElses',
    id: shakshuka,
    title: 'Shakshuka',
    owner: { id: sam.userId, username: sam.username },
    steps: ['Cook it.'],
    lines: [{ originalText: '2 eggs', amountText: '2', ingredient: { name: 'egg' } }],
    yourCopy: null,
  });

  const copied = await kim.data.copyRecipe(top.recipeId);
  if (copied.status !== 'copied') throw new Error(copied.status);
  expect(await kim.data.getRecipe(top.recipeId)).toMatchObject({ status: 'someoneElses', yourCopy: copied.recipeId });
  expect(await kim.data.getRecipe(copied.recipeId)).toMatchObject({
    status: 'reviewed',
    title: 'Shakshuka',
    tags: [],
    wantToCookSince: null,
    savedFrom: { username: sam.username },
  });
  // A copy is kim's own: it isn't Cooked or ranked for him.
  expect(await kim.data.listCookLogs(copied.recipeId)).toEqual([]);
  expect(await kim.data.getRanking()).toEqual({ liked: [], fine: [], disliked: [] });
});

test('a logged Recipe that was never ranked can be read and copied too', async () => {
  const { kim, toast } = await samsKitchen();
  expect(await kim.data.getRecipe(toast)).toMatchObject({ status: 'someoneElses', title: 'Toast' });
  expect((await kim.data.copyRecipe(toast)).status).toBe('copied');
});

test('unfriending ends it at once: the profile, the Ranking, the Recipes, and a copy tried right after', async () => {
  const { kim, sam, shakshuka, toast } = await samsKitchen();
  const copied = await kim.data.copyRecipe(shakshuka);
  if (copied.status !== 'copied') throw new Error(copied.status);

  await sam.data.unfriend(kim.userId);

  expect(await kim.data.getFriendProfile(sam.userId)).toEqual({ status: 'notFound' });
  expect(await kim.data.getRanking(sam.userId)).toEqual({ liked: [], fine: [], disliked: [] });
  expect(await kim.data.listCookLogs(shakshuka)).toEqual([]);
  for (const id of [shakshuka, toast]) {
    expect(await kim.data.getRecipe(id)).toBeNull();
    expect(await kim.data.copyRecipe(id)).toEqual({ status: 'notFound' });
  }
  // The copy he saved before stays his.
  expect((await kim.data.listMyRecipes()).map((r) => r.id)).toEqual([copied.recipeId]);
});

test('a Friend’s Ranking has its titles: getRanking for a Friend reads them through the Recipe read rule', async () => {
  const { kim, sam } = await samsKitchen();
  const ranking = await kim.data.getRanking(sam.userId);
  expect(ranking.liked.map((r) => r.title)).toEqual(['Shakshuka']);
  expect(ranking.disliked.map((r) => r.title)).toEqual(['Dal']);
});

test('copying while the owner unfriends you: before the unfriend commits it is a copy; right after, notFound', async () => {
  const { kim, sam, shakshuka } = await samsKitchen();

  const unfriending = await holdUnfriend(sam, kim);
  // The unfriend hasn't happened yet for anyone else: the copy doesn't wait for it.
  const copied = await kim.data.copyRecipe(shakshuka);
  expect(copied.status).toBe('copied');
  await unfriending.commit();
  expect(await kim.data.copyRecipe(shakshuka)).toEqual({ status: 'notFound' });
});

test('a copy that waited on the owner’s edit while they unfriended you meanwhile is refused, and nothing is made', async () => {
  const { kim, sam, shakshuka } = await samsKitchen();

  const editing = await holdRecipeEdit(sam, shakshuka, 'Shakshuka v2', []);
  const copying = kim.data.copyRecipe(shakshuka);
  await editing.waitForWaiting(1);
  await sam.data.unfriend(kim.userId);
  await editing.commit();

  expect(await copying).toEqual({ status: 'notFound' });
  expect(await kim.data.listMyRecipes()).toEqual([]);
});

test('a copy that waited on the owner deleting their last Cook Log (and so the Ranking entry) is refused', async () => {
  const { kim, sam, shakshuka } = await samsKitchen();
  const [log] = await sam.data.listCookLogs(shakshuka);

  const deleting = await holdCookLogDelete(sam, log.id);
  const copying = kim.data.copyRecipe(shakshuka);
  await deleting.waitForWaiting(1);
  await deleting.commit();

  expect(await copying).toEqual({ status: 'notFound' });
  expect(await kim.data.listMyRecipes()).toEqual([]);
  // Saved again and out of the Ranking, it's sam's alone again.
  expect(await kim.data.getRecipe(shakshuka)).toBeNull();
  expect((await kim.data.getRanking(sam.userId)).liked).toEqual([]);
});

test('an unfriend landing between the Friends check and the reads answers notFound, not an empty profile or page', async () => {
  const [kim] = await signInOnPhones('kim', 1);
  expect((await kim.data.setUsername(uniqueUsername('kim'))).status).toBe('set');
  const sam = await signInWithUsername('sam');
  await befriend(sam, kim);
  const porridge = await sam.data.createRecipe({ title: 'Porridge', lines: [], steps: [] });
  for (let i = 0; i < 21; i++) expect((await sam.data.addCookLog(porridge, { cookedOn: '2026-10-01' })).status).toBe('added');
  await ranked(sam, porridge, 'liked');
  const profile = await kim.data.getFriendProfile(sam.userId);
  if (profile.status !== 'found' || profile.cookLogs.next === null) throw new Error('No second page.');
  const after = profile.cookLogs.next;

  // The profile: kim's phone has found sam in his Friends list; its Ranking read waits while sam unfriends him.
  const ranking = kim.holdNextRequest('ranking_entries');
  const opening = kim.data.getFriendProfile(sam.userId);
  await ranking.reached;
  await sam.data.unfriend(kim.userId);
  ranking.release();
  expect(await opening).toEqual({ status: 'notFound' });

  // "Show more": the same, on the next page's read.
  await befriend(sam, kim);
  const logs = kim.holdNextRequest('/rest/v1/cook_logs');
  const paging = kim.data.getFriendCookLogs(sam.userId, after);
  await logs.reached;
  await sam.data.unfriend(kim.userId);
  logs.release();
  expect(await paging).toEqual({ status: 'notFound' });
});
