// Ticket 17: Ranking (decisions 17), through the data layer as real signed-in users. A user ranks
// their Cooked Recipes: a band, then "better or worse than X?" until the spot is found (or Skip,
// the middle). Scores come from the ranking engine. Re-ranking moves a Recipe; deleting it, or its
// last Cook Log, takes it out and closes its band up. Friends read each other's Rankings; strangers
// and unfriended users don't. Races hold one side in a second database session (CODING_STANDARDS.md).
import { expect, test } from 'vitest';

import type { DataLayer, RankingBand, RankingSession, RecipeId } from '../src/data';
import {
  holdCookLogDelete,
  holdPlacement,
  holdRecipeDelete,
  signInTestUser,
  signInWithUsername,
  type TestUser,
} from './harness';

/** A Recipe of the user's, logged once, so Cooked. */
async function cooked(user: TestUser, title: string): Promise<RecipeId> {
  const recipe = await user.data.createRecipe({ title, lines: [], steps: [] });
  const logged = await user.data.addCookLog(recipe, { cookedOn: '2026-10-30' });
  if (logged.status !== 'added') throw new Error(`Couldn't log ${title}: ${logged.status}`);
  return recipe;
}

/** Ranks the Recipe in `band` answering `answers` in turn, then places it; answers the place. */
async function ranked(user: TestUser, recipe: RecipeId, band: RankingBand, answers: ('better' | 'worse')[] = []) {
  let session = await user.data.startRanking(recipe, band);
  for (const answer of answers) session = user.data.answerComparison(session, answer);
  expect(session.status).toBe('placed');
  return user.data.placeInRanking(session);
}

/** Ranks the Recipe in `band` with Skip. */
async function skipped(user: TestUser, recipe: RecipeId, band: RankingBand) {
  return user.data.placeInRanking(user.data.skipComparisons(await user.data.startRanking(recipe, band)));
}

/** A Ranking as titles with Scores, band by band: `{ liked: ['Shakshuka 8.4'], … }`. */
async function shown(data: DataLayer, of?: TestUser) {
  const ranking = await data.getRanking(of?.userId);
  const line = (r: { title: string | null; position: number; score: number }) => `${r.position}. ${r.title ?? '?'} ${r.score.toFixed(1)}`;
  return { liked: ranking.liked.map(line), fine: ranking.fine.map(line), disliked: ranking.disliked.map(line) };
}

/** Answers comparisons toward gap `gap` of `titles` (best first), counting them. */
function answeredToward(data: DataLayer, start: RankingSession, titles: string[], gap: number) {
  let session = start;
  while (session.status === 'comparing') {
    const index = titles.indexOf(session.against.title);
    session = data.answerComparison(session, gap <= index ? 'better' : 'worse');
  }
  return session;
}

test('only Cooked Recipes can be ranked: a Saved one, a Draft or someone else’s is refused', async () => {
  const me = await signInTestUser('ranker');
  const other = await signInTestUser('other');
  const saved = await me.data.createRecipe({ title: 'Not cooked yet', lines: [], steps: [] });
  const theirs = await cooked(other, 'Their soup');

  expect(await ranked(me, saved, 'liked')).toEqual({ status: 'notCooked' });
  expect(await ranked(me, theirs, 'liked')).toEqual({ status: 'noSuchRecipe' });
  expect(await shown(me.data)).toEqual({ liked: [], fine: [], disliked: [] });
  expect(await shown(other.data)).toEqual({ liked: [], fine: [], disliked: [] });

  // Logged, it can be.
  expect((await me.data.addCookLog(saved, { cookedOn: '2026-10-31' })).status).toBe('added');
  expect(await ranked(me, saved, 'liked')).toEqual({ status: 'placed', band: 'liked', position: 1, score: 8.4 });
});

