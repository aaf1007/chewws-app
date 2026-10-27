// Ticket 04: YouTube, recipe-site and other links, and keeping a Source Video fresh. Builds and
// refreshes run in-process with fake adapters (canned videos and pages, read by the real HTML
// readers) and a fake Claude call (supabase/functions/_shared/draft-fixtures.ts): no network.
import { expect, test } from 'vitest';

import type { Recipe, RecipeId } from '../src/data';
import type { Extract } from '../supabase/functions/_shared/claude-extractor';
import {
  EXPIRED_THUMBNAIL,
  FULL_RECIPE,
  PLAIN_PAGE,
  SHAKSHUKA_PAGE,
  SITE_LINK,
  YOUTUBE_SHORT,
  fixtureAdapters,
  fixtureExtract,
  laterFixtureAdapters,
} from '../supabase/functions/_shared/draft-fixtures';
import { pageAdapter } from '../supabase/functions/_shared/page-reader';
import { createSafeFetch } from '../supabase/functions/_shared/safe-fetch';
import { SourceError, tiktokOEmbedAdapter, type SourceMaterial } from '../supabase/functions/_shared/source-reader';
import {
  backdateSourceRefresh,
  backdateSourceVideo,
  runYouTubeExpiryJob,
  scheduledJobs,
  signInTestUser,
  type TestUser,
} from './harness';

const THUMBNAIL = FULL_RECIPE.video.thumbnailUrl;

const linesOf = (recipe: Recipe | null) =>
  recipe?.lines.map((l) => [l.originalText, l.amountText, l.ingredient.name]);

async function savedAndBuilt(user: TestUser, url: string): Promise<RecipeId> {
  const { recipeId } = await user.data.saveFromLink({ url });
  await user.drafts.settled();
  return recipeId;
}

/** A fake Claude call that records what it was given. */
function recordingExtract(): { extract: Extract; given: SourceMaterial[] } {
  const given: SourceMaterial[] = [];
  return {
    extract: async (material, signal) => {
      given.push(material);
      return fixtureExtract(material, signal);
    },
    given,
  };
}

/** A gate a fake can wait at until the test opens it. */
function gate() {
  const { promise, resolve } = Promise.withResolvers<void>();
  return { wait: () => promise, open: () => resolve() };
}

const lemonKitchen = {
  platform: 'youtube',
  originalUrl: YOUTUBE_SHORT.url,
  creatorName: 'Lemon Kitchen',
  creatorUrl: 'https://www.youtube.com/channel/UCLemonKitchen0000000000',
  thumbnailUrl: THUMBNAIL,
};

const shakshukaLines = [
  ['2 tbsp olive oil', '2 tbsp', 'olive oil'],
  ['1 onion, diced', '1', 'onion'],
  ['2 cloves garlic, sliced', '2 cloves', 'garlic'],
  ['1 tsp ground cumin', '1 tsp', 'ground cumin'],
  ['1 can (400g) crushed tomatoes', '1 can (400g)', 'crushed tomato'],
  ['4 eggs', '4', 'egg'],
  ["a handful of Rosa's feta", 'a handful', 'feta'],
];

const shakshukaSteps = [
  'Soften the onion and garlic in the oil.',
  'Add the cumin and tomatoes and simmer for 10 minutes.',
  'Make four wells, crack in the eggs, cover and cook until set.',
  'Crumble over the feta.',
];

test('a YouTube Shorts link produces a Draft from the video’s description, with thumbnail and channel name', async () => {
  const claude = recordingExtract();
  const a = await signInTestUser('a', { extract: claude.extract });

  const { recipeId: id } = await a.data.saveFromLink({ url: YOUTUBE_SHORT.url });
  expect(await a.data.getRecipe(id)).toMatchObject({ title: 'YouTube video', build: { status: 'building' } });
  await a.drafts.settled();

  const draft = await a.data.getRecipe(id);
  expect(draft).toMatchObject({
    title: 'Lemon pasta',
    status: 'draft',
    build: { status: 'built' },
    recipeFound: true,
    steps: ['Cook the linguine.', 'Toss it with the lemon, oil and parmesan.', 'Season with pepper.'],
    sourceVideo: lemonKitchen,
  });
  expect(linesOf(draft)).toEqual([
    ['200g linguine', '200g', 'linguine'],
    ['1 lemon (zest and juice)', '1', 'lemon'],
    ['2 tbsp olive oil', '2 tbsp', 'olive oil'],
    ['30g parmesan, grated', '30g', 'parmesan'],
    ['black pepper', null, 'black pepper'],
  ]);
  // Claude read the description as the caption, with the video's title beside it.
  expect(claude.given).toMatchObject([
    {
      platform: 'youtube',
      kind: 'video',
      externalId: 'LemonPasta1',
      title: 'Lemon pasta in 10 minutes #shorts',
      caption: YOUTUBE_SHORT.video.caption,
      siteRecipe: null,
    },
  ]);
  expect(await a.data.listDrafts()).toEqual([
    {
      id,
      title: 'Lemon pasta',
      build: { status: 'built' },
      recipeFound: true,
      sourceVideo: lemonKitchen,
      createdAt: draft?.createdAt,
    },
  ]);
});

