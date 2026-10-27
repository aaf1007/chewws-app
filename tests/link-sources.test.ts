// Ticket 04's sources, without the database: which links are YouTube, Instagram or other pages,
// what the YouTube adapter makes of the Data API's answer (through a fake fetch), and which links
// in a caption the source reader follows for a recipe site (fake adapters). No network.
import { describe, expect, test } from 'vitest';

import { checkSharedLink, detectSource, youtubeVideoId } from '../supabase/functions/_shared/detect-source';
import { fixtureAdapters, SHAKSHUKA_PAGE } from '../supabase/functions/_shared/draft-fixtures';
import { createSafeFetch } from '../supabase/functions/_shared/safe-fetch';
import {
  createSourceReader,
  SourceError,
  youtubeDataApiAdapter,
  type SourceAdapters,
} from '../supabase/functions/_shared/source-reader';

const signal = new AbortController().signal;

describe('detectSource and youtubeVideoId', () => {
  test.each([
    ['https://www.youtube.com/shorts/LemonPasta1', 'youtube', 'LemonPasta1'],
    ['https://youtube.com/shorts/LemonPasta1?feature=share', 'youtube', 'LemonPasta1'],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=42s', 'youtube', 'dQw4w9WgXcQ'],
    ['https://youtu.be/a-b_c1234XY?si=abc', 'youtube', 'a-b_c1234XY'],
    ['Watch this! https://youtu.be/a-b_c1234XY.', 'youtube', 'a-b_c1234XY'],
    // YouTube links that aren't a video.
    ['https://www.youtube.com/@LemonKitchen', 'youtube', null],
    ['https://www.youtube.com/shorts/short', 'youtube', null],
    ['https://www.youtube.com/watch?list=PL123', 'youtube', null],
    ['https://www.instagram.com/reel/C1a2b3c4d5e/', 'instagram', null],
    ['https://instagr.am/p/C1a2b3c4d5e/', 'instagram', null],
    // Hosts that only look like YouTube are other pages.
    ['https://notyoutube.com/shorts/LemonPasta1', 'web', null],
    ['https://youtube.com.example.org/shorts/LemonPasta1', 'web', null],
    ['https://cooking.example.com/recipes/crème-brûlée', 'web', null],
  ])('%s is a %s link (video id %s)', (shared, platform, id) => {
    expect(detectSource(shared)?.platform).toBe(platform);
    expect(youtubeVideoId(detectSource(shared)?.url ?? '')).toBe(id);
  });
});

describe('checkSharedLink', () => {
  test.each([
    ['https://www.youtube.com/shorts/LemonPasta1', { status: 'saveable' }],
    ['https://blog.example.org/my-kitchen-tour', { status: 'saveable' }],
    ['https://www.youtube.com/@LemonKitchen', { status: 'unsupported', message: 'That YouTube link isn’t a video.' }],
    ['https://www.instagram.com/reel/C1a2b3c4d5e/', { status: 'unsupported', message: 'Instagram links can’t be saved yet.' }],
    ['no link here', { status: 'noLink' }],
  ])('%s', (shared, expected) => {
    expect(checkSharedLink(shared)).toMatchObject(expected);
  });
});

/** The YouTube Data API as a fake fetch: one answer for every request. Records what was asked. */
function fakeYouTube(status: number, body: unknown) {
  const requested: string[] = [];
  const safeFetch = createSafeFetch({
    resolveHost: async () => ['142.250.80.10'],
    fetch: async (input) => {
      requested.push(String(input));
      return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=UTF-8' } });
    },
  });
  return { safeFetch, requested };
}

const snippet = {
  title: 'Lemon pasta in 10 minutes #shorts',
  description: 'Ingredients:\n- 200g linguine',
  channelId: 'UCLemonKitchen0000000000',
  channelTitle: 'Lemon Kitchen',
  thumbnails: {
    default: { url: 'https://i.ytimg.com/vi/LemonPasta1/default.jpg' },
    medium: { url: 'https://i.ytimg.com/vi/LemonPasta1/mqdefault.jpg' },
    high: { url: 'https://i.ytimg.com/vi/LemonPasta1/hqdefault.jpg' },
  },
};

