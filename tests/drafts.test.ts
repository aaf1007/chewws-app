// Ticket 03: saving a TikTok link into a Draft. Builds run in-process with the fake TikTok adapter
// and fake Claude call (supabase/functions/_shared/draft-fixtures.ts): no network.
import { expect, test, vi } from 'vitest';

import type { Recipe, RecipeId, RecipeInput } from '../src/data';
import type { Extract } from '../supabase/functions/_shared/claude-extractor';
import {
  FULL_RECIPE,
  LINK_IN_BIO,
  UNREADABLE,
  fixtureAdapters,
  fixtureExtract,
} from '../supabase/functions/_shared/draft-fixtures';
import { SourceError } from '../supabase/functions/_shared/source-reader';
import { backdateDraftBuild, countLinkSaves, signInOnPhones, signInTestUser, type TestUser } from './harness';

const THUMBNAIL = FULL_RECIPE.video.thumbnailUrl;

const pastaSource = {
  platform: 'tiktok',
  originalUrl: FULL_RECIPE.url,
  creatorName: 'Pasta Queen',
  creatorUrl: 'https://www.tiktok.com/@pastaqueen',
  thumbnailUrl: THUMBNAIL,
};

const linesOf = (recipe: Recipe | null) =>
  recipe?.lines.map((l) => [l.originalText, l.amountText, l.ingredient.name]);

/** A gate a fake can wait at until the test opens it. */
function gate() {
  const { promise, resolve } = Promise.withResolvers<void>();
  return { wait: () => promise, open: () => resolve() };
}

/** A fake Claude call that counts its calls. */
function countingExtract(): { extract: Extract; calls: () => number } {
  let calls = 0;
  return {
    extract: async (material, signal) => {
      calls += 1;
      return fixtureExtract(material, signal);
    },
    calls: () => calls,
  };
}

/** Where the Draft's build is; 'reviewed' once it's a Recipe in the library. */
async function buildOf(user: Pick<TestUser, 'data'>, id: RecipeId) {
  const recipe = await user.data.getRecipe(id);
  return recipe?.status === 'draft' ? recipe.build : recipe?.status;
}

async function savedAndBuilt(user: TestUser, url: string): Promise<RecipeId> {
  const { recipeId } = await user.data.saveFromLink({ url });
  await user.drafts.settled();
  return recipeId;
}

test('a full-recipe TikTok caption produces a Draft with the expected ingredients', async () => {
  const a = await signInTestUser('a');

  const id = await savedAndBuilt(a, FULL_RECIPE.url);

  const draft = await a.data.getRecipe(id);
  expect(draft).toMatchObject({
    id,
    ownerId: a.userId,
    title: 'Creamy garlic pasta',
    status: 'draft',
    build: { status: 'built' },
    recipeFound: true,
    steps: [
      'Boil the pasta.',
      'Melt the butter and fry the garlic for a minute.',
      'Add the tomatoes, then the cream and parmesan, and toss with the pasta.',
    ],
    sourceVideo: pastaSource,
  });
  // Ingredient names go through the Ingredient matcher; a line with no food in it ("🍝") is dropped.
  expect(linesOf(draft)).toEqual([
    ['200g spaghetti', '200g', 'spaghetti'],
    ['4 cloves garlic (minced)', '4 cloves', 'garlic'],
    ['2 tbsp butter', '2 tbsp', 'butter'],
    ['1 cup cherry tomatoes halved', '1 cup', 'cherry tomato'],
    ['½ cup heavy cream', '½ cup', 'heavy cream'],
    ['¼ cup grated parmesan', '¼ cup', 'parmesan'],
    ['salt', null, 'salt'],
  ]);
  expect(await a.data.listDrafts()).toEqual([
    {
      id,
      title: 'Creamy garlic pasta',
      build: { status: 'built' },
      recipeFound: true,
      sourceVideo: pastaSource,
      createdAt: draft?.createdAt,
    },
  ]);
  // Unreviewed, so not in the library yet.
  expect(await a.data.listMyRecipes()).toEqual([]);
});