test('youtu.be and watch?v= links to a video are read by its id too; a channel link is refused', async () => {
  const asked: string[] = [];
  const a = await signInTestUser('a', {
    youtube: async (videoId, signal) => {
      asked.push(videoId);
      return fixtureAdapters.youtube(videoId, signal);
    },
  });

  const short = await savedAndBuilt(a, 'https://youtu.be/LemonPasta1?si=xyz');
  const watch = await savedAndBuilt(a, 'https://m.youtube.com/watch?v=LemonPasta1&t=3s');

  expect(asked).toEqual(['LemonPasta1', 'LemonPasta1']);
  expect(await a.data.getRecipe(short)).toMatchObject({ title: 'Lemon pasta', sourceVideo: { creatorName: 'Lemon Kitchen' } });
  expect(await a.data.getRecipe(watch)).toMatchObject({ title: 'Lemon pasta', sourceVideo: { creatorName: 'Lemon Kitchen' } });
  await expect(a.data.saveFromLink({ url: 'https://www.youtube.com/@LemonKitchen' })).rejects.toMatchObject({
    code: 'unsupported_link',
  });
  expect(await a.data.listDrafts()).toHaveLength(2);
});

test('a YouTube video the API has no item for fails as unavailable; with no API key, as not set up', async () => {
  const a = await signInTestUser('a', {
    youtube: async (videoId, signal) => {
      if (videoId === 'NoKeyVideo1') throw new SourceError('notSetUp', 'YOUTUBE_API_KEY is not set.');
      return fixtureAdapters.youtube(videoId, signal);
    },
  });

  const deleted = await savedAndBuilt(a, 'https://www.youtube.com/shorts/Deleted0001');
  const noKey = await savedAndBuilt(a, 'https://www.youtube.com/shorts/NoKeyVideo1');

  expect(await a.data.getRecipe(deleted)).toMatchObject({
    title: 'YouTube video',
    build: { status: 'failed', reason: 'sourceUnavailable', canRetry: true },
    sourceVideo: { platform: 'youtube', originalUrl: 'https://www.youtube.com/shorts/Deleted0001', creatorName: null },
  });
  expect(await a.data.getRecipe(noKey)).toMatchObject({
    title: 'YouTube video',
    build: { status: 'failed', reason: 'notSetUp', canRetry: true },
  });
});

test('a recipe-site URL in a TikTok caption is fetched and its schema.org Recipe builds the Draft', async () => {
  const claude = recordingExtract();
  const pagesAsked: string[] = [];
  const a = await signInTestUser('a', {
    extract: claude.extract,
    page: async (url, signal) => {
      pagesAsked.push(url);
      return fixtureAdapters.page(url, signal);
    },
  });

  const id = await savedAndBuilt(a, SITE_LINK.url);

  // The Instagram link in the caption isn't followed; the recipe site is.
  expect(pagesAsked).toEqual([SHAKSHUKA_PAGE.url]);
  expect(claude.given).toMatchObject([
    {
      platform: 'tiktok',
      kind: 'video',
      caption: SITE_LINK.video.caption,
      recipeSiteUrl: SHAKSHUKA_PAGE.url,
      siteRecipe: {
        name: "Rosa's Shakshuka",
        ingredients: shakshukaLines.map(([text]) => text),
        steps: [
          'Soften the onion and garlic in the oil.',
          'Add the cumin and tomatoes and simmer for 10 minutes.',
          'Make four wells, crack in the eggs, cover & cook until set.',
          'Crumble over the feta.',
        ],
        author: 'Rosa Martínez',
        imageUrl: THUMBNAIL,
      },
    },
  ]);
  const draft = await a.data.getRecipe(id);
  expect(draft).toMatchObject({
    title: 'Shakshuka',
    build: { status: 'built' },
    recipeFound: true,
    steps: shakshukaSteps,
    sourceVideo: { platform: 'tiktok', originalUrl: SITE_LINK.url, creatorName: 'Brunch Club' },
  });
  expect(linesOf(draft)).toEqual(shakshukaLines);
});

