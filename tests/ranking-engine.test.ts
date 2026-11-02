// Ticket 17: the ranking engine (decisions 17). Scores spread evenly in each band, in integer
// tenths rounded half up; placing a Recipe is a binary search over the band's gaps; skipping puts
// it in the middle. Pure functions, no database.
import { expect, test } from 'vitest';

import { parseRecipeId, type RankingCandidate, type RecipeId } from '../src/data';
import {
  answerComparison,
  scoreOf,
  skipComparisons,
  startRankingSession,
  type RankingSession,
} from '../src/data/ranking-engine';

const NEW = parseRecipeId('00000000-0000-4000-8000-000000000000');

/** A band of `n` Recipes, best first, titled R1…Rn. */
function band(n: number): RankingCandidate[] {
  return Array.from({ length: n }, (_, i) => ({
    recipeId: parseRecipeId(`00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`),
    title: `R${i + 1}`,
  }));
}

/**
 * Answers every comparison as someone would who puts the new Recipe in gap `gap` (above the
 * Recipe at index `gap`): better than it and everything below it, worse than everything above.
 */
function answeredToward(session: RankingSession, others: readonly { recipeId: RecipeId }[], gap: number): RankingSession {
  let current = session;
  while (current.status === 'comparing') {
    const { against } = current;
    const index = others.findIndex((o) => o.recipeId === against.recipeId);
    current = answerComparison(current, gap <= index ? 'better' : 'worse');
  }
  return current;
}

test('a lone Recipe scores 8.4 when Liked, 5.0 when Fine and 1.7 when Didn’t like', () => {
  expect(scoreOf('liked', 1, 1)).toBe(8.4);
  expect(scoreOf('fine', 1, 1)).toBe(5.0);
  expect(scoreOf('disliked', 1, 1)).toBe(1.7);
});

test('Scores round half up: 16.5 tenths is 1.7, not 1.6', () => {
  // 33 − 33 × 1/2 = 16.5 tenths; 100 − 33 × 1/2 = 83.5 tenths.
  expect(scoreOf('disliked', 1, 1)).toBe(1.7);
  expect(scoreOf('liked', 1, 1)).toBe(8.4);
  // 100 − 33 × 2/4 = 83.5 tenths: second in a band of 3.
  expect(scoreOf('liked', 2, 3)).toBe(8.4);
});

test('the band edges: Liked 6.7–10, Fine 3.4–6.6, Didn’t like 0–3.3, and no Score leaves its band', () => {
  expect([scoreOf('liked', 1, 100), scoreOf('liked', 100, 100)]).toEqual([10, 6.7]);
  expect([scoreOf('fine', 1, 100), scoreOf('fine', 100, 100)]).toEqual([6.6, 3.4]);
  expect([scoreOf('disliked', 1, 100), scoreOf('disliked', 100, 100)]).toEqual([3.3, 0]);
  const edges = { liked: [6.7, 10], fine: [3.4, 6.6], disliked: [0, 3.3] } as const;
  const outside: string[] = [];
  for (const b of ['liked', 'fine', 'disliked'] as const) {
    for (let n = 1; n <= 200; n++) {
      let previous = Infinity;
      for (let i = 1; i <= n; i++) {
        const score = scoreOf(b, i, n);
        if (score < edges[b][0] || score > edges[b][1] || score > previous) outside.push(`${b} ${i}/${n}: ${score}`);
        previous = score;
      }
    }
  }
  expect(outside).toEqual([]);
});

test('Scores change when the band size changes', () => {
  expect([scoreOf('liked', 1, 1)]).toEqual([8.4]);
  expect([scoreOf('liked', 1, 2), scoreOf('liked', 2, 2)]).toEqual([8.9, 7.8]);
  expect([scoreOf('liked', 1, 3), scoreOf('liked', 2, 3), scoreOf('liked', 3, 3)]).toEqual([9.2, 8.4, 7.5]);
  expect([scoreOf('fine', 1, 2), scoreOf('fine', 2, 2)]).toEqual([5.5, 4.5]);
});

test('a position outside the band has no Score', () => {
  expect(() => scoreOf('liked', 0, 3)).toThrow();
  expect(() => scoreOf('liked', 4, 3)).toThrow();
  expect(() => scoreOf('liked', 1, 0)).toThrow();
  expect(() => scoreOf('liked', 1.5, 3)).toThrow();
});

test('a known sequence of answers gives the expected position and Score', () => {
  const others = band(7);
  let session = startRankingSession(NEW, 'liked', others);
  const asked: string[] = [];
  for (const answer of ['worse', 'better', 'better'] as const) {
    if (session.status !== 'comparing') throw new Error('placed too soon');
    asked.push(session.against.title);
    session = answerComparison(session, answer);
  }
  // Worse than R4, better than R6, better than R5: between R4 and R5.
  expect(asked).toEqual(['R4', 'R6', 'R5']);
  expect(session).toEqual({ status: 'placed', recipeId: NEW, band: 'liked', position: 5, bandSizeSeen: 7, asked: 3 });
  expect(scoreOf('liked', 5, 8)).toBe(8.2);
});

test('an empty band places the Recipe at once, with no comparisons', () => {
  expect(startRankingSession(NEW, 'fine', [])).toEqual({
    status: 'placed',
    recipeId: NEW,
    band: 'fine',
    position: 1,
    bandSizeSeen: 0,
    asked: 0,
  });
});

test('every band size from 0 to 100 needs at most ceil(log2(n + 1)) comparisons, wherever the Recipe goes; 100 needs at most 7', () => {
  const tooMany: string[] = [];
  const misplaced: string[] = [];
  let mostFor100 = 0;
  for (let n = 0; n <= 100; n++) {
    const others = band(n);
    const bound = Math.ceil(Math.log2(n + 1));
    for (let gap = 0; gap <= n; gap++) {
      const placed = answeredToward(startRankingSession(NEW, 'liked', others), others, gap);
      if (placed.status !== 'placed') throw new Error('never placed');
      if (placed.position !== gap + 1) misplaced.push(`n=${n} gap=${gap}: position ${placed.position}`);
      if (placed.asked > bound) tooMany.push(`n=${n} gap=${gap}: ${placed.asked} > ${bound}`);
      if (n === 100) mostFor100 = Math.max(mostFor100, placed.asked);
    }
  }
  expect(misplaced).toEqual([]);
  expect(tooMany).toEqual([]);
  expect(mostFor100).toBe(7);
});

test('skipping places the Recipe at gap floor(n / 2), the middle of its band, even part-way through', () => {
  for (let n = 0; n <= 100; n++) {
    const skipped = skipComparisons(startRankingSession(NEW, 'disliked', band(n)));
    expect(skipped).toMatchObject({ status: 'placed', position: Math.floor(n / 2) + 1, bandSizeSeen: n });
  }
  expect(skipComparisons(startRankingSession(NEW, 'liked', band(4)))).toMatchObject({ position: 3 });
  expect(skipComparisons(startRankingSession(NEW, 'liked', band(5)))).toMatchObject({ position: 3 });
  const partWay = answerComparison(startRankingSession(NEW, 'liked', band(10)), 'better');
  expect(skipComparisons(partWay)).toMatchObject({ status: 'placed', position: 6, asked: 1 });
});

test('a placed Recipe takes no more answers', () => {
  const placed = startRankingSession(NEW, 'liked', []);
  expect(() => answerComparison(placed, 'better')).toThrow();
  expect(skipComparisons(placed)).toBe(placed);
});