test('a "link in bio" caption produces a recipe-not-in-caption Draft with no ingredients or steps', async () => {
  const a = await signInTestUser('a');

  const id = await savedAndBuilt(a, LINK_IN_BIO.url);

  // The fake Claude call returned a line and a step anyway; neither is kept.
  expect(await a.data.getRecipe(id)).toMatchObject({
    title: 'Crispy smash burgers',
    status: 'draft',
    build: { status: 'built' },
    recipeFound: false,
    lines: [],
    steps: [],
    sourceVideo: {
      platform: 'tiktok',
      originalUrl: LINK_IN_BIO.url,
      creatorName: 'Snack Dad',
      creatorUrl: 'https://www.tiktok.com/@snackdad',
      thumbnailUrl: THUMBNAIL,
    },
  });
});

test('saving returns at once; the Recipe is an unbuilt Draft until the Draft builder finishes', async () => {
  const tiktokAnswers = gate();
  const a = await signInTestUser('a', {
    tiktok: async (url, signal) => {
      await tiktokAnswers.wait();
      return fixtureAdapters.tiktok(url, signal);
    },
  });

  const saved = await a.data.saveFromLink({ url: FULL_RECIPE.url });

  expect(saved).toEqual({ status: 'saved', recipeId: saved.recipeId });
  expect(await a.data.getRecipe(saved.recipeId)).toMatchObject({
    title: 'TikTok video',
    status: 'draft',
    build: { status: 'building' },
    lines: [],
    steps: [],
    sourceVideo: { platform: 'tiktok', originalUrl: FULL_RECIPE.url, creatorName: null, thumbnailUrl: null },
  });
  expect((await a.data.listDrafts()).map((d) => [d.title, d.build])).toEqual([
    ['TikTok video', { status: 'building' }],
  ]);

  tiktokAnswers.open();
  await a.drafts.settled();

  expect(await a.data.getRecipe(saved.recipeId)).toMatchObject({
    title: 'Creamy garlic pasta',
    build: { status: 'built' },
  });
});

// Ticket 04 made recipe-site links saveable, and ticket 05 Instagram Reels; a profile stays refused.
test('a link inside shared text is saved; text with no link, or a link that cannot be saved yet, is refused', async () => {
  const a = await signInTestUser('a');

  const { recipeId } = await a.data.saveFromLink({
    text: `Made this last night and it's SO good!! ${FULL_RECIPE.url}. Try it`,
  });
  await a.drafts.settled();

  expect(await a.data.getRecipe(recipeId)).toMatchObject({ title: 'Creamy garlic pasta', sourceVideo: pastaSource });
  await expect(a.data.saveFromLink({ text: 'Check out this recipe!' })).rejects.toMatchObject({ code: 'no_link' });
  await expect(a.data.saveFromLink({ text: '   ' })).rejects.toMatchObject({ code: 'no_link' });
  await expect(a.data.saveFromLink({ url: 'https://www.instagram.com/pastaqueen/' })).rejects.toMatchObject({
    code: 'unsupported_link',
  });
  expect((await a.data.listDrafts()).map((d) => d.id)).toEqual([recipeId]);
});

test('a video TikTok has no answer for fails as unavailable, with Retry offered', async () => {
  const a = await signInTestUser('a');

  const id = await savedAndBuilt(a, 'https://vm.tiktok.com/ZMdeleted1/');

  expect(await a.data.getRecipe(id)).toMatchObject({
    title: 'TikTok video',
    status: 'draft',
    build: { status: 'failed', reason: 'sourceUnavailable', canRetry: true },
    sourceVideo: { platform: 'tiktok', originalUrl: 'https://vm.tiktok.com/ZMdeleted1/' },
  });
});