test('a recipe-site URL in a YouTube description is followed the same way', async () => {
  const claude = recordingExtract();
  const description = `Shakshuka for one 🍳\nFull recipe: ${SHAKSHUKA_PAGE.url}\n#shorts`;
  const a = await signInTestUser('a', {
    youtube: async () => ({ ...YOUTUBE_SHORT.video, externalId: 'Shakshuka01', caption: description }),
    extract: async (material, signal) => {
      claude.given.push(material);
      return material.siteRecipe ? (SHAKSHUKA_PAGE.extraction ?? fixtureExtract(material, signal)) : fixtureExtract(material, signal);
    },
  });

  const id = await savedAndBuilt(a, 'https://www.youtube.com/shorts/Shakshuka01');

  expect(claude.given).toMatchObject([{ platform: 'youtube', caption: description, recipeSiteUrl: SHAKSHUKA_PAGE.url }]);
  expect(await a.data.getRecipe(id)).toMatchObject({ title: 'Shakshuka', recipeFound: true, steps: shakshukaSteps });
});

test('a caption whose only links fail to load still builds, from the caption alone', async () => {
  const a = await signInTestUser('a', {
    page: async () => {
      throw new SourceError('unreachable', 'No answer.');
    },
  });

  const id = await savedAndBuilt(a, SITE_LINK.url);

  // Without the site's Recipe, the caption has none: "full recipe on my blog".
  expect(await a.data.getRecipe(id)).toMatchObject({
    title: 'Shakshuka',
    build: { status: 'built' },
    recipeFound: false,
    lines: [],
    steps: [],
  });
});

test('sharing a recipe-site link directly produces a Draft from its schema.org Recipe', async () => {
  const claude = recordingExtract();
  const a = await signInTestUser('a', { extract: claude.extract });

  const { recipeId: id } = await a.data.saveFromLink({ text: `Dinner tonight? ${SHAKSHUKA_PAGE.url}` });
  expect(await a.data.getRecipe(id)).toMatchObject({ title: 'cooking.example.com', build: { status: 'building' } });
  await a.drafts.settled();

  expect(claude.given).toMatchObject([
    { platform: 'web', kind: 'recipeSite', caption: null, title: "Rosa's Shakshuka", recipeSiteUrl: SHAKSHUKA_PAGE.url },
  ]);
  const draft = await a.data.getRecipe(id);
  expect(draft).toMatchObject({
    title: 'Shakshuka',
    status: 'draft',
    build: { status: 'built' },
    recipeFound: true,
    steps: shakshukaSteps,
    sourceVideo: {
      platform: 'web',
      originalUrl: SHAKSHUKA_PAGE.url,
      creatorName: 'Rosa Martínez',
      creatorUrl: null,
      thumbnailUrl: THUMBNAIL,
    },
  });
  expect(linesOf(draft)).toEqual(shakshukaLines);
});

test('any other link saves with a plain preview and an empty Draft to fill in, without asking Claude', async () => {
  const claude = recordingExtract();
  const a = await signInTestUser('a', { extract: claude.extract });

  const id = await savedAndBuilt(a, PLAIN_PAGE.url);

  expect(claude.given).toEqual([]);
  expect(await a.data.getRecipe(id)).toMatchObject({
    title: 'My kitchen tour & favourite tools',
    status: 'draft',
    build: { status: 'built' },
    recipeFound: false,
    lines: [],
    steps: [],
    sourceVideo: { platform: 'web', originalUrl: PLAIN_PAGE.url, creatorName: null, creatorUrl: null, thumbnailUrl: THUMBNAIL },
  });

  await a.data.reviewDraft(id, {
    title: 'Kitchen-tour pancakes',
    lines: [{ originalText: '2 eggs', amountText: '2', ingredientName: 'eggs' }],
    steps: ['Whisk and fry.'],
  });
  expect(await a.data.getRecipe(id)).toMatchObject({ title: 'Kitchen-tour pancakes', status: 'reviewed', recipeFound: false });
});

