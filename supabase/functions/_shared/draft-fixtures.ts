// Canned TikTok and YouTube videos, web pages and Claude answers, so Drafts build with no network:
// the data-layer tests use them in-process, and the Maestro flows through the build-draft and
// refresh-source-video functions when they run with DRAFT_FIXTURES=1 (scripts/functions.sh e2e;
// see docs/agents/verify.md). The fake adapters answer only for these videos and pages (pages go
// through the real HTML readers); the fake Claude call answers only for these captions and site
// Recipes.

import { ExtractError, type Extract, type Extraction } from './claude-extractor.ts';
import { readPage } from './page-reader.ts';
import { SourceError, type SourceAdapters, type VideoInfo } from './source-reader.ts';

/** A small striped picture, inline, so a Source Video's thumbnail loads with no network. */
const THUMBNAIL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFoAAAB4CAIAAAD9rnJoAAAAuklEQVR42u3QIREAIBAAMHIRhRwIMqFJhCMABoX7Cm92twQrp1dCUaBDhw4dOnTo0KFDhw4dOnTo0KFDhw506NChQ4cOHTp0JHXc1Qg6dOjQoUOHDh06dOjQoUOHDh06dOjQgQ4dOnTo0KFDh46sjrcXQYcOHTp06NChQ4cOHTp06NChQ4cOHTrQoUOHDh06dOjQkdUxZiPo0KFDhw4dOnTo0KFDhw4dOnTo0KFDBzp06NChQ4cOHTqSfBqVr3l16IFuAAAAAElFTkSuQmCC';

type Fixture = {
  url: string;
  video: VideoInfo;
  extraction: Extraction;
  /** What the platform says when it's asked again later (a thumbnail URL that has changed). */
  later?: VideoInfo;
  /** The caption only links to the recipe: Claude finds it only with the site's Recipe. */
  recipeOnSite?: boolean;
};

/** A caption with the whole recipe in it. */
export const FULL_RECIPE: Fixture = {
  url: 'https://www.tiktok.com/@pastaqueen/video/7400000000000000001',
  video: {
    externalId: '7400000000000000001',
    caption:
      'Creamy garlic pasta in 15 minutes 🍝 You need: 200g spaghetti, 4 cloves garlic (minced), 2 tbsp butter, 1 cup cherry tomatoes halved, ½ cup heavy cream, ¼ cup grated parmesan, salt. Boil the pasta. Melt the butter and fry the garlic for a minute. Add the tomatoes, then the cream and parmesan, and toss with the pasta. #pasta #dinner',
    creatorName: 'Pasta Queen',
    creatorUrl: 'https://www.tiktok.com/@pastaqueen',
    thumbnailUrl: THUMBNAIL,
  },
  extraction: {
    title: 'Creamy garlic pasta',
    recipeFound: true,
    lines: [
      { text: '200g spaghetti', amount: '200g', ingredient: 'spaghetti' },
      { text: '4 cloves garlic (minced)', amount: '4 cloves', ingredient: 'garlic' },
      { text: '2 tbsp butter', amount: '2 tbsp', ingredient: 'butter' },
      { text: '1 cup cherry tomatoes halved', amount: '1 cup', ingredient: 'Cherry Tomatoes' },
      { text: '½ cup heavy cream', amount: '½ cup', ingredient: 'heavy cream' },
      { text: '¼ cup grated parmesan', amount: '¼ cup', ingredient: 'parmesan' },
      { text: 'salt', amount: null, ingredient: 'salt' },
      // Claude can return a line with no food in it; the builder drops it.
      { text: '🍝', amount: null, ingredient: '🍝' },
    ],
    steps: [
      'Boil the pasta.',
      'Melt the butter and fry the garlic for a minute.',
      'Add the tomatoes, then the cream and parmesan, and toss with the pasta.',
    ],
  },
};