test('a TikTok that cannot be reached is tried once more within a build', async () => {
  let tries = 0;
  const a = await signInTestUser('a', {
    tiktok: async (url, signal) => {
      tries += 1;
      if (tries === 1) throw new SourceError('unreachable', 'No answer.');
      return fixtureAdapters.tiktok(url, signal);
    },
  });

  const id = await savedAndBuilt(a, FULL_RECIPE.url);

  expect(tries).toBe(2);
  expect(await a.data.getRecipe(id)).toMatchObject({ title: 'Creamy garlic pasta', build: { status: 'built' } });
});

test('a failed Draft is built at most 3 times in all; then it can only be filled in by hand', async () => {
  const a = await signInTestUser('a');
  const id = await savedAndBuilt(a, UNREADABLE.url);
  const failed = (canRetry: boolean) => ({ status: 'failed', reason: 'unreadable', canRetry });

  expect(await buildOf(a, id)).toEqual(failed(true));
  await a.data.retryDraft(id);
  await a.drafts.settled();
  expect(await buildOf(a, id)).toEqual(failed(true));
  await a.data.retryDraft(id);
  await a.drafts.settled();
  expect(await buildOf(a, id)).toEqual(failed(false));

  await expect(a.data.retryDraft(id)).rejects.toMatchObject({ code: 'no_attempts_left' });

  await a.data.reviewDraft(id, {
    title: 'Glitch soup',
    lines: [{ originalText: '1 can tomatoes', amountText: '1 can', ingredientName: 'tomatoes' }],
    steps: ['Heat it.'],
  });
  expect(await a.data.getRecipe(id)).toMatchObject({
    title: 'Glitch soup',
    status: 'reviewed',
    steps: ['Heat it.'],
  });
  expect(linesOf(await a.data.getRecipe(id))).toEqual([['1 can tomatoes', '1 can', 'tomato']]);
});

test('a built Draft is not built again', async () => {
  const a = await signInTestUser('a');
  const id = await savedAndBuilt(a, FULL_RECIPE.url);

  await expect(a.data.retryDraft(id)).rejects.toMatchObject({ code: 'draft_built' });
});

const reviewedPasta: RecipeInput = {
  title: 'Garlic pasta for two',
  lines: [
    { originalText: '200g spaghetti', amountText: '200g', ingredientName: 'spaghetti' },
    { originalText: '4 cloves garlic (minced)', amountText: '4 cloves', ingredientName: 'garlic' },
    // The user relinks a line the builder linked to "parmesan".
    { originalText: '¼ cup grated parmesan', amountText: '¼ cup', ingredientName: 'Parmigiano Reggiano' },
  ],
  steps: ['Boil the pasta.', 'Fry the garlic and toss.'],
};

test('the user reviews and edits a Draft, after which it is a normal Recipe', async () => {
  const a = await signInTestUser('a');
  const id = await savedAndBuilt(a, FULL_RECIPE.url);

  await a.data.reviewDraft(id, reviewedPasta);

  const recipe = await a.data.getRecipe(id);
  expect(recipe).toMatchObject({
    title: 'Garlic pasta for two',
    status: 'reviewed',
    recipeFound: true,
    steps: ['Boil the pasta.', 'Fry the garlic and toss.'],
    sourceVideo: pastaSource,
  });
  expect(linesOf(recipe)).toEqual([
    ['200g spaghetti', '200g', 'spaghetti'],
    ['4 cloves garlic (minced)', '4 cloves', 'garlic'],
    ['¼ cup grated parmesan', '¼ cup', 'parmigiano reggiano'],
  ]);
  expect(await a.data.listDrafts()).toEqual([]);
  expect(await a.data.listMyRecipes()).toEqual([
    { id, title: 'Garlic pasta for two', lineCount: 3, stepCount: 2, createdAt: recipe?.createdAt },
  ]);

  // Like any Recipe: it can be edited and goes on a Shopping List.
  await a.data.editRecipe(id, { ...reviewedPasta, title: 'Garlic pasta' });
  expect((await a.data.getRecipe(id))?.title).toBe('Garlic pasta');
  expect((await a.data.addRecipeToShoppingList(id)).map((i) => i.name)).toEqual([
    'spaghetti',
    'garlic',
    'parmigiano reggiano',
  ]);
});