test('a page with no title is named after its host; one that is not HTML gets no preview', async () => {
  const a = await signInTestUser('a', { page: async (url) => ({ url, title: null, imageUrl: null, siteRecipe: null }) });

  const id = await savedAndBuilt(a, 'https://www.example.net/menu.pdf');

  expect(await a.data.getRecipe(id)).toMatchObject({
    title: 'example.net',
    recipeFound: false,
    sourceVideo: { platform: 'web', thumbnailUrl: null },
  });
});

test('a page that cannot be reached is tried once more, then fails; a refused one fails as unreadable', async () => {
  let tries = 0;
  const a = await signInTestUser('a', {
    page: async (url) => {
      if (url.includes('internal')) throw new SourceError('unreadable', 'Not a public host.');
      tries += 1;
      throw new SourceError('unreachable', 'No answer.');
    },
  });

  const down = await savedAndBuilt(a, 'https://down.example.com/recipe');
  const internal = await savedAndBuilt(a, 'https://metadata.google.internal/computeMetadata/v1/');

  expect(tries).toBe(2);
  expect(await a.data.getRecipe(down)).toMatchObject({
    title: 'down.example.com',
    build: { status: 'failed', reason: 'sourceUnreachable', canRetry: true },
  });
  expect(await a.data.getRecipe(internal)).toMatchObject({
    build: { status: 'failed', reason: 'unreadable', canRetry: true },
  });
});

/** A YouTube that answers with `answer()` as it is when asked, and counts the asks. */
function changingYouTube(answer: () => { creatorName: string; thumbnailUrl: string | null }) {
  const asked: string[] = [];
  const youtube = async (videoId: string, signal: AbortSignal) => {
    asked.push(videoId);
    return { ...(await fixtureAdapters.youtube(videoId, signal)), ...answer() };
  };
  return { youtube, asked };
}

test('YouTube metadata older than 30 days is re-fetched when the Recipe is viewed', async () => {
  let now = { creatorName: 'Lemon Kitchen', thumbnailUrl: THUMBNAIL };
  const platform = changingYouTube(() => now);
  const a = await signInTestUser('a', { youtube: platform.youtube });
  const id = await savedAndBuilt(a, YOUTUBE_SHORT.url);
  await a.data.reviewDraft(id, {
    title: 'My lemon pasta',
    lines: [{ originalText: '200g linguine', amountText: '200g', ingredientName: 'linguine' }],
    steps: ['Cook it.'],
  });
  now = { creatorName: 'Lemon Kitchen Official', thumbnailUrl: 'https://i.ytimg.com/vi/LemonPasta1/hq720.jpg' };

  await backdateSourceVideo(id, 29);
  expect((await a.data.getRecipe(id))?.sourceVideo).toEqual(lemonKitchen);
  expect(platform.asked).toEqual(['LemonPasta1']);

  await backdateSourceVideo(id, 31);
  const viewed = await a.data.getRecipe(id);

  expect(platform.asked).toEqual(['LemonPasta1', 'LemonPasta1']);
  expect(viewed?.sourceVideo).toEqual({
    ...lemonKitchen,
    creatorName: 'Lemon Kitchen Official',
    thumbnailUrl: 'https://i.ytimg.com/vi/LemonPasta1/hq720.jpg',
  });
  // The reviewed Recipe's own text is the user's: the refresh leaves it.
  expect(viewed).toMatchObject({ title: 'My lemon pasta', status: 'reviewed', steps: ['Cook it.'] });
  expect(linesOf(viewed)).toEqual([['200g linguine', '200g', 'linguine']]);
  // Fresh again, so viewing it again asks nothing.
  await a.data.getRecipe(id);
  expect(platform.asked).toHaveLength(2);
});

test('TikTok data is not re-read for its age, only when its thumbnail fails', async () => {
  const asked: string[] = [];
  const a = await signInTestUser('a', {
    tiktok: async (url, signal) => {
      asked.push(url);
      return fixtureAdapters.tiktok(url, signal);
    },
  });
  const id = await savedAndBuilt(a, FULL_RECIPE.url);

  await backdateSourceVideo(id, 45);
  await a.data.getRecipe(id);

  expect(asked).toEqual([FULL_RECIPE.url]);
});