/** "Link in bio": no recipe in the caption. Claude still returns a line, which isn't kept. */
export const LINK_IN_BIO: Fixture = {
  url: 'https://www.tiktok.com/@snackdad/video/7400000000000000002',
  video: {
    externalId: '7400000000000000002',
    caption: "The crispiest smash burgers you'll ever make 🍔 Full recipe at the link in bio!",
    creatorName: 'Snack Dad',
    creatorUrl: 'https://www.tiktok.com/@snackdad',
    thumbnailUrl: THUMBNAIL,
  },
  extraction: {
    title: 'Crispy smash burgers',
    recipeFound: false,
    lines: [{ text: 'beef', amount: null, ingredient: 'beef' }],
    steps: ['Smash the burgers.'],
  },
};

/** A caption Claude can't read a recipe from (its fake answers in the wrong shape). */
export const UNREADABLE: Fixture = {
  url: 'https://www.tiktok.com/@glitch/video/7400000000000000003',
  video: {
    externalId: '7400000000000000003',
    caption: '▓▓▓',
    creatorName: 'Glitch',
    creatorUrl: 'https://www.tiktok.com/@glitch',
    thumbnailUrl: THUMBNAIL,
  },
  extraction: { title: '', recipeFound: false, lines: [], steps: [] },
};

const SHAKSHUKA: Extraction = {
  title: 'Shakshuka',
  recipeFound: true,
  lines: [
    { text: '2 tbsp olive oil', amount: '2 tbsp', ingredient: 'olive oil' },
    { text: '1 onion, diced', amount: '1', ingredient: 'onion' },
    { text: '2 cloves garlic, sliced', amount: '2 cloves', ingredient: 'garlic' },
    { text: '1 tsp ground cumin', amount: '1 tsp', ingredient: 'ground cumin' },
    { text: '1 can (400g) crushed tomatoes', amount: '1 can (400g)', ingredient: 'crushed tomatoes' },
    { text: '4 eggs', amount: '4', ingredient: 'eggs' },
    { text: "a handful of Rosa's feta", amount: 'a handful', ingredient: 'feta' },
  ],
  steps: [
    'Soften the onion and garlic in the oil.',
    'Add the cumin and tomatoes and simmer for 10 minutes.',
    'Make four wells, crack in the eggs, cover and cook until set.',
    'Crumble over the feta.',
  ],
};

/** A canned web page; `extraction` is Claude's canned answer for its Recipe. */
type PageFixture = { url: string; html: string; extraction?: Extraction };

/** A recipe site's page: a schema.org Recipe in an `@graph`, with its method in sections. */
export const SHAKSHUKA_PAGE: PageFixture = {
  url: 'https://cooking.example.com/recipes/shakshuka',
  html: `<!doctype html>
<html><head>
<title>Rosa&#39;s Shakshuka | Cooking Example</title>
<meta property="og:title" content="Rosa&#39;s Shakshuka">
<meta property="og:image" content="${THUMBNAIL}">
<script type="application/ld+json">
{"@context": "https://schema.org", "@graph": [
  {"@type": "WebPage", "@id": "https://cooking.example.com/recipes/shakshuka", "name": "Rosa's Shakshuka"},
  {"@type": ["Recipe", "NewsArticle"], "name": "Rosa&#39;s Shakshuka",
   "author": {"@type": "Person", "name": "Rosa Martínez"},
   "image": ["${THUMBNAIL}"],
   "recipeIngredient": ["2 tbsp olive oil", "1 onion, diced", "2 cloves garlic, sliced", "1 tsp ground cumin",
     "1 can (400g) crushed tomatoes", "4 eggs", "a handful of Rosa&#39;s feta"],
   "recipeInstructions": [
     {"@type": "HowToSection", "name": "The sauce", "itemListElement": [
       {"@type": "HowToStep", "text": "Soften the onion and garlic in the oil."},
       {"@type": "HowToStep", "text": "Add the cumin and tomatoes and simmer for 10 minutes."}]},
     {"@type": "HowToSection", "name": "The eggs", "itemListElement": [
       {"@type": "HowToStep", "text": "Make four wells, crack in the eggs, cover &amp; cook until set."},
       {"@type": "HowToStep", "text": "Crumble over the feta."}]}]}
]}
</script>
</head><body><h1>Rosa's Shakshuka</h1></body></html>`,
  extraction: SHAKSHUKA,
};