test('a recipe-not-in-caption Draft is filled in by hand on review', async () => {
  const a = await signInTestUser('a');
  const id = await savedAndBuilt(a, LINK_IN_BIO.url);

  await a.data.reviewDraft(id, {
    title: 'Crispy smash burgers',
    lines: [{ originalText: '500g beef mince', amountText: '500g', ingredientName: 'beef mince' }],
    steps: ['Smash the beef onto a hot pan.'],
  });

  // recipeFound says what the builder found; the user's lines and steps are what the Recipe has.
  const recipe = await a.data.getRecipe(id);
  expect(recipe).toMatchObject({ status: 'reviewed', recipeFound: false, steps: ['Smash the beef onto a hot pan.'] });
  expect(linesOf(recipe)).toEqual([['500g beef mince', '500g', 'beef mince']]);
});

test('a Draft still building cannot be reviewed yet', async () => {
  const tiktokAnswers = gate();
  const a = await signInTestUser('a', {
    tiktok: async (url, signal) => {
      await tiktokAnswers.wait();
      return fixtureAdapters.tiktok(url, signal);
    },
  });
  const { recipeId } = await a.data.saveFromLink({ url: FULL_RECIPE.url });

  await expect(a.data.reviewDraft(recipeId, reviewedPasta)).rejects.toMatchObject({ code: 'draft_building' });

  tiktokAnswers.open();
  await a.drafts.settled();
  expect(await a.data.getRecipe(recipeId)).toMatchObject({ title: 'Creamy garlic pasta', status: 'draft' });
});

test('reviewing needs a title and an Ingredient on every line, as writing a Recipe does', async () => {
  const a = await signInTestUser('a');
  const id = await savedAndBuilt(a, FULL_RECIPE.url);

  await expect(a.data.reviewDraft(id, { ...reviewedPasta, title: '  ' })).rejects.toMatchObject({
    code: 'title_required',
  });
  await expect(
    a.data.reviewDraft(id, { ...reviewedPasta, lines: [{ originalText: 'a pinch', ingredientName: '!!' }] }),
  ).rejects.toMatchObject({ code: 'ingredient_required' });
  expect(await a.data.getRecipe(id)).toMatchObject({ title: 'Creamy garlic pasta', status: 'draft' });
});

test('Drafts stay unreviewed for as long as the user leaves them', async () => {
  const [phone] = await signInOnPhones('a', 1);
  const { recipeId } = await phone.data.saveFromLink({ url: FULL_RECIPE.url });
  await phone.drafts.settled();

  phone.setClock(new Date(Date.now() + 400 * 24 * 60 * 60 * 1000));
  await phone.data.resumeDraftBuilds();

  expect((await phone.data.listDrafts()).map((d) => [d.id, d.title, d.build])).toEqual([
    [recipeId, 'Creamy garlic pasta', { status: 'built' }],
  ]);
});

test('a build claimed over 3 minutes ago reads as timed out', async () => {
  const never = gate();
  const [phone] = await signInOnPhones('a', 1, {
    fakes: {
      tiktok: async (url, signal) => {
        await never.wait();
        return fixtureAdapters.tiktok(url, signal);
      },
    },
  });
  const { recipeId } = await phone.data.saveFromLink({ url: FULL_RECIPE.url });

  expect(await buildOf(phone, recipeId)).toEqual({ status: 'building' });
  phone.setClock(new Date(Date.now() + 3 * 60_000 + 5_000));
  expect(await buildOf(phone, recipeId)).toEqual({
    status: 'failed',
    reason: 'timedOut',
    canRetry: true,
  });

  never.open();
  await phone.drafts.settled();
});