test('viewing a Recipe waits 5 s at most for YouTube to answer, then shows what is stored', { timeout: 20_000 }, async () => {
  const youtubeAnswers = gate();
  let calls = 0;
  const a = await signInTestUser('a', {
    youtube: async (videoId, signal) => {
      calls += 1;
      if (calls > 1) await youtubeAnswers.wait();
      return fixtureAdapters.youtube(videoId, signal);
    },
  });
  const id = await savedAndBuilt(a, YOUTUBE_SHORT.url);
  await backdateSourceVideo(id, 31);

  const started = Date.now();
  const viewed = await a.data.getRecipe(id);
  const waited = Date.now() - started;

  expect(waited).toBeGreaterThanOrEqual(4_900);
  expect(waited).toBeLessThan(8_000);
  expect(viewed?.sourceVideo).toEqual(lemonKitchen);
  youtubeAnswers.open();
});

/** A platform that gives the expired thumbnail until `later` is set, then a new one. */
function expiringThumbnails() {
  const state = { later: false, asked: 0 };
  const adapters = () => (state.later ? laterFixtureAdapters : fixtureAdapters);
  return {
    state,
    youtube: async (videoId: string, signal: AbortSignal) => {
      state.asked += 1;
      return adapters().youtube(videoId, signal);
    },
    tiktok: async (url: string, signal: AbortSignal) => {
      state.asked += 1;
      const video = await adapters().tiktok(url, signal);
      return state.later ? { ...video, thumbnailUrl: 'https://p16-sign.tiktokcdn.com/new.jpeg' } : video;
    },
  };
}

test.each([
  ['YouTube', EXPIRED_THUMBNAIL.url, THUMBNAIL],
  ['TikTok', FULL_RECIPE.url, 'https://p16-sign.tiktokcdn.com/new.jpeg'],
])('when a stored %s thumbnail URL fails to load, it is re-fetched, at most once every 10 minutes', async (_, url, fresh) => {
  const platform = expiringThumbnails();
  const a = await signInTestUser('a', { youtube: platform.youtube, tiktok: platform.tiktok });
  const id = await savedAndBuilt(a, url);
  const stored = (await a.data.getRecipe(id))?.sourceVideo;
  platform.state.later = true;

  const refreshed = await a.data.refreshSourceVideo(id);

  expect(refreshed).toEqual({ ...stored, thumbnailUrl: fresh });
  expect((await a.data.getRecipe(id))?.sourceVideo).toEqual({ ...stored, thumbnailUrl: fresh });
  expect(platform.state.asked).toBe(2);

  // Failing again within 10 minutes: not asked again; it comes back as stored.
  expect(await a.data.refreshSourceVideo(id)).toEqual({ ...stored, thumbnailUrl: fresh });
  expect(platform.state.asked).toBe(2);

  await backdateSourceRefresh(id, 11);
  await a.data.refreshSourceVideo(id);
  expect(platform.state.asked).toBe(3);
});

test('a web page’s picture is never re-fetched', async () => {
  const pagesAsked: string[] = [];
  const a = await signInTestUser('a', {
    page: async (url, signal) => {
      pagesAsked.push(url);
      return fixtureAdapters.page(url, signal);
    },
  });
  const id = await savedAndBuilt(a, PLAIN_PAGE.url);

  expect(await a.data.refreshSourceVideo(id)).toEqual({
    platform: 'web',
    originalUrl: PLAIN_PAGE.url,
    creatorName: null,
    creatorUrl: null,
    thumbnailUrl: THUMBNAIL,
  });
  expect(pagesAsked).toEqual([PLAIN_PAGE.url]);
});

test('a video the platform no longer has loses what was stored about it; one it cannot reach keeps it', async () => {
  let answer: 'ok' | 'gone' | 'down' = 'ok';
  const a = await signInTestUser('a', {
    youtube: async (videoId, signal) => {
      if (answer === 'gone') throw new SourceError('unavailable', 'No such video.');
      if (answer === 'down') throw new SourceError('unreachable', 'No answer.');
      return fixtureAdapters.youtube(videoId, signal);
    },
  });
  const id = await savedAndBuilt(a, YOUTUBE_SHORT.url);

  answer = 'down';
  expect(await a.data.refreshSourceVideo(id)).toEqual(lemonKitchen);

  answer = 'gone';
  await backdateSourceRefresh(id, 11);
  expect(await a.data.refreshSourceVideo(id)).toEqual({
    platform: 'youtube',
    originalUrl: YOUTUBE_SHORT.url,
    creatorName: null,
    creatorUrl: null,
    thumbnailUrl: null,
  });
  // The Draft itself is untouched.
  expect(await a.data.getRecipe(id)).toMatchObject({ title: 'Lemon pasta', recipeFound: true });
});