/** Any other page: no recipe on it, just a title and a picture. */
export const PLAIN_PAGE: PageFixture = {
  url: 'https://blog.example.org/my-kitchen-tour',
  html: `<!doctype html>
<html><head>
<meta charset="utf-8">
<title>Blog – Example</title>
<meta content="My kitchen tour &amp; favourite tools" property="og:title">
<meta property='og:image' content='${THUMBNAIL}'>
</head><body><p>Come see my kitchen.</p></body></html>`,
};

const PAGES = [SHAKSHUKA_PAGE, PLAIN_PAGE];

/** A TikTok whose caption links to a recipe site (and to Instagram, which isn't followed). */
export const SITE_LINK: Fixture = {
  url: 'https://www.tiktok.com/@brunchclub/video/7400000000000000004',
  video: {
    externalId: '7400000000000000004',
    caption:
      'Sunday shakshuka 🍳 Follow me on https://www.instagram.com/brunchclub/ and get the full recipe on my blog → https://cooking.example.com/recipes/shakshuka #brunch',
    creatorName: 'Brunch Club',
    creatorUrl: 'https://www.tiktok.com/@brunchclub',
    thumbnailUrl: THUMBNAIL,
  },
  extraction: SHAKSHUKA,
  recipeOnSite: true,
};

/** A YouTube Short with the whole recipe in its description. */
export const YOUTUBE_SHORT: Fixture = {
  url: 'https://www.youtube.com/shorts/LemonPasta1',
  video: {
    externalId: 'LemonPasta1',
    title: 'Lemon pasta in 10 minutes #shorts',
    caption:
      'The easiest lemon pasta 🍋\n\nIngredients:\n- 200g linguine\n- 1 lemon (zest and juice)\n- 2 tbsp olive oil\n- 30g parmesan, grated\n- black pepper\n\nCook the linguine. Toss it with the lemon, oil and parmesan. Season with pepper.\n\n#shorts #pasta',
    creatorName: 'Lemon Kitchen',
    creatorUrl: 'https://www.youtube.com/channel/UCLemonKitchen0000000000',
    thumbnailUrl: THUMBNAIL,
  },
  extraction: {
    title: 'Lemon pasta',
    recipeFound: true,
    lines: [
      { text: '200g linguine', amount: '200g', ingredient: 'linguine' },
      { text: '1 lemon (zest and juice)', amount: '1', ingredient: 'lemon' },
      { text: '2 tbsp olive oil', amount: '2 tbsp', ingredient: 'olive oil' },
      { text: '30g parmesan, grated', amount: '30g', ingredient: 'parmesan' },
      { text: 'black pepper', amount: null, ingredient: 'black pepper' },
    ],
    steps: ['Cook the linguine.', 'Toss it with the lemon, oil and parmesan.', 'Season with pepper.'],
  },
};

/**
 * A YouTube video whose stored thumbnail URL no longer loads (`.invalid` never resolves); asked
 * again, YouTube gives a new one.
 */