describe('the YouTube adapter', () => {
  test('asks videos.list for the snippet and reads the description, channel and best thumbnail', async () => {
    const youtube = fakeYouTube(200, { items: [{ id: 'LemonPasta1', snippet }] });

    const video = await youtubeDataApiAdapter(youtube.safeFetch, 'test-key')('LemonPasta1', signal);

    expect(youtube.requested).toEqual([
      'https://www.googleapis.com/youtube/v3/videos?part=snippet&id=LemonPasta1&key=test-key',
    ]);
    expect(video).toEqual({
      externalId: 'LemonPasta1',
      title: 'Lemon pasta in 10 minutes #shorts',
      caption: 'Ingredients:\n- 200g linguine',
      creatorName: 'Lemon Kitchen',
      creatorUrl: 'https://www.youtube.com/channel/UCLemonKitchen0000000000',
      thumbnailUrl: 'https://i.ytimg.com/vi/LemonPasta1/hqdefault.jpg',
    });
  });

  test('prefers the maxres thumbnail when there is one', async () => {
    const maxres = { ...snippet, thumbnails: { ...snippet.thumbnails, maxres: { url: 'https://i.ytimg.com/vi/x/maxresdefault.jpg' } } };
    const youtube = fakeYouTube(200, { items: [{ snippet: maxres }] });

    const video = await youtubeDataApiAdapter(youtube.safeFetch, 'test-key')('LemonPasta1', signal);

    expect(video.thumbnailUrl).toBe('https://i.ytimg.com/vi/x/maxresdefault.jpg');
  });

  test.each([
    ['no item for the id', 200, { items: [] }, 'unavailable'],
    ['a key YouTube refuses', 400, { error: { errors: [{ reason: 'keyInvalid' }] } }, 'notSetUp'],
    ['an API the project hasn’t turned on', 403, { error: { errors: [{ reason: 'accessNotConfigured' }] } }, 'notSetUp'],
    ['a quota used up', 403, { error: { errors: [{ reason: 'quotaExceeded' }] } }, 'unreachable'],
    ['a server error', 503, {}, 'unreachable'],
  ])('%s is %s', async (_, status, body, reason) => {
    const youtube = fakeYouTube(status, body);

    await expect(youtubeDataApiAdapter(youtube.safeFetch, 'test-key')('LemonPasta1', signal)).rejects.toMatchObject({
      name: 'SourceError',
      reason,
    });
  });

  test('with no API key it is not set up, and asks YouTube nothing', async () => {
    const youtube = fakeYouTube(200, { items: [{ snippet }] });

    await expect(youtubeDataApiAdapter(youtube.safeFetch, '  ')('LemonPasta1', signal)).rejects.toMatchObject({
      reason: 'notSetUp',
    });
    expect(youtube.requested).toEqual([]);
  });
});

/** The fixtures' adapters, with a page adapter that records what it's asked and fails on `failing`. */
function recordingPages(failing: string[] = []) {
  const asked: string[] = [];
  const adapters: SourceAdapters = {
    ...fixtureAdapters,
    async page(url, s) {
      asked.push(url);
      if (failing.includes(url)) throw new SourceError('unreachable', 'No answer.');
      if (url === SHAKSHUKA_PAGE.url) return fixtureAdapters.page(url, s);
      return { url, title: 'Not a recipe', imageUrl: null, siteRecipe: null };
    },
  };
  return { adapters, asked };
}

describe('following a recipe-site link in a caption', () => {
  const captioned = (caption: string): SourceAdapters['tiktok'] => async () => ({
    externalId: '1',
    caption,
    creatorName: 'Chef',
    creatorUrl: null,
    thumbnailUrl: null,
  });

  test('skips platform and Meta links, tries at most 3 others in order, and skips one that fails', async () => {
    const pages = recordingPages(['https://first.example.com/']);
    const caption = [
      'More videos: https://www.tiktok.com/@chef https://youtu.be/a-b_c1234XY https://www.instagram.com/chef/',
      'https://www.facebook.com/chef https://first.example.com/ https://second.example.com/',
      `Recipe: ${SHAKSHUKA_PAGE.url}. Shop: https://fourth.example.com/`,
    ].join('\n');
    const reader = createSourceReader({ ...pages.adapters, tiktok: captioned(caption) });

    const material = await reader.read({ url: 'https://www.tiktok.com/@chef/video/1', text: null, screenshotPath: null }, signal);

    expect(pages.asked).toEqual(['https://first.example.com/', 'https://second.example.com/', SHAKSHUKA_PAGE.url]);
    expect(material).toMatchObject({
      kind: 'video',
      recipeSiteUrl: SHAKSHUKA_PAGE.url,
      siteRecipe: { name: "Rosa's Shakshuka", author: 'Rosa Martínez' },
    });
  });

  test('a recipe site past the third link is not tried; the video is read without one', async () => {
    const pages = recordingPages();
    const caption = `https://a.example.com/ https://b.example.com/ https://c.example.com/ ${SHAKSHUKA_PAGE.url}`;
    const reader = createSourceReader({ ...pages.adapters, tiktok: captioned(caption) });

    const material = await reader.read({ url: 'https://www.tiktok.com/@chef/video/1', text: null, screenshotPath: null }, signal);

    expect(pages.asked).toEqual(['https://a.example.com/', 'https://b.example.com/', 'https://c.example.com/']);
    expect(material).toMatchObject({ kind: 'video', caption, siteRecipe: null, recipeSiteUrl: null });
  });
});
