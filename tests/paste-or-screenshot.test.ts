// Ticket 05: Instagram via a screenshot or a pasted caption, and the same two paths for a Draft
// whose source couldn't be read (TikTok's empty oEmbed, a recipe site's 402). Builds run
// in-process with fake platforms and a fake Claude call (supabase/functions/_shared/draft-fixtures.ts);
// screenshots go through the local Storage as the user, and the builder downloads them as the
// service role, as the build-draft function does. No network.
import { describe, expect, test } from 'vitest';

import type { Recipe, RecipeId } from '../src/data';
import { instagramShortcode } from '../supabase/functions/_shared/detect-source';
import {
  claudeExtractor,
  userTurn,
  type Extract,
  type ExtractInput,
} from '../supabase/functions/_shared/claude-extractor';
import {
  NO_CAPTION,
  PASTED_CAPTION,
  REFUSED_PAGE,
  SCREENSHOT_RECIPE,
  SHAKSHUKA_PAGE,
  UNREADABLE,
  fixtureAdapters,
  fixtureExtract,
} from '../supabase/functions/_shared/draft-fixtures';
import { pageAdapter } from '../supabase/functions/_shared/page-reader';
import { createSafeFetch } from '../supabase/functions/_shared/safe-fetch';
import { screenshotLoader } from '../supabase/functions/_shared/screenshot';
import { tiktokOEmbedAdapter } from '../supabase/functions/_shared/source-reader';
import { countLinkSaves, signInTestUser, type DraftFakes, type TestUser } from './harness';
import { SCREENSHOT_BASE64, screenshotBytes } from './screenshot-fixture';

const REEL = 'https://www.instagram.com/reel/C1a2b3c4d5e/';

const plainReel = {
  platform: 'instagram',
  originalUrl: REEL,
  creatorName: null,
  creatorUrl: null,
  thumbnailUrl: null,
};

const linesOf = (recipe: Recipe | null) => recipe?.lines.map((l) => [l.originalText, l.amountText, l.ingredient.name]);

const honeyChickenLines = [
  ['4 chicken thighs', '4', 'chicken thigh'],
  ['3 tbsp honey', '3 tbsp', 'honey'],
  ['3 cloves garlic, minced', '3 cloves', 'garlic'],
  ['2 tbsp soy sauce', '2 tbsp', 'soy sauce'],
  ['1 tbsp butter', '1 tbsp', 'butter'],
];

const misoSalmonLines = [
  ['2 salmon fillets', '2', 'salmon fillet'],
  ['2 tbsp white miso', '2 tbsp', 'white miso'],
  ['1 tbsp maple syrup', '1 tbsp', 'maple syrup'],
  ['1 tsp sesame seeds', '1 tsp', 'sesame seed'],
];

/** A fake Claude call that records what it was given, and the fake platforms, recording every ask. */
function recording(extra: DraftFakes = {}) {
  const given: ExtractInput[] = [];
  const asked: string[] = [];
  const extract: Extract = async (material, signal) => {
    given.push(material);
    return fixtureExtract(material, signal);
  };
  const fakes: DraftFakes = {
    extract,
    tiktok: async (url, signal) => {
      asked.push(url);
      return (extra.tiktok ?? fixtureAdapters.tiktok)(url, signal);
    },
    youtube: async (id, signal) => {
      asked.push(id);
      return fixtureAdapters.youtube(id, signal);
    },
    page: async (url, signal) => {
      asked.push(url);
      return (extra.page ?? fixtureAdapters.page)(url, signal);
    },
  };
  return { fakes, given, asked };
}

async function savedAndBuilt(user: TestUser, shared: Parameters<TestUser['data']['saveFromLink']>[0]): Promise<RecipeId> {
  const { recipeId } = await user.data.saveFromLink(shared);
  await user.drafts.settled();
  return recipeId;
}

/** The bytes behind a screenshot link, as the phone would load it. */
async function bytesAt(url: string | undefined): Promise<string | null> {
  if (!url) return null;
  const response = await fetch(url);
  return response.ok ? Buffer.from(await response.arrayBuffer()).toString('base64') : null;
}