test('a band, then answers to "better or worse than X?", place the Recipe by binary search; Scores spread over the band', async () => {
  const me = await signInTestUser('ranker');
  const shakshuka = await cooked(me, 'Shakshuka');
  const dal = await cooked(me, 'Dal');
  const ramen = await cooked(me, 'Ramen');
  const toast = await cooked(me, 'Toast');

  // Alone in Liked: 8.4, with nothing to compare.
  expect(await me.data.startRanking(shakshuka, 'liked')).toEqual({
    status: 'placed',
    recipeId: shakshuka,
    band: 'liked',
    position: 1,
    bandSeen: [],
    asked: 0,
  });
  expect(await ranked(me, shakshuka, 'liked')).toEqual({ status: 'placed', band: 'liked', position: 1, score: 8.4 });

  // Dal: worse than Shakshuka. The band of 2 is 8.9 and 7.8.
  const first = await me.data.startRanking(dal, 'liked');
  expect(first).toMatchObject({ status: 'comparing', against: { recipeId: shakshuka, title: 'Shakshuka' } });
  expect(await ranked(me, dal, 'liked', ['worse'])).toEqual({ status: 'placed', band: 'liked', position: 2, score: 7.8 });
  expect(await shown(me.data)).toEqual({ liked: ['1. Shakshuka 8.9', '2. Dal 7.8'], fine: [], disliked: [] });

  // Ramen: asked about Dal (the middle) first, then Shakshuka: better than Dal, worse than Shakshuka.
  let session = await me.data.startRanking(ramen, 'liked');
  const asked: string[] = [];
  while (session.status === 'comparing') {
    asked.push(session.against.title);
    session = me.data.answerComparison(session, session.against.title === 'Dal' ? 'better' : 'worse');
  }
  expect(asked).toEqual(['Dal', 'Shakshuka']);
  expect(await me.data.placeInRanking(session)).toEqual({ status: 'placed', band: 'liked', position: 2, score: 8.4 });

  // Toast in Didn't like: its own band.
  expect(await ranked(me, toast, 'disliked')).toEqual({ status: 'placed', band: 'disliked', position: 1, score: 1.7 });

  expect(await shown(me.data)).toEqual({
    liked: ['1. Shakshuka 9.2', '2. Ramen 8.4', '3. Dal 7.5'],
    fine: [],
    disliked: ['1. Toast 1.7'],
  });
});

test('a band of 100 needs at most 7 comparisons, and the Recipe lands where the answers put it', async () => {
  const me = await signInTestUser('ranker');
  const titles = Array.from({ length: 100 }, (_, i) => `Recipe ${String(i + 1).padStart(3, '0')}`);
  const recipes: RecipeId[] = [];
  for (let i = 0; i < titles.length; i += 20) {
    recipes.push(...(await Promise.all(titles.slice(i, i + 20).map((title) => cooked(me, title)))));
  }
  // Each placed last of the band, so the band reads Recipe 001 … Recipe 100, best first.
  for (const [i, recipe] of recipes.entries()) {
    const session = answeredToward(me.data, await me.data.startRanking(recipe, 'liked'), titles.slice(0, i), i);
    expect(await me.data.placeInRanking(session)).toMatchObject({ status: 'placed', position: i + 1 });
  }
  const newcomer = await cooked(me, 'Newcomer');
  const start = await me.data.startRanking(newcomer, 'liked');
  for (const gap of [0, 37, 50, 99, 100]) {
    const placed = answeredToward(me.data, start, titles, gap);
    expect(placed).toMatchObject({ status: 'placed', position: gap + 1, bandSeen: recipes });
    expect(placed.asked).toBeLessThanOrEqual(7);
  }
  const between = answeredToward(me.data, start, titles, 37);
  expect(await me.data.placeInRanking(between)).toEqual({ status: 'placed', band: 'liked', position: 38, score: 8.8 });
  const { liked } = await me.data.getRanking();
  expect(liked).toHaveLength(101);
  expect(liked.slice(36, 39).map((r) => [r.position, r.title, r.score])).toEqual([
    [37, 'Recipe 037', 8.8],
    [38, 'Newcomer', 8.8],
    [39, 'Recipe 038', 8.7],
  ]);
  expect([liked[0].score, liked[100].score]).toEqual([10, 6.7]);
});