export const EXPIRED_THUMBNAIL: Fixture = {
  url: 'https://youtu.be/OldThumbnl1',
  video: {
    externalId: 'OldThumbnl1',
    title: 'Garlic butter rice',
    caption: 'Garlic butter rice: 1 cup rice, 2 tbsp butter, 3 cloves garlic. Cook the rice, then stir in the garlic butter.',
    creatorName: 'Rice Guy',
    creatorUrl: 'https://www.youtube.com/channel/UCRiceGuy00000000000000',
    thumbnailUrl: 'https://thumbnails.invalid/vi/OldThumbnl1/expired.jpg',
  },
  later: {
    externalId: 'OldThumbnl1',
    title: 'Garlic butter rice',
    caption: 'Garlic butter rice: 1 cup rice, 2 tbsp butter, 3 cloves garlic. Cook the rice, then stir in the garlic butter.',
    creatorName: 'Rice Guy',
    creatorUrl: 'https://www.youtube.com/channel/UCRiceGuy00000000000000',
    thumbnailUrl: THUMBNAIL,
  },
  extraction: {
    title: 'Garlic butter rice',
    recipeFound: true,
    lines: [
      { text: '1 cup rice', amount: '1 cup', ingredient: 'rice' },
      { text: '2 tbsp butter', amount: '2 tbsp', ingredient: 'butter' },
      { text: '3 cloves garlic', amount: '3 cloves', ingredient: 'garlic' },
    ],
    steps: ['Cook the rice, then stir in the garlic butter.'],
  },
};

/**
 * A TikTok whose oEmbed answers as TikTok's has since October 2026: no caption, creator or
 * thumbnail. The app can't read it; the user pastes the caption or adds a screenshot.
 */
export const NO_CAPTION: Fixture = {
  url: 'https://www.tiktok.com/@quietcook/video/7400000000000000005',
  video: { externalId: '7400000000000000005', caption: null, creatorName: null, creatorUrl: null, thumbnailUrl: null },
  extraction: { title: '', recipeFound: false, lines: [], steps: [] },
};

const FIXTURES = [FULL_RECIPE, LINK_IN_BIO, UNREADABLE, SITE_LINK, YOUTUBE_SHORT, EXPIRED_THUMBNAIL, NO_CAPTION];

/** A caption the user pastes (an Instagram Reel's, or one TikTok didn't give), with Claude's answer. */
export const PASTED_CAPTION = {
  text: `Sticky honey garlic chicken 🍯🧄 Save this one!
Ingredients:
- 4 chicken thighs
- 3 tbsp honey
- 3 cloves garlic, minced
- 2 tbsp soy sauce
- 1 tbsp butter
Sear the chicken skin-side down until crisp. Add the butter, garlic, honey and soy sauce and simmer until sticky.`,
  extraction: {
    title: 'Honey garlic chicken',
    recipeFound: true,
    lines: [
      { text: '4 chicken thighs', amount: '4', ingredient: 'chicken thighs' },
      { text: '3 tbsp honey', amount: '3 tbsp', ingredient: 'honey' },
      { text: '3 cloves garlic, minced', amount: '3 cloves', ingredient: 'garlic' },
      { text: '2 tbsp soy sauce', amount: '2 tbsp', ingredient: 'soy sauce' },
      { text: '1 tbsp butter', amount: '1 tbsp', ingredient: 'butter' },
    ],
    steps: [
      'Sear the chicken skin-side down until crisp.',
      'Add the butter, garlic, honey and soy sauce and simmer until sticky.',
    ],
  } satisfies Extraction,
};

/** A caption short and plain enough for a Maestro flow to type, with Claude's answer. */
export const TYPED_CAPTION = {
  text: 'Garlic noodles: 200g noodles, 4 cloves garlic, 2 tbsp butter, 1 tbsp soy sauce. Fry the garlic in the butter, then toss in the noodles and soy sauce.',
  extraction: {
    title: 'Garlic noodles',
    recipeFound: true,
    lines: [
      { text: '200g noodles', amount: '200g', ingredient: 'noodles' },
      { text: '4 cloves garlic', amount: '4 cloves', ingredient: 'garlic' },
      { text: '2 tbsp butter', amount: '2 tbsp', ingredient: 'butter' },
      { text: '1 tbsp soy sauce', amount: '1 tbsp', ingredient: 'soy sauce' },
    ],
    steps: ['Fry the garlic in the butter.', 'Toss in the noodles and soy sauce.'],
  } satisfies Extraction,
};

const PASTED_CAPTIONS = [PASTED_CAPTION, TYPED_CAPTION];