describe('Instagram links', () => {
  test.each([
    ['https://www.instagram.com/reel/C1a2b3c4d5e/', 'C1a2b3c4d5e'],
    ['https://www.instagram.com/reels/C1a2b3c4d5e/?igsh=MTc4MmM1YmI2Ng==', 'C1a2b3c4d5e'],
    ['https://instagram.com/p/C1a-b_c4d5e', 'C1a-b_c4d5e'],
    ['https://www.instagram.com/pastaqueen/reel/C1a2b3c4d5e/', 'C1a2b3c4d5e'],
    ['https://instagr.am/p/C1a2b3c4d5e/', 'C1a2b3c4d5e'],
    ['https://www.instagram.com/pastaqueen/', null],
    ['https://www.instagram.com/explore/tags/pasta/', null],
    ['https://www.instagram.com/reel/', null],
    ['https://www.tiktok.com/@pastaqueen/video/7400000000000000001', null],
  ])('%s has the shortcode %s', (link, code) => {
    expect(instagramShortcode(link)).toBe(code);
  });
});

test('an Instagram Reel saved with neither a screenshot nor a caption is a recipe-not-in-caption Draft, without asking Claude or Instagram', async () => {
  const claude = recording();
  const a = await signInTestUser('a', claude.fakes);

  const { recipeId: id } = await a.data.saveFromLink({ text: `Look at this ${REEL}` });
  expect(await a.data.getRecipe(id)).toMatchObject({ title: 'Instagram Reel', build: { status: 'building' } });
  await a.drafts.settled();

  expect(claude.given).toEqual([]);
  expect(claude.asked).toEqual([]);
  const draft = await a.data.getRecipe(id);
  expect(draft).toMatchObject({
    title: 'Instagram Reel',
    status: 'draft',
    build: { status: 'built' },
    recipeFound: false,
    lines: [],
    steps: [],
  });
  expect(draft?.sourceVideo).toEqual(plainReel);
  expect(await countLinkSaves(a)).toBe(1);
});

test('a pasted caption is read by the Draft builder', async () => {
  const claude = recording();
  const a = await signInTestUser('a', claude.fakes);

  const id = await savedAndBuilt(a, { url: REEL, caption: `  ${PASTED_CAPTION.text}\n` });

  expect(claude.given).toMatchObject([
    {
      platform: 'instagram',
      kind: 'video',
      externalId: 'C1a2b3c4d5e',
      caption: null,
      pastedText: PASTED_CAPTION.text,
      screenshot: null,
      siteRecipe: null,
    },
  ]);
  const draft = await a.data.getRecipe(id);
  expect(draft).toMatchObject({
    title: 'Honey garlic chicken',
    build: { status: 'built' },
    recipeFound: true,
    steps: PASTED_CAPTION.extraction.steps,
  });
  expect(linesOf(draft)).toEqual(honeyChickenLines);
  expect(draft?.sourceVideo).toEqual(plainReel);
  expect(claude.asked).toEqual([]);
});

test('a pasted caption that links to a recipe site is built from the site’s Recipe; its Meta links are never fetched', async () => {
  const claude = recording();
  const a = await signInTestUser('a', claude.fakes);
  const caption = `Rosa’s shakshuka 🍳 More on https://www.instagram.com/p/Other12345/ and https://l.facebook.com/l.php?u=x — full recipe: ${SHAKSHUKA_PAGE.url}`;

  const id = await savedAndBuilt(a, { url: REEL, caption });

  expect(claude.asked).toEqual([SHAKSHUKA_PAGE.url]);
  expect(claude.given).toMatchObject([
    { platform: 'instagram', pastedText: caption, recipeSiteUrl: SHAKSHUKA_PAGE.url, siteRecipe: { name: "Rosa's Shakshuka" } },
  ]);
  const draft = await a.data.getRecipe(id);
  expect(draft).toMatchObject({ title: 'Shakshuka', build: { status: 'built' }, recipeFound: true });
  expect(linesOf(draft)?.map(([, , name]) => name)).toEqual([
    'olive oil',
    'onion',
    'garlic',
    'ground cumin',
    'crushed tomato',
    'egg',
    'feta',
  ]);
});

