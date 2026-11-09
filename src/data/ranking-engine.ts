/**
 * The ranking engine (decisions 17): Scores, and the comparisons that place a Recipe in a band.
 * Pure, no I/O. The server stores only band and position; every Score is made here.
 *
 * - A Score is spread evenly in its band: with n Recipes in a band from lo to hi, the one at
 *   position i (1 = best) scores hi − (hi − lo) × i / (n + 1), rounded half up to one decimal.
 *   Worked in integer tenths, so no float rounding moves a Score.
 * - Placing is a binary search over the n + 1 gaps of the band (gap g is position g + 1): compare
 *   with the Recipe at the middle of the gaps still open; "better" keeps the gaps above it,
 *   "worse" the ones below. There is no "same". At most ceil(log2(n + 1)) comparisons.
 * - Skipping places it in the middle of the gaps still open, floor((lo + hi) / 2): floor(n / 2)
 *   before any answer, and never against an answer already given.
 */
import { DataError, type RankingBand, type RankingCandidate, type RecipeId } from './types';

/** The bands best first. */
export const RANKING_BANDS: readonly RankingBand[] = ['liked', 'fine', 'disliked'];

/** Each band's Scores in tenths: its best (hi) and worst (lo). */
const BAND_TENTHS: Record<RankingBand, { hi: number; lo: number }> = {
  liked: { hi: 100, lo: 67 },
  fine: { hi: 66, lo: 34 },
  disliked: { hi: 33, lo: 0 },
};

/** The Score (0–10, one decimal) of the Recipe at `position` (1 = best) in a band of `bandSize`. */
export function scoreOf(band: RankingBand, position: number, bandSize: number): number {
  if (!Number.isInteger(position) || !Number.isInteger(bandSize) || position < 1 || position > bandSize) {
    throw new DataError('invalid_ranking_position', `A band of ${bandSize} has no position ${position}.`);
  }
  const { hi, lo } = BAND_TENTHS[band];
  const denominator = bandSize + 1;
  const numerator = hi * denominator - (hi - lo) * position;
  // numerator / denominator rounded half up, in integers.
  const tenths = Math.floor((2 * numerator + denominator) / (2 * denominator));
  return tenths / 10;
}

/**
 * Placing one Recipe in a band, on the phone. `others` is the band as read, best first, without
 * this Recipe. While `comparing`, the gaps `lo`…`hi` are still open and the user is asked about
 * `against`; once `placed`, `position` is where it goes in `bandSeen`, the band as read (its
 * Recipes best first), which the server checks is still the band before placing it. `asked`
 * counts the comparisons answered. A session left half-way ranks nothing.
 */
export type RankingSession =
  | {
      status: 'comparing';
      recipeId: RecipeId;
      band: RankingBand;
      others: readonly RankingCandidate[];
      lo: number;
      hi: number;
      against: RankingCandidate;
      asked: number;
    }
  | {
      status: 'placed';
      recipeId: RecipeId;
      band: RankingBand;
      position: number;
      bandSeen: readonly RecipeId[];
      asked: number;
    };

type SessionBase = { recipeId: RecipeId; band: RankingBand; others: readonly RankingCandidate[] };

/** The session with gaps `lo`…`hi` open: placed once one gap is left, else the next comparison. */
function narrowed(base: SessionBase, lo: number, hi: number, asked: number): RankingSession {
  const { recipeId, band, others } = base;
  if (lo >= hi) return { status: 'placed', recipeId, band, position: lo + 1, bandSeen: others.map((o) => o.recipeId), asked };
  return { status: 'comparing', recipeId, band, others, lo, hi, against: others[Math.floor((lo + hi) / 2)], asked };
}

/** Starts placing `recipeId` in `band`, among `others` (best first, without it). */
export function startRankingSession(
  recipeId: RecipeId,
  band: RankingBand,
  others: readonly RankingCandidate[],
): RankingSession {
  return narrowed({ recipeId, band, others }, 0, others.length, 0);
}

/** The user said the Recipe is `better` or `worse` than `session.against`: the next session. */
export function answerComparison(session: RankingSession, answer: 'better' | 'worse'): RankingSession {
  if (session.status !== 'comparing') {
    throw new DataError('ranking_already_placed', 'This Recipe is already placed; nothing is being compared.');
  }
  const middle = Math.floor((session.lo + session.hi) / 2);
  return answer === 'better'
    ? narrowed(session, session.lo, middle, session.asked + 1)
    : narrowed(session, middle + 1, session.hi, session.asked + 1);
}

/**
 * Skips the comparisons left: the Recipe goes in the middle of the gaps still open, gap
 * floor((lo + hi) / 2), so it agrees with every answer already given. Before any answer that is
 * floor(n / 2), the middle of its band.
 */
export function skipComparisons(session: RankingSession): RankingSession {
  if (session.status !== 'comparing') return session;
  const middle = Math.floor((session.lo + session.hi) / 2);
  return narrowed(session, middle, middle, session.asked);
}