test('skipping the comparisons places the Recipe in the middle of its band', async () => {
  const me = await signInTestUser('ranker');
  const [a, b, c, d, e] = await Promise.all(['A', 'B', 'C', 'D', 'E'].map((t) => cooked(me, t)));
  expect(await skipped(me, a, 'fine')).toEqual({ status: 'placed', band: 'fine', position: 1, score: 5.0 });
  expect(await skipped(me, b, 'fine')).toEqual({ status: 'placed', band: 'fine', position: 1, score: 5.5 });
  expect(await ranked(me, c, 'fine', ['worse'])).toMatchObject({ position: 3 });
  expect(await shown(me.data)).toEqual({ liked: [], fine: ['1. B 5.8', '2. A 5.0', '3. C 4.2'], disliked: [] });
  // A band of 3: the middle gap is floor(3 / 2) = 1, so second.
  expect(await skipped(me, d, 'fine')).toEqual({ status: 'placed', band: 'fine', position: 2, score: 5.3 });
  // A band of 4: gap 2, so third.
  expect(await skipped(me, e, 'fine')).toEqual({ status: 'placed', band: 'fine', position: 3, score: 5.0 });
  expect(await shown(me.data)).toEqual({
    liked: [],
    fine: ['1. B 6.1', '2. D 5.5', '3. E 5.0', '4. A 4.5', '5. C 3.9'],
    disliked: [],
  });
});

test('re-ranking moves the Recipe, within its band or to another, and both bands close up', async () => {
  const me = await signInTestUser('ranker');
  const [a, b, c] = await Promise.all(['A', 'B', 'C'].map((t) => cooked(me, t)));
  await ranked(me, a, 'liked');
  await ranked(me, b, 'liked', ['worse']);
  await ranked(me, c, 'liked', ['worse']);
  expect(await shown(me.data)).toEqual({ liked: ['1. A 9.2', '2. B 8.4', '3. C 7.5'], fine: [], disliked: [] });

  // Cooked C again and it was better: re-ranked in Liked, compared with A and B only.
  expect((await me.data.addCookLog(c, { cookedOn: '2026-11-01' })).status).toBe('added');
  const again = await me.data.startRanking(c, 'liked');
  expect(again).toMatchObject({ status: 'comparing', others: [{ title: 'A' }, { title: 'B' }] });
  expect(await ranked(me, c, 'liked', ['better', 'better'])).toEqual({ status: 'placed', band: 'liked', position: 1, score: 9.2 });
  expect(await shown(me.data)).toEqual({ liked: ['1. C 9.2', '2. A 8.4', '3. B 7.5'], fine: [], disliked: [] });

  // A moves to Didn't like: out of Liked, which closes up.
  expect(await ranked(me, a, 'disliked')).toEqual({ status: 'placed', band: 'disliked', position: 1, score: 1.7 });
  expect(await shown(me.data)).toEqual({ liked: ['1. C 8.9', '2. B 7.8'], fine: [], disliked: ['1. A 1.7'] });
});

test('deleting a Recipe takes it out of the Ranking and its band closes up', async () => {
  const me = await signInTestUser('ranker');
  const [a, b, c] = await Promise.all(['A', 'B', 'C'].map((t) => cooked(me, t)));
  await ranked(me, a, 'liked');
  await ranked(me, b, 'liked', ['worse']);
  await ranked(me, c, 'liked', ['worse']);

  await me.data.deleteRecipe(a);
  expect(await shown(me.data)).toEqual({ liked: ['1. B 8.9', '2. C 7.8'], fine: [], disliked: [] });
  // And the band is whole again: a new one goes in by the same comparisons.
  const d = await cooked(me, 'D');
  expect(await ranked(me, d, 'liked', ['better', 'worse'])).toEqual({ status: 'placed', band: 'liked', position: 2, score: 8.4 });
  expect(await shown(me.data)).toEqual({ liked: ['1. B 9.2', '2. D 8.4', '3. C 7.5'], fine: [], disliked: [] });
});