test('a screenshot is stored as the user’s own image and read by the Draft builder', async () => {
  const claude = recording();
  const a = await signInTestUser('a', claude.fakes);

  const id = await savedAndBuilt(a, { url: REEL, screenshot: screenshotBytes() });

  // Sent to Claude as the image it is, with no caption beside it.
  expect(claude.given).toHaveLength(1);
  expect(claude.given[0]).toMatchObject({ platform: 'instagram', pastedText: null, screenshotPath: `${a.userId}/${id}.jpg` });
  expect(claude.given[0]?.screenshot).toEqual({ mediaType: 'image/jpeg', base64: SCREENSHOT_BASE64 });
  const draft = await a.data.getRecipe(id);
  expect(draft).toMatchObject({ title: 'Miso-glazed salmon', build: { status: 'built' }, recipeFound: true });
  expect(linesOf(draft)).toEqual(misoSalmonLines);
  // The screenshot is the Recipe's picture: a link to the user's own copy of it.
  expect(draft?.sourceVideo).toEqual({ ...plainReel, screenshotUrl: expect.stringContaining(`/recipe-images/${a.userId}/${id}.jpg?token=`) });
  expect(await bytesAt(draft?.sourceVideo?.screenshotUrl)).toBe(SCREENSHOT_BASE64);
  expect((await a.data.listDrafts())[0]?.sourceVideo?.screenshotUrl).toEqual(expect.stringContaining(`${a.userId}/${id}.jpg`));
  expect(claude.asked).toEqual([]);
});

test('a screenshot and a caption added together both go to Claude, the image first', async () => {
  const claude = recording();
  const a = await signInTestUser('a', claude.fakes);

  const id = await savedAndBuilt(a, { url: REEL, caption: PASTED_CAPTION.text, screenshot: screenshotBytes() });

  const given = claude.given[0];
  expect(given).toMatchObject({ pastedText: PASTED_CAPTION.text, screenshot: { base64: SCREENSHOT_BASE64 } });
  expect(given && userTurn(given)).toEqual([
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: SCREENSHOT_BASE64 } },
    { type: 'text', text: expect.stringContaining(`<pasted_caption>\n${PASTED_CAPTION.text}\n</pasted_caption>`) },
  ]);
  expect(await a.data.getRecipe(id)).toMatchObject({ title: 'Honey garlic chicken', recipeFound: true });
});

test('the real Claude call sends the screenshot as an image block before the text, and no empty caption', async () => {
  const sent: unknown[] = [];
  const extract = claudeExtractor({
    messages: {
      create: async (params) => {
        sent.push(params);
        return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(SCREENSHOT_RECIPE), citations: null }] };
      },
    },
  });
  const material: ExtractInput = {
    platform: 'instagram',
    kind: 'video',
    originalUrl: REEL,
    externalId: 'C1a2b3c4d5e',
    title: null,
    caption: null,
    creatorName: null,
    creatorUrl: null,
    thumbnailUrl: null,
    siteRecipe: null,
    recipeSiteUrl: null,
    pastedText: null,
    screenshotPath: 'u/r.jpg',
    screenshot: { mediaType: 'image/jpeg', base64: SCREENSHOT_BASE64 },
  };

  expect(await extract(material, new AbortController().signal)).toEqual(SCREENSHOT_RECIPE);
  expect(sent).toMatchObject([
    {
      model: 'claude-haiku-5-5',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: SCREENSHOT_BASE64 } },
            { type: 'text', text: 'The screenshot above is the one the user added.' },
          ],
        },
      ],
    },
  ]);
});

test('the screenshot loader sends Claude only a JPEG of a size it takes', async () => {
  const load = (bytes: Uint8Array) => screenshotLoader(async () => bytes.slice().buffer)('u/r.jpg', new AbortController().signal);
  const jpeg = new Uint8Array(screenshotBytes());

  await expect(load(jpeg)).resolves.toEqual({ mediaType: 'image/jpeg', base64: SCREENSHOT_BASE64 });
  await expect(load(new TextEncoder().encode('<svg onload="alert(1)"></svg>'))).rejects.toThrow("isn't a JPEG");
  await expect(load(new Uint8Array())).rejects.toThrow("isn't a JPEG");
  const huge = new Uint8Array(3 * 1024 * 1024 + 1);
  huge.set(jpeg.subarray(0, 3));
  await expect(load(huge)).rejects.toThrow('bytes');
});

