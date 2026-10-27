// The Draft builder (spec, Modules 3): claims a Draft, reads its source, asks Claude for the recipe
// and writes it back, or marks the Draft failed with why. Runtime-neutral: the build-draft function
// wires the real source reader, Claude and a service-role `rpc`; tests wire fakes.

import { normaliseIngredientName } from '../../../src/data/ingredient-matcher.ts';
import { ExtractError, type Extract, type Extraction, type Screenshot } from './claude-extractor.ts';
import {
  SourceError,
  userAddedCaption,
  type SharedLink,
  type SourceMaterial,
  type SourceReader,
} from './source-reader.ts';

/**
 * Why a build failed, as `fail_draft` stores it. `no_caption` and `source_refused`: the source
 * couldn't be read (no caption, or a page that refused the server); the user can add one.
 */
export type BuildFailure =
  | 'source_unavailable'
  | 'source_unreachable'
  | 'unreadable'
  | 'timed_out'
  | 'not_set_up'
  | 'no_caption'
  | 'source_refused';

/** Calls one of the builder's database functions as the service role, and returns its result. */
export type Rpc = (
  fn: 'claim_draft_build' | 'finish_draft' | 'fail_draft' | 'store_source_refresh',
  args: Record<string, unknown>,
) => Promise<unknown>;

export type DraftBuilderDeps = {
  rpc: Rpc;
  readSource: SourceReader['read'];
  extract: Extract;
  /**
   * Downloads a screenshot the user added, by its path in the private recipe-images bucket (as
   * the service role: the function checked the Draft is the caller's, and the path is the one
   * `save_from_link` made for them).
   */
  loadScreenshot: (path: string, signal: AbortSignal) => Promise<Screenshot>;
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
    switch (error.reason) {
      case 'unreadable':
        return 'unreadable';
      case 'notSetUp':
        return 'not_set_up';
      case 'unavailable':
        return 'source_unavailable';
      case 'unreachable':
        return 'source_unreachable';
      case 'refused':
        return 'source_refused';
      case 'noCaption':
        return 'no_caption';
    }
  }
  if (error instanceof ExtractError) return error.reason === 'notSetUp' ? 'not_set_up' : 'unreadable';
  return 'unreadable';
}

/**
 * Any other link (decisions 04): no Claude call, and a Draft to fill in by hand, titled after the
 * page (or its host).
 */
function plainPage(material: SourceMaterial): Extraction {
  return {
    title: material.title ?? new URL(material.originalUrl).hostname.replace(/^www\./u, ''),
    recipeFound: false,
    lines: [],
    steps: [],
  };
}

/**
 * An Instagram Reel saved with nothing added (decisions 05): no Claude call, and a
 * recipe-not-in-caption Draft titled "Instagram Reel".
 */
const NOTHING_ADDED: Extraction = { title: 'Instagram Reel', recipeFound: false, lines: [], steps: [] };

/** What to build the Draft from: Claude's reading of the material, or no reading at all. */
async function extractionOf(material: SourceMaterial, deps: DraftBuilderDeps, signal: AbortSignal): Promise<Extraction> {
  const fromUser = userAddedCaption({ text: material.pastedText, screenshotPath: material.screenshotPath });
  if (!fromUser && material.kind === 'page') return plainPage(material);
  if (!fromUser && material.platform === 'instagram') return NOTHING_ADDED;
  const screenshot = material.screenshotPath === null ? null : await deps.loadScreenshot(material.screenshotPath, signal);
  return deps.extract({ ...material, screenshot }, signal);
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
    const extraction = await extractionOf(material, deps, budget.signal);
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