test('deleting a Recipe’s last Cook Log takes it out of the Ranking; deleting one of several doesn’t', async () => {
  const me = await signInTestUser('ranker');
  const [a, b] = await Promise.all(['A', 'B'].map((t) => cooked(me, t)));
  await ranked(me, a, 'fine');
  await ranked(me, b, 'fine', ['worse']);
  const second = await me.data.addCookLog(a, { cookedOn: '2026-11-01' });
  if (second.status !== 'added') throw new Error(second.status);

  expect(await me.data.deleteCookLog(second.cookLogId)).toEqual({ status: 'deleted', recipe: 'cooked' });
  expect(await shown(me.data)).toEqual({ liked: [], fine: ['1. A 5.5', '2. B 4.5'], disliked: [] });

  const [last] = await me.data.listCookLogs(a);
  expect(await me.data.deleteCookLog(last.id)).toEqual({ status: 'deleted', recipe: 'saved' });
  expect(await shown(me.data)).toEqual({ liked: [], fine: ['1. B 5.0'], disliked: [] });
  // Saved again, it can't be ranked until it's logged.
  expect(await ranked(me, a, 'fine', ['better'])).toEqual({ status: 'notCooked' });
});

test('Friends read a Ranking with its Scores; a stranger and an unfriended user read nothing of it', async () => {
  const kim = await signInWithUsername('kim');
  const sam = await signInWithUsername('sam');
  const ex = await signInWithUsername('ex');
  const stranger = await signInWithUsername('stranger');
  for (const friend of [sam, ex]) {
    expect(await kim.data.sendFriendRequest(friend.userId)).toEqual({ status: 'requested' });
    expect(await friend.data.respondToFriendRequest(kim.userId, true)).toEqual({ status: 'accepted' });
  }
  const [a, b] = await Promise.all(['A', 'B'].map((t) => cooked(kim, t)));
  await ranked(kim, a, 'liked');
  await ranked(kim, b, 'disliked');
  await kim.data.unfriend(ex.userId);

  // Titles wait for ticket 19 (Friends read ranked Recipes); the order and Scores are there now.
  expect(await shown(sam.data, kim)).toEqual({ liked: ['1. ? 8.4'], fine: [], disliked: ['1. ? 1.7'] });
  expect((await sam.data.getRanking(kim.userId)).liked.map((r) => r.recipeId)).toEqual([a]);
  for (const outsider of [stranger, ex]) {
    expect(await shown(outsider.data, kim)).toEqual({ liked: [], fine: [], disliked: [] });
  }
  // Each user ranks on their own: sam's Ranking is his, empty.
  expect(await shown(sam.data)).toEqual({ liked: [], fine: [], disliked: [] });
});

test('two phones placing into one band: the second is told the band changed and compares again', async () => {
  const me = await signInTestUser('ranker');
  const [a, b] = await Promise.all(['A', 'B'].map((t) => cooked(me, t)));
  // Both phones read an empty Liked band.
  const onThisPhone = await me.data.startRanking(b, 'liked');

  const otherPhone = await holdPlacement(me, a, 'liked', 1, []);
  const placing = me.data.placeInRanking(onThisPhone);
  await otherPhone.waitForWaiting(1);
  await otherPhone.commit();
  expect(await placing).toEqual({ status: 'bandChanged' });
  expect(await shown(me.data)).toEqual({ liked: ['1. A 8.4'], fine: [], disliked: [] });

  // Compared again, against A this time.
  expect(await ranked(me, b, 'liked', ['better'])).toEqual({ status: 'placed', band: 'liked', position: 1, score: 8.9 });
  expect(await shown(me.data)).toEqual({ liked: ['1. B 8.9', '2. A 7.8'], fine: [], disliked: [] });
});

test('two phones: a re-rank on the other reorders the band without changing its size, and this one is told the band changed', async () => {
  const me = await signInTestUser('ranker');
  const [a, b, c] = await Promise.all(['A', 'B', 'C'].map((t) => cooked(me, t)));
  await ranked(me, a, 'liked');
  await ranked(me, b, 'liked', ['worse']);
  // This phone reads [A, B] and puts C below B: third.
  const onThisPhone = me.data.answerComparison(await me.data.startRanking(c, 'liked'), 'worse');
  expect(onThisPhone).toMatchObject({ status: 'placed', position: 3 });

  // Meanwhile the other phone moves B above A: still two in Liked, now [B, A].
  const otherPhone = await holdPlacement(me, b, 'liked', 1, [a]);
  const placing = me.data.placeInRanking(onThisPhone);
  await otherPhone.waitForWaiting(1);
  await otherPhone.commit();
  expect(await placing).toEqual({ status: 'bandChanged' });
  expect(await shown(me.data)).toEqual({ liked: ['1. B 8.9', '2. A 7.8'], fine: [], disliked: [] });
});