/** Claude's answer for any screenshot the user adds (with no caption pasted beside it). */
export const SCREENSHOT_RECIPE: Extraction = {
  title: 'Miso-glazed salmon',
  recipeFound: true,
  lines: [
    { text: '2 salmon fillets', amount: '2', ingredient: 'salmon fillets' },
    { text: '2 tbsp white miso', amount: '2 tbsp', ingredient: 'white miso' },
    { text: '1 tbsp maple syrup', amount: '1 tbsp', ingredient: 'maple syrup' },
    { text: '1 tsp sesame seeds', amount: '1 tsp', ingredient: 'sesame seeds' },
  ],
  steps: ['Brush the salmon with the miso and maple syrup.', 'Grill for 8 minutes and scatter over the sesame seeds.'],
};

/** A recipe site that turns the server away, as big ones do with 402: the app can't read it. */
export const REFUSED_PAGE = { url: 'https://paywall.example.com/recipes/tonkotsu-ramen', status: 402 };

const youtubeFixture = (videoId: string) =>
  FIXTURES.find((f) => f.video.externalId === videoId && !/tiktok\.com/u.test(f.url));

/**
 * The platforms and pages as the fixtures have them: any other video or page is unavailable, as a
 * deleted one is. `later`: as they answer when asked again (the refresh-source-video function).
 */
function adapters(later: boolean): SourceAdapters {
  const video = (fixture: Fixture) => (later ? (fixture.later ?? fixture.video) : fixture.video);
  return {
    async tiktok(url) {
      const fixture = FIXTURES.find((f) => f.url === url);
      if (!fixture) throw new SourceError('unavailable', `No fixture for ${url}.`);
      return video(fixture);
    },
    async youtube(videoId) {
      const fixture = youtubeFixture(videoId);
      if (!fixture) throw new SourceError('unavailable', `No fixture for YouTube video ${videoId}.`);
      return video(fixture);
    },
    async page(url) {
      // What the real page adapter makes of a 4xx (page-reader.ts).
      if (url === REFUSED_PAGE.url) throw new SourceError('refused', `${url} answered ${REFUSED_PAGE.status}.`);
      const page = PAGES.find((p) => p.url === url);
      if (!page) throw new SourceError('unavailable', `No fixture for ${url}.`);
      return { url, ...readPage(page.html, url) };
    },
  };
}

export const fixtureAdapters: SourceAdapters = adapters(false);

export const laterFixtureAdapters: SourceAdapters = adapters(true);

const NOT_FOUND = (fixture: Fixture): Extraction => ({ title: fixture.extraction.title, recipeFound: false, lines: [], steps: [] });

const squashed = (text: string) => text.replace(/\s+/gu, '');

/**
 * Claude as the fixtures have it: the canned answer for each canned caption (or the same caption
 * pasted by the user), for a recipe site's Recipe shared directly or linked from a pasted caption,
 * and for any screenshot. A caption that only links to its recipe gives it only when the site's
 * Recipe came with it, as Claude would.
 */
export const fixtureExtract: Extract = async (material) => {
  if (material.caption === null && material.siteRecipe) {
    const page = PAGES.find((p) => p.url === material.recipeSiteUrl);
    if (page?.extraction) return page.extraction;
  }
  const pasted = material.pastedText?.trim() || null;
  // Line breaks don't change what a caption says (and a flow's deep link loses them).
  const pastedFixture = PASTED_CAPTIONS.find((p) => pasted !== null && squashed(p.text) === squashed(pasted));
  // What the user pasted is what has the recipe, whatever the platform's caption says.
  if (pastedFixture) return pastedFixture.extraction;
  if (material.caption === null && pasted === null && material.screenshot) return SCREENSHOT_RECIPE;
  const read = material.caption ?? pasted;
  const fixture = read === null ? undefined : FIXTURES.find((f) => f.video.caption === read);
  if (!fixture || fixture === UNREADABLE) throw new ExtractError('unreadable', 'No canned answer for this caption.');
  if (fixture.recipeOnSite && material.siteRecipe === null) return NOT_FOUND(fixture);
  return fixture.extraction;
};
