// Canned TikTok videos and Claude answers, so Drafts build with no network: the data-layer tests
// use them in-process, and the Maestro flows through the build-draft function when it runs with
// DRAFT_FIXTURES=1 (scripts/functions.sh e2e; see docs/agents/verify.md). The fake adapter answers
// only for these videos; the fake Claude call answers only for these captions.

import { ExtractError, type Extract, type Extraction } from './claude-extractor.ts';
import { SourceError, type SourceAdapters, type VideoInfo } from './source-reader.ts';

/** A small striped picture, inline, so a Source Video's thumbnail loads with no network. */
const THUMBNAIL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFoAAAB4CAIAAAD9rnJoAAAAuklEQVR42u3QIREAIBAAMHIRhRwIMqFJhCMABoX7Cm92twQrp1dCUaBDhw4dOnTo0KFDhw4dOnTo0KFDhw506NChQ4cOHTp0JHXc1Qg6dOjQoUOHDh06dOjQoUOHDh06dOjQgQ4dOnTo0KFDh46sjrcXQYcOHTp06NChQ4cOHTp06NChQ4cOHTrQoUOHDh06dOjQkdUxZiPo0KFDhw4dOnTo0KFDhw4dOnTo0KFDBzp06NChQ4cOHTqSfBqVr3l16IFuAAAAAElFTkSuQmCC';

type Fixture = { url: string; video: VideoInfo; extraction: Extraction };

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

const FIXTURES = [FULL_RECIPE, LINK_IN_BIO, UNREADABLE];

/** TikTok as the fixtures have it: any other video is unavailable, as a deleted one is. */
export const fixtureAdapters: SourceAdapters = {
  async tiktok(url) {
    const fixture = FIXTURES.find((f) => f.url === url);
    if (!fixture) throw new SourceError('unavailable', `No fixture for ${url}.`);
    return fixture.video;
  },
};

/** Claude as the fixtures have it: the canned answer for each canned caption. */
export const fixtureExtract: Extract = async (material) => {
  const fixture = FIXTURES.find((f) => f.video.caption === material.caption);
  if (!fixture || fixture === UNREADABLE) throw new ExtractError('unreadable', 'No canned answer for this caption.');
  return fixture.extraction;
};