test('a Draft whose kick was lost is kicked again once it has waited 30 seconds', async () => {
  const [phone] = await signInOnPhones('a', 1, { fakes: { loseKicks: 1 } });
  const { recipeId } = await phone.data.saveFromLink({ url: FULL_RECIPE.url });

  await phone.data.resumeDraftBuilds();
  await phone.drafts.settled();
  expect(await buildOf(phone, recipeId)).toEqual({ status: 'building' });

  phone.setClock(new Date(Date.now() + 31_000));
  await phone.data.resumeDraftBuilds();
  await phone.drafts.settled();
  expect(await phone.data.getRecipe(recipeId)).toMatchObject({
    title: 'Creamy garlic pasta',
    build: { status: 'built' },
  });
});

test('a second kick, or two at once, builds the Draft once', async () => {
  const claude = countingExtract();
  const tiktokAnswers = gate();
  const a = await signInTestUser('a', {
    extract: claude.extract,
    tiktok: async (url, signal) => {
      await tiktokAnswers.wait();
      return fixtureAdapters.tiktok(url, signal);
    },
  });
  const { recipeId } = await a.data.saveFromLink({ url: FULL_RECIPE.url });

  // A second build while the kicked one runs: whichever claims the Draft first builds it.
  const second = a.drafts.build(recipeId);
  tiktokAnswers.open();
  await second;
  await a.drafts.settled();
  expect(await a.drafts.build(recipeId)).toEqual({ status: 'notClaimed' });

  expect(claude.calls()).toBe(1);
  expect(linesOf(await a.data.getRecipe(recipeId))).toHaveLength(7);
});

test('two saves at once make two Drafts, each built once', async () => {
  const claude = countingExtract();
  const a = await signInTestUser('a', { extract: claude.extract });

  const [first, second] = await Promise.all([
    a.data.saveFromLink({ url: FULL_RECIPE.url }),
    a.data.saveFromLink({ url: LINK_IN_BIO.url }),
  ]);
  await a.drafts.settled();

  expect(claude.calls()).toBe(2);
  expect(new Set((await a.data.listDrafts()).map((d) => `${d.id} ${d.title}`))).toEqual(
    new Set([`${first.recipeId} Creamy garlic pasta`, `${second.recipeId} Crispy smash burgers`]),
  );
});

test('two Retries at once start one build', async () => {
  const claude = countingExtract();
  const a = await signInTestUser('a', { extract: claude.extract });
  const id = await savedAndBuilt(a, UNREADABLE.url);

  await Promise.all([a.data.retryDraft(id), a.data.retryDraft(id)]);
  await a.drafts.settled();

  expect(claude.calls()).toBe(2);
  expect(await buildOf(a, id)).toEqual({ status: 'failed', reason: 'unreadable', canRetry: true });
});

test('two reviews at once leave the Recipe as reviewed once, with its lines once', async () => {
  const a = await signInTestUser('a');
  const id = await savedAndBuilt(a, FULL_RECIPE.url);

  await Promise.all([a.data.reviewDraft(id, reviewedPasta), a.data.reviewDraft(id, reviewedPasta)]);

  const recipe = await a.data.getRecipe(id);
  expect(recipe).toMatchObject({ title: 'Garlic pasta for two', status: 'reviewed' });
  expect(linesOf(recipe)).toEqual([
    ['200g spaghetti', '200g', 'spaghetti'],
    ['4 cloves garlic (minced)', '4 cloves', 'garlic'],
    ['¼ cup grated parmesan', '¼ cup', 'parmigiano reggiano'],
  ]);
  expect((await a.data.listMyRecipes()).map((r) => r.id)).toEqual([id]);
});

test("a user's Drafts and Source Videos are theirs alone", async () => {
  const owner = await signInTestUser('owner');
  const stranger = await signInTestUser('stranger');
  const id = await savedAndBuilt(owner, FULL_RECIPE.url);

  expect(await stranger.data.listDrafts()).toEqual([]);
  expect(await stranger.data.getRecipe(id)).toBeNull();
  await expect(stranger.data.retryDraft(id)).rejects.toMatchObject({ code: 'recipe_not_found' });
  await expect(stranger.data.reviewDraft(id, reviewedPasta)).rejects.toMatchObject({ code: 'recipe_not_found' });
  expect(await owner.data.getRecipe(id)).toMatchObject({ title: 'Creamy garlic pasta', status: 'draft' });
});