test('two refreshes at once ask the platform once', async () => {
  const platform = expiringThumbnails();
  const a = await signInTestUser('a', { youtube: platform.youtube });
  const id = await savedAndBuilt(a, EXPIRED_THUMBNAIL.url);
  platform.state.later = true;

  await Promise.all([a.data.refreshSourceVideo(id), a.data.refreshSourceVideo(id)]);

  expect(platform.state.asked).toBe(2);
  expect((await a.data.getRecipe(id))?.sourceVideo).toEqual({
    platform: 'youtube',
    originalUrl: EXPIRED_THUMBNAIL.url,
    creatorName: 'Rice Guy',
    creatorUrl: 'https://www.youtube.com/channel/UCRiceGuy00000000000000',
    thumbnailUrl: THUMBNAIL,
  });
});

test('two views at once of a Recipe with old YouTube data ask YouTube once', async () => {
  let now = { creatorName: 'Lemon Kitchen', thumbnailUrl: THUMBNAIL };
  const platform = changingYouTube(() => now);
  const a = await signInTestUser('a', { youtube: platform.youtube });
  const id = await savedAndBuilt(a, YOUTUBE_SHORT.url);
  now = { creatorName: 'Lemon Kitchen Official', thumbnailUrl: THUMBNAIL };
  await backdateSourceVideo(id, 40);

  await Promise.all([a.data.getRecipe(id), a.data.getRecipe(id)]);

  expect(platform.asked).toEqual(['LemonPasta1', 'LemonPasta1']);
  expect((await a.data.getRecipe(id))?.sourceVideo).toEqual({ ...lemonKitchen, creatorName: 'Lemon Kitchen Official' });
});

test('a stranger cannot refresh someone else’s Source Video, nor use up its 10 minutes', async () => {
  const platform = expiringThumbnails();
  const a = await signInTestUser('a', { youtube: platform.youtube });
  const b = await signInTestUser('b', { youtube: platform.youtube });
  const id = await savedAndBuilt(a, EXPIRED_THUMBNAIL.url);
  platform.state.later = true;

  expect(await b.data.refreshSourceVideo(id)).toBeNull();
  expect(platform.state.asked).toBe(1);

  expect((await a.data.refreshSourceVideo(id))?.thumbnailUrl).toBe(THUMBNAIL);
  expect(platform.state.asked).toBe(2);
});

test('a daily job drops YouTube data over 30 days old that nobody viewed, and nothing else', async () => {
  let youtubeUp = true;
  const a = await signInTestUser('a', {
    youtube: async (videoId, signal) => {
      if (!youtubeUp) throw new SourceError('unreachable', 'No answer.');
      return fixtureAdapters.youtube(videoId, signal);
    },
  });
  const old = await savedAndBuilt(a, YOUTUBE_SHORT.url);
  const recent = await savedAndBuilt(a, EXPIRED_THUMBNAIL.url);
  const tiktok = await savedAndBuilt(a, FULL_RECIPE.url);
  await a.data.reviewDraft(old, {
    title: 'My lemon pasta',
    lines: [{ originalText: '200g linguine', amountText: '200g', ingredientName: 'linguine' }],
    steps: ['Cook it.'],
  });
  await backdateSourceVideo(old, 31);
  await backdateSourceVideo(recent, 20);
  await backdateSourceVideo(tiktok, 60);
  youtubeUp = false;

  await runYouTubeExpiryJob();

  // Viewing it can't refill it (YouTube is down), so what the job left shows.
  const viewed = await a.data.getRecipe(old);
  expect(viewed?.sourceVideo).toEqual({
    platform: 'youtube',
    originalUrl: YOUTUBE_SHORT.url,
    creatorName: null,
    creatorUrl: null,
    thumbnailUrl: null,
  });
  expect(viewed).toMatchObject({ title: 'My lemon pasta', steps: ['Cook it.'] });
  expect(linesOf(viewed)).toEqual([['200g linguine', '200g', 'linguine']]);
  expect((await a.data.getRecipe(recent))?.sourceVideo).toMatchObject({ creatorName: 'Rice Guy' });
  expect((await a.data.getRecipe(tiktok))?.sourceVideo).toMatchObject({ creatorName: 'Pasta Queen', thumbnailUrl: THUMBNAIL });
  expect(await scheduledJobs()).toContainEqual({
    jobname: 'expire-youtube-source-data',
    schedule: '17 3 * * *',
    command: 'select private.expire_youtube_source_data()',
  });
});