test('a TikTok whose oEmbed gives no caption is “couldn’t read it”, then a pasted caption builds it, read through the real oEmbed adapter', async () => {
  // TikTok's oEmbed as it answers since October 2026: the player, and no title, author or thumbnail.
  const oEmbed = tiktokOEmbedAdapter(
    createSafeFetch({
      resolveHost: async () => ['23.42.0.1'],
      fetch: async () =>
        new Response(
          JSON.stringify({
            version: '1.0',
            type: 'video',
            html: '<blockquote class="tiktok-embed"></blockquote>',
            embed_product_id: '7400000000000000005',
            provider_name: 'TikTok',
          }),
          { headers: { 'Content-Type': 'application/json' } },
        ),
    }),
  );
  const claude = recording({ tiktok: oEmbed });
  const a = await signInTestUser('a', claude.fakes);

  const id = await savedAndBuilt(a, { url: NO_CAPTION.url });

  expect(claude.given).toEqual([]);
  expect(await a.data.getRecipe(id)).toMatchObject({
    title: 'TikTok video',
    status: 'draft',
    build: { status: 'failed', reason: 'noCaption', canRetry: true },
    lines: [],
    sourceVideo: { platform: 'tiktok', originalUrl: NO_CAPTION.url },
  });
  expect((await a.data.listDrafts()).map((d) => [d.id, d.build])).toEqual([
    [id, { status: 'failed', reason: 'noCaption', canRetry: true }],
  ]);

  await a.data.addCaptionToDraft(id, { caption: PASTED_CAPTION.text });
  await a.drafts.settled();

  // oEmbed was asked again (it may come back), and the user's caption was read.
  expect(claude.asked).toEqual([NO_CAPTION.url, NO_CAPTION.url]);
  expect(claude.given).toMatchObject([{ platform: 'tiktok', externalId: '7400000000000000005', caption: null, pastedText: PASTED_CAPTION.text }]);
  const draft = await a.data.getRecipe(id);
  expect(draft).toMatchObject({
    title: 'Honey garlic chicken',
    status: 'draft',
    build: { status: 'built' },
    recipeFound: true,
    sourceVideo: { platform: 'tiktok', originalUrl: NO_CAPTION.url, creatorName: null, thumbnailUrl: null },
  });
  expect(linesOf(draft)).toEqual(honeyChickenLines);
});

test('a TikTok with no caption builds from a screenshot too', async () => {
  const claude = recording();
  const a = await signInTestUser('a', claude.fakes);
  const id = await savedAndBuilt(a, { url: NO_CAPTION.url });
  expect(await a.data.getRecipe(id)).toMatchObject({ build: { status: 'failed', reason: 'noCaption' } });

  await a.data.addCaptionToDraft(id, { screenshot: screenshotBytes() });
  await a.drafts.settled();

  expect(claude.given).toMatchObject([{ platform: 'tiktok', pastedText: null, screenshot: { base64: SCREENSHOT_BASE64 } }]);
  const draft = await a.data.getRecipe(id);
  expect(draft).toMatchObject({ title: 'Miso-glazed salmon', build: { status: 'built' }, recipeFound: true });
  expect(linesOf(draft)).toEqual(misoSalmonLines);
  expect(await bytesAt(draft?.sourceVideo?.screenshotUrl)).toBe(SCREENSHOT_BASE64);
});

/** The real page adapter through the real guarded fetch, over a site that answers every request 402. */
function paywalledSite() {
  const requested: string[] = [];
  const page = pageAdapter(
    createSafeFetch({
      resolveHost: async () => ['93.184.216.34'],
      fetch: async (input) => {
        requested.push(String(input));
        return new Response('<html><title>Subscribe</title></html>', { status: 402, headers: { 'Content-Type': 'text/html' } });
      },
    }),
  );
  return { page, requested };
}