test('a save sent again after its answer was lost keeps one Draft and one link save', async () => {
  const [phone] = await signInOnPhones('a', 1);
  // The save screen makes the id once, and sends it with every tap of Save.
  const draftId = phone.data.newDraftId();

  phone.loseNextAnswer('save_from_link');
  await expect(phone.data.saveFromLink({ url: FULL_RECIPE.url, draftId })).rejects.toMatchObject({ code: 'offline' });
  const saved = await phone.data.saveFromLink({ url: FULL_RECIPE.url, draftId });
  await phone.drafts.settled();

  expect(saved).toEqual({ status: 'saved', recipeId: draftId });
  expect((await phone.data.listDrafts()).map((d) => [d.id, d.title])).toEqual([[draftId, 'Creamy garlic pasta']]);
  expect(await countLinkSaves(phone)).toBe(1);
});

/** A user whose first build hangs at TikTok until `release()`; later builds read it at once. */
async function userWithAStuckBuild(extract?: Extract) {
  const reached = Promise.withResolvers<void>();
  const stuck = gate();
  let calls = 0;
  const user = await signInTestUser('a', {
    extract,
    tiktok: async (url, signal) => {
      calls += 1;
      if (calls === 1) {
        reached.resolve();
        await stuck.wait();
      }
      return fixtureAdapters.tiktok(url, signal);
    },
  });
  const { recipeId } = await user.data.saveFromLink({ url: FULL_RECIPE.url });
  await reached.promise; // claimed, and stuck reading TikTok
  return { user, recipeId, release: stuck.open };
}

test('the server lets a build claimed over 3 minutes ago be claimed again, and the stuck one then changes nothing', async () => {
  const { user, recipeId, release } = await userWithAStuckBuild();

  expect(await user.drafts.build(recipeId)).toEqual({ status: 'notClaimed' });
  await backdateDraftBuild(recipeId, 4);
  expect(await user.drafts.build(recipeId)).toEqual({ status: 'built', changed: true });

  release();
  await user.drafts.settled();
  expect(await user.data.getRecipe(recipeId)).toMatchObject({ title: 'Creamy garlic pasta', build: { status: 'built' } });
  expect(linesOf(await user.data.getRecipe(recipeId))).toHaveLength(7);
});

test('the server lets a build claimed over 3 minutes ago be retried, and not before', async () => {
  const claude = countingExtract();
  const { user, recipeId, release } = await userWithAStuckBuild(claude.extract);

  await user.data.retryDraft(recipeId); // still within its time: already building, nothing restarts
  await backdateDraftBuild(recipeId, 4);
  await user.data.retryDraft(recipeId); // restarts it; this build claims it while the stuck one hangs
  await vi.waitFor(async () => expect(await buildOf(user, recipeId)).toEqual({ status: 'built' }));
  expect(claude.calls()).toBe(1);

  release();
  await user.drafts.settled();
  expect(claude.calls()).toBe(2); // the stuck build finished too, but changed nothing
  expect(await user.data.getRecipe(recipeId)).toMatchObject({ title: 'Creamy garlic pasta' });
  expect(linesOf(await user.data.getRecipe(recipeId))).toHaveLength(7);
});

test('the server lets a Draft whose build was claimed over 3 minutes ago be reviewed, and not before', async () => {
  const { user, recipeId, release } = await userWithAStuckBuild();

  await expect(user.data.reviewDraft(recipeId, reviewedPasta)).rejects.toMatchObject({ code: 'draft_building' });
  await backdateDraftBuild(recipeId, 4);
  await user.data.reviewDraft(recipeId, reviewedPasta);

  release();
  await user.drafts.settled();
  // The stuck build, finishing late, doesn't overwrite what the user reviewed.
  const recipe = await user.data.getRecipe(recipeId);
  expect(recipe).toMatchObject({ title: 'Garlic pasta for two', status: 'reviewed' });
  expect(linesOf(recipe)).toHaveLength(3);
});