/**
 * TikTok's oEmbed as a fake fetch, through the real adapter and guarded fetch: it answers with the
 * video until `status` is set, then with that status.
 */
function tiktokOEmbed() {
  const state: { status: number | null } = { status: null };
  const safeFetch = createSafeFetch({
    resolveHost: async () => ['93.184.216.34'],
    fetch: async () =>
      state.status === null
        ? Response.json({
            title: FULL_RECIPE.video.caption,
            author_name: 'Pasta Queen',
            author_url: 'https://www.tiktok.com/@pastaqueen',
            thumbnail_url: 'https://p16-sign.tiktokcdn.com/old.jpeg',
          })
        : new Response('Too many requests', { status: state.status }),
  });
  return { state, tiktok: tiktokOEmbedAdapter(safeFetch) };
}

test.each([429, 403, 503])('a refresh TikTok answers with %i keeps the creator, caption and thumbnail', async (status) => {
  const oEmbed = tiktokOEmbed();
  const a = await signInTestUser('a', { tiktok: oEmbed.tiktok });
  const id = await savedAndBuilt(a, FULL_RECIPE.url);
  const stored = {
    platform: 'tiktok',
    originalUrl: FULL_RECIPE.url,
    creatorName: 'Pasta Queen',
    creatorUrl: 'https://www.tiktok.com/@pastaqueen',
    thumbnailUrl: 'https://p16-sign.tiktokcdn.com/old.jpeg',
  };
  expect((await a.data.getRecipe(id))?.sourceVideo).toEqual(stored);
  oEmbed.state.status = status;

  expect(await a.data.refreshSourceVideo(id)).toEqual(stored);
});

/**
 * The real page adapter through the real guarded fetch, over a fake network: `dns` gives each
 * host's addresses, and every request that gets out is answered with the recipe site's page (so
 * a link the guard should have stopped would build a full Draft) and recorded.
 */
function guardedPages(dns: Record<string, string[]>, redirects: Record<string, string> = {}) {
  const requested: string[] = [];
  const page = pageAdapter(
    createSafeFetch({
      resolveHost: async (host) => dns[host] ?? ['93.184.216.34'],
      fetch: async (input) => {
        const url = String(input);
        requested.push(url);
        const next = redirects[url];
        if (next) return new Response(null, { status: 302, headers: { Location: next } });
        return new Response(SHAKSHUKA_PAGE.html, { headers: { 'Content-Type': 'text/html' } });
      },
    }),
  );
  return { page, requested };
}

test.each([
  ['a host that resolves to the cloud metadata address', 'https://metadata.example.net/latest/', {}],
  ['a redirect to a host on the private network', 'https://short.example.com/r', { 'https://short.example.com/r': 'https://intranet.example.net/' }],
])('a shared link to %s fails as unreadable, through the real guarded fetch, never fetched', async (_, url, redirects) => {
  const pages = guardedPages({ 'metadata.example.net': ['169.254.169.254'], 'intranet.example.net': ['10.0.0.7'] }, redirects);
  const a = await signInTestUser('a', { page: pages.page });

  const id = await savedAndBuilt(a, url);

  expect(await a.data.getRecipe(id)).toMatchObject({
    status: 'draft',
    build: { status: 'failed', reason: 'unreadable', canRetry: true },
    lines: [],
    steps: [],
  });
  expect(pages.requested).toEqual(Object.keys(redirects));
});

test('a recipe-site link in a caption that leads to a private address is not fetched; the video still builds', async () => {
  const pages = guardedPages({ 'cooking.example.com': ['127.0.0.1'] });
  const a = await signInTestUser('a', { page: pages.page });

  const id = await savedAndBuilt(a, SITE_LINK.url);

  expect(pages.requested).toEqual([]);
  expect(await a.data.getRecipe(id)).toMatchObject({ build: { status: 'built' }, recipeFound: false, lines: [] });
});
