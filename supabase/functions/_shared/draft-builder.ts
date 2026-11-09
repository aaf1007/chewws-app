// The Draft builder (spec, Modules 3): claims a Draft, reads its source, asks Claude for the recipe
// and writes it back, or marks the Draft failed with why. Runtime-neutral: the build-draft function
// wires the real source reader, Claude and a service-role `rpc`; tests wire fakes.

import { normaliseIngredientName } from '../../../src/data/ingredient-matcher.ts';
import { ExtractError, type Extract } from './claude-extractor.ts';
import { SourceError, type SharedLink, type SourceReader } from './source-reader.ts';

/** Why a build failed, as `fail_draft` stores it. */
export type BuildFailure = 'source_unavailable' | 'source_unreachable' | 'unreadable' | 'timed_out' | 'not_set_up';

/** Calls one of the builder's database functions as the service role, and returns its result. */
export type Rpc = (fn: 'claim_draft_build' | 'finish_draft' | 'fail_draft', args: Record<string, unknown>) => Promise<unknown>;

export type DraftBuilderDeps = {
  rpc: Rpc;
  readSource: SourceReader['read'];
  extract: Extract;
  /** How long one attempt may take, reading and Claude together (hosted functions stop at 150 s). */
  budgetMs?: number;
};

export type BuildOutcome =
  /** Someone else is building it, it's built, or it has no attempts left. */
  | { status: 'notClaimed' }
  /** `changed`: whether this build filled the Draft in (false if it stopped building meanwhile). */
  | { status: 'built'; changed: boolean }
  | { status: 'failed'; reason: BuildFailure };

const BUDGET_MS = 120_000;

/** What `claim_draft_build` returned: what was shared, or null when there's nothing to build. */
function toSharedLink(claimed: unknown): SharedLink | null {
  if (typeof claimed !== 'object' || claimed === null) return null;
  const url: unknown = Reflect.get(claimed, 'url');
  const text: unknown = Reflect.get(claimed, 'pastedText');
  const screenshotPath: unknown = Reflect.get(claimed, 'screenshotPath');
  if (typeof url !== 'string') return null;
  return {
    url,
    text: typeof text === 'string' ? text : null,
    screenshotPath: typeof screenshotPath === 'string' ? screenshotPath : null,
  };
}

function failureOf(error: unknown, timedOut: boolean): BuildFailure {
  if (timedOut) return 'timed_out';
  if (error instanceof SourceError) {
    if (error.reason === 'unreadable') return 'unreadable';
    return error.reason === 'unavailable' ? 'source_unavailable' : 'source_unreachable';
  }
  if (error instanceof ExtractError) return error.reason === 'notSetUp' ? 'not_set_up' : 'unreadable';
  return 'unreadable';
}

/**
 * Builds the Draft `recipeId` once: a second kick while it builds, or after it's built, finds
 * nothing to claim. Ingredient names go through the Ingredient matcher; a line whose name
 * normalises to nothing is dropped. Never throws for a failed build: it marks the Draft failed.
 */
export async function buildDraft(recipeId: string, deps: DraftBuilderDeps): Promise<BuildOutcome> {
  const shared = toSharedLink(await deps.rpc('claim_draft_build', { recipe_id: recipeId }));
  if (shared === null) return { status: 'notClaimed' };

  const budget = new AbortController();
  const timer = setTimeout(() => budget.abort(new Error('The build ran out of time.')), deps.budgetMs ?? BUDGET_MS);
  try {
    const material = await deps.readSource(shared, budget.signal);
    const extraction = await deps.extract(material, budget.signal);
    const lines = extraction.lines.flatMap((line) => {
      const name = normaliseIngredientName(line.ingredient);
      const text = line.text.trim();
      const amount = line.amount?.trim() || null;
      if (!name) return [];
      return [{ original_text: text || [amount, line.ingredient.trim()].filter(Boolean).join(' '), amount_text: amount, ingredient_name: name }];
    });
    const changed = await deps.rpc('finish_draft', {
      recipe_id: recipeId,
      result: {
        title: extraction.title,
        recipeFound: extraction.recipeFound,
        lines,
        steps: extraction.steps,
        source: {
          platform: material.platform,
          external_id: material.externalId,
          creator_name: material.creatorName,
          creator_url: material.creatorUrl,
          caption: material.caption,
          title: material.title,
          thumbnail_url: material.thumbnailUrl,
          recipe_site_url: material.recipeSiteUrl,
        },
      },
    });
    return { status: 'built', changed: changed === true };
  } catch (error) {
    const reason = failureOf(error, budget.signal.aborted);
    if (reason === 'unreadable' && !(error instanceof ExtractError)) console.error('Draft build failed:', error);
    await deps.rpc('fail_draft', { recipe_id: recipeId, reason });
    return { status: 'failed', reason };
  } finally {
    clearTimeout(timer);
  }
}