test('a re-rank while another phone deletes the Recipe: the delete goes first, and the re-rank is told it is gone', async () => {
  const me = await signInTestUser('ranker');
  const [a, b, c] = await Promise.all(['A', 'B', 'C'].map((t) => cooked(me, t)));
  await ranked(me, a, 'liked');
  await ranked(me, b, 'liked', ['worse']);
  await ranked(me, c, 'liked', ['worse']);
  const reRank = me.data.skipComparisons(await me.data.startRanking(b, 'fine'));

  const deleting = await holdRecipeDelete(me, b);
  const placing = me.data.placeInRanking(reRank);
  await deleting.waitForWaiting(1);
  await deleting.commit();
  expect(await placing).toEqual({ status: 'noSuchRecipe' });
  expect(await shown(me.data)).toEqual({ liked: ['1. A 8.9', '2. C 7.8'], fine: [], disliked: [] });
});

test('a Recipe deleted while another phone re-ranks it: the re-rank goes first, then the delete closes the band up', async () => {
  const me = await signInTestUser('ranker');
  const [a, b, c] = await Promise.all(['A', 'B', 'C'].map((t) => cooked(me, t)));
  await ranked(me, a, 'liked');
  await ranked(me, b, 'liked', ['worse']);
  await ranked(me, c, 'liked', ['worse']);

  // The other phone moves B to Fine; this one deletes B meanwhile.
  const otherPhone = await holdPlacement(me, b, 'fine', 1, []);
  const deleting = me.data.deleteRecipe(b);
  await otherPhone.waitForWaiting(1);
  await otherPhone.commit();
  await deleting;
  expect(await shown(me.data)).toEqual({ liked: ['1. A 8.9', '2. C 7.8'], fine: [], disliked: [] });
});

test('deleting the last Cook Log while another phone places the Recipe: the placement goes first, then the delete takes it out', async () => {
  const me = await signInTestUser('ranker');
  const [a, b] = await Promise.all(['A', 'B'].map((t) => cooked(me, t)));
  await ranked(me, a, 'liked');
  const [log] = await me.data.listCookLogs(b);

  const otherPhone = await holdPlacement(me, b, 'liked', 1, [a]);
  const deleting = me.data.deleteCookLog(log.id);
  await otherPhone.waitForWaiting(1);
  await otherPhone.commit();
  expect(await deleting).toEqual({ status: 'deleted', recipe: 'saved' });
  expect(await shown(me.data)).toEqual({ liked: ['1. A 8.4'], fine: [], disliked: [] });
});

test('placing a Recipe while another phone deletes its last Cook Log: the delete goes first, and the placement is refused', async () => {
  const me = await signInTestUser('ranker');
  const [a, b] = await Promise.all(['A', 'B'].map((t) => cooked(me, t)));
  await ranked(me, a, 'liked');
  const [log] = await me.data.listCookLogs(b);
  const session = await me.data.startRanking(b, 'liked');

  const otherPhone = await holdCookLogDelete(me, log.id);
  const placing = me.data.placeInRanking(me.data.answerComparison(session, 'better'));
  await otherPhone.waitForWaiting(1);
  await otherPhone.commit();
  expect(await placing).toEqual({ status: 'notCooked' });
  expect(await shown(me.data)).toEqual({ liked: ['1. A 8.4'], fine: [], disliked: [] });
});

test('a half-answered session ranks nothing, and can’t be placed', async () => {
  const me = await signInTestUser('ranker');
  const [a, b] = await Promise.all(['A', 'B'].map((t) => cooked(me, t)));
  await ranked(me, a, 'liked');
  const session = await me.data.startRanking(b, 'liked');
  expect(session.status).toBe('comparing');
  await expect(me.data.placeInRanking(session)).rejects.toMatchObject({ code: 'ranking_not_finished' });
  expect(await shown(me.data)).toEqual({ liked: ['1. A 8.4'], fine: [], disliked: [] });
});