test('a recipe page that answers 402 is “couldn’t read it”, then a pasted recipe or a screenshot builds it', async () => {
  const site = paywalledSite();
  const claude = recording({ page: site.page });
  const a = await signInTestUser('a', claude.fakes);

  const pasted = await savedAndBuilt(a, { url: REFUSED_PAGE.url });
  const pictured = await savedAndBuilt(a, { url: REFUSED_PAGE.url });

  expect(site.requested).toEqual([REFUSED_PAGE.url, REFUSED_PAGE.url]);
  expect(claude.given).toEqual([]);
  for (const id of [pasted, pictured]) {
    expect(await a.data.getRecipe(id)).toMatchObject({
      title: 'paywall.example.com',
      build: { status: 'failed', reason: 'sourceRefused', canRetry: true },
      lines: [],
      sourceVideo: { platform: 'web', originalUrl: REFUSED_PAGE.url, thumbnailUrl: null },
    });
  }

  await a.data.addCaptionToDraft(pasted, { caption: PASTED_CAPTION.text });
  await a.data.addCaptionToDraft(pictured, { screenshot: screenshotBytes() });
  await a.drafts.settled();

  const fromText = await a.data.getRecipe(pasted);
  expect(fromText).toMatchObject({
    title: 'Honey garlic chicken',
    build: { status: 'built' },
    recipeFound: true,
    sourceVideo: { platform: 'web', originalUrl: REFUSED_PAGE.url },
  });
  expect(linesOf(fromText)).toEqual(honeyChickenLines);
  const fromPicture = await a.data.getRecipe(pictured);
  expect(fromPicture).toMatchObject({ title: 'Miso-glazed salmon', build: { status: 'built' }, recipeFound: true });
  expect(linesOf(fromPicture)).toEqual(misoSalmonLines);
  // The page was asked once more each time, and refused again; it never stopped the build.
  expect(site.requested).toHaveLength(4);
});

test('a caption that was read and has no recipe is still “recipe not in caption”, not “couldn’t read it”', async () => {
  const a = await signInTestUser('a');

  const id = await savedAndBuilt(a, { url: 'https://www.tiktok.com/@snackdad/video/7400000000000000002' });

  expect(await a.data.getRecipe(id)).toMatchObject({ build: { status: 'built' }, recipeFound: false });
});

test('adding a caption counts as a Retry: after 3 builds in all there is only “Fill in by hand”', async () => {
  const a = await signInTestUser('a');
  const id = await savedAndBuilt(a, { url: NO_CAPTION.url });

  // 2: a caption Claude can't read a recipe from.
  await a.data.addCaptionToDraft(id, { caption: UNREADABLE.video.caption });
  await a.drafts.settled();
  expect(await a.data.getRecipe(id)).toMatchObject({ build: { status: 'failed', reason: 'unreadable', canRetry: true } });

  // 3: a plain Retry, with the same caption.
  await a.data.retryDraft(id);
  await a.drafts.settled();
  expect(await a.data.getRecipe(id)).toMatchObject({ build: { status: 'failed', reason: 'unreadable', canRetry: false } });

  await expect(a.data.addCaptionToDraft(id, { caption: PASTED_CAPTION.text })).rejects.toMatchObject({ code: 'no_attempts_left' });
  await a.drafts.settled();
  expect(await a.data.getRecipe(id)).toMatchObject({ build: { status: 'failed', reason: 'unreadable', canRetry: false }, lines: [] });
  // Filled in by hand, it's a Recipe like any other.
  await a.data.reviewDraft(id, { title: 'Quiet noodles', lines: [{ originalText: 'noodles', ingredientName: 'noodles' }], steps: [] });
  expect(await a.data.getRecipe(id)).toMatchObject({ title: 'Quiet noodles', status: 'reviewed' });
});

test('a caption or screenshot is added only to a failed Draft, and only with something in it', async () => {
  const a = await signInTestUser('a');
  const built = await savedAndBuilt(a, { url: REEL, caption: PASTED_CAPTION.text });
  const failed = await savedAndBuilt(a, { url: NO_CAPTION.url });

  await expect(a.data.addCaptionToDraft(built, { caption: 'more' })).rejects.toMatchObject({ code: 'draft_built' });
  await expect(a.data.addCaptionToDraft(failed, { caption: '  \n ' })).rejects.toMatchObject({ code: 'nothing_added' });
  await expect(a.data.addCaptionToDraft(failed, {})).rejects.toMatchObject({ code: 'nothing_added' });
  await expect(a.data.addCaptionToDraft(failed, { caption: 'x'.repeat(10_001) })).rejects.toMatchObject({ code: 'caption_too_long' });
  await expect(a.data.saveFromLink({ url: REEL, caption: 'x'.repeat(10_001) })).rejects.toMatchObject({ code: 'caption_too_long' });

  expect(await a.data.getRecipe(failed)).toMatchObject({ build: { status: 'failed', reason: 'noCaption', canRetry: true } });
  expect(await a.data.getRecipe(built)).toMatchObject({ title: 'Honey garlic chicken', build: { status: 'built' } });
  expect((await a.data.listDrafts()).map((d) => d.id).sort()).toEqual([built, failed].sort());
});

test('a save with a screenshot sent twice at once makes one Draft, one image and one link save', async () => {
  const claude = recording();
  const a = await signInTestUser('a', claude.fakes);
  const draftId = a.data.newDraftId();

  await Promise.all([
    a.data.saveFromLink({ url: REEL, screenshot: screenshotBytes(), draftId }),
    a.data.saveFromLink({ url: REEL, screenshot: screenshotBytes(), draftId }),
  ]);
  await a.drafts.settled();

  expect(claude.given).toHaveLength(1);
  expect((await a.data.listDrafts()).map((d) => [d.id, d.title, d.build])).toEqual([
    [draftId, 'Miso-glazed salmon', { status: 'built' }],
  ]);
  expect(await countLinkSaves(a)).toBe(1);
  expect(await bytesAt((await a.data.getRecipe(draftId))?.sourceVideo?.screenshotUrl)).toBe(SCREENSHOT_BASE64);
});

test('a caption added twice at once builds the Draft once, as one Retry', async () => {
  const claude = recording();
  const a = await signInTestUser('a', claude.fakes);
  const id = await savedAndBuilt(a, { url: NO_CAPTION.url });

  await Promise.all([
    a.data.addCaptionToDraft(id, { caption: PASTED_CAPTION.text }),
    a.data.addCaptionToDraft(id, { caption: PASTED_CAPTION.text }),
  ]);
  await a.drafts.settled();

  expect(claude.given).toHaveLength(1);
  expect(await a.data.getRecipe(id)).toMatchObject({ title: 'Honey garlic chicken', build: { status: 'built' } });
  // One build for the save, one for the caption: a Retry is left.
  await expect(a.data.listDrafts()).resolves.toMatchObject([{ id, build: { status: 'built' } }]);
});

test('deleting a Draft deletes the screenshot the user added to it', async () => {
  const a = await signInTestUser('a');
  const id = await savedAndBuilt(a, { url: REEL, screenshot: screenshotBytes() });
  const link = (await a.data.getRecipe(id))?.sourceVideo?.screenshotUrl;
  expect(await bytesAt(link)).toBe(SCREENSHOT_BASE64);

  await a.data.deleteRecipe(id);

  expect(await a.data.getRecipe(id)).toBeNull();
  expect(await bytesAt(link)).toBeNull();
});

test('a YouTube video whose description is empty is “recipe not in description”, not “couldn’t read it”, without asking Claude', async () => {
  const claude = recording();
  const a = await signInTestUser('a', {
    ...claude.fakes,
    youtube: async (videoId, signal) => ({ ...(await fixtureAdapters.youtube(videoId, signal)), caption: null }),
  });

  const id = await savedAndBuilt(a, { url: 'https://www.youtube.com/shorts/LemonPasta1' });

  expect(claude.given).toEqual([]);
  expect(await a.data.getRecipe(id)).toMatchObject({
    title: 'Lemon pasta in 10 minutes #shorts',
    build: { status: 'built' },
    recipeFound: false,
    lines: [],
    steps: [],
    sourceVideo: { platform: 'youtube', creatorName: 'Lemon Kitchen' },
  });
});
