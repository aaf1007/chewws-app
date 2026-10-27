// The source reader (spec, Modules 2): takes what was shared and returns the raw material for a
// Draft, through one adapter per source. Runtime-neutral: no Deno, no URL imports, no Supabase.
// Adapters reach the network only through the guarded fetch (safe-fetch.ts); tests pass fakes with
// canned captions and pages (spec, Testing Decisions). Only official platform routes are used
// (ADR-0004): TikTok oEmbed, the YouTube Data API, and a recipe site's own page.

import { detectSource, isPlatformLink, linksIn, youtubeVideoId, type Platform } from './detect-source.ts';
import { pageAdapter, type PageInfo, type SiteRecipe } from './page-reader.ts';
import type { SafeFetch } from './safe-fetch.ts';
import { SourceError } from './source-error.ts';

export { SourceError, type SourceFailure } from './source-error.ts';
export type { PageInfo, SiteRecipe } from './page-reader.ts';

/** What the user shared: the link, and (tickets 04, 05) any text or screenshot with it. */
export type SharedLink = { url: string; text: string | null; screenshotPath: string | null };

export type SourceMaterial = {
  platform: Platform;
  /** `video`: a TikTok or YouTube video. `recipeSite`: a page with a schema.org Recipe. `page`: any other page. */
  kind: 'video' | 'recipeSite' | 'page';
  originalUrl: string;
  externalId: string | null;
  title: string | null;
  caption: string | null;
  creatorName: string | null;
  creatorUrl: string | null;
  thumbnailUrl: string | null;
  /** The recipe site's Recipe: the page shared, or the first recipe site a caption links to. */
  siteRecipe: SiteRecipe | null;
  recipeSiteUrl: string | null;
  pastedText: string | null;
  screenshotPath: string | null;
};

/** What a video platform says about one video. */
export type VideoInfo = {
  externalId: string | null;
  caption: string | null;
  creatorName: string | null;
  creatorUrl: string | null;
  thumbnailUrl: string | null;
  /** The video's own title, apart from its caption (YouTube has one; TikTok's title is the caption). */
  title?: string | null;
};

/** One adapter per source. Each throws `SourceError` when it can't read the source. */
export type SourceAdapters = {
  tiktok(url: string, signal: AbortSignal): Promise<VideoInfo>;
  /** Takes the video id (`youtubeVideoId`). */
  youtube(videoId: string, signal: AbortSignal): Promise<VideoInfo>;
  /** Reads a web page: its preview, and its schema.org Recipe if it has one. */
  page(url: string, signal: AbortSignal): Promise<PageInfo>;
};

export type SourceReader = {
  read(shared: SharedLink, signal: AbortSignal): Promise<SourceMaterial>;
};

/** Runs `attempt`, and once more if it couldn't reach the source (decisions 03: one retry). */
async function withOneRetry<T>(attempt: () => Promise<T>, signal: AbortSignal): Promise<T> {
  try {
    return await attempt();
  } catch (e) {
    if (!(e instanceof SourceError) || e.reason !== 'unreachable' || signal.aborted) throw e;
    return attempt();
  }
}

/** How many links in a caption are tried for a recipe site (decisions 04). */
const CAPTION_LINKS = 3;

export function createSourceReader(adapters: SourceAdapters): SourceReader {
  /**
   * The first recipe site among the first 3 links in a caption (and any text shared with it),
   * skipping the video platforms' and Meta's own links. A link that fails to load is skipped: the
   * video has been read, and the site is a bonus.
   */
  async function recipeSiteIn(texts: (string | null)[], signal: AbortSignal): Promise<PageInfo | null> {
    const links = [...new Set(linksIn(texts.filter(Boolean).join('\n')))].filter((link) => !isPlatformLink(link));
    for (const link of links.slice(0, CAPTION_LINKS)) {
      try {
        const page = await adapters.page(link, signal);
        if (page.siteRecipe) return page;
      } catch (e) {
        if (signal.aborted) throw e;
      }
    }
    return null;
  }

  async function readVideo(
    platform: 'tiktok' | 'youtube',
    url: string,
    video: VideoInfo,
    shared: SharedLink,
    signal: AbortSignal,
  ): Promise<SourceMaterial> {
    const site = await recipeSiteIn([video.caption, shared.text], signal);
    return {
      platform,
      kind: 'video',
      originalUrl: url,
      externalId: video.externalId,
      title: video.title ?? null,
      caption: video.caption,
      creatorName: video.creatorName,
      creatorUrl: video.creatorUrl,
      thumbnailUrl: video.thumbnailUrl,
      siteRecipe: site?.siteRecipe ?? null,
      recipeSiteUrl: site?.url ?? null,
      pastedText: shared.text,
      screenshotPath: shared.screenshotPath,
    };
  }

  return {
    async read(shared, signal) {
      const detected = detectSource(shared.url);
      if (detected === null) throw new SourceError('unavailable', `Not a link: ${shared.url}`);
      const { platform, url } = detected;
      if (platform === 'tiktok') {
        const video = await withOneRetry(() => adapters.tiktok(url, signal), signal);
        return readVideo(platform, url, video, shared, signal);
      }
      if (platform === 'youtube') {
        const id = youtubeVideoId(url);
        if (id === null) throw new SourceError('unavailable', `Not a YouTube video: ${url}`);
        const video = await withOneRetry(() => adapters.youtube(id, signal), signal);
        return readVideo(platform, url, video, shared, signal);
      }
      if (platform === 'instagram') {
        throw new SourceError('unavailable', 'Instagram links are read from a screenshot or caption (ticket 05).');
      }
      const page = await withOneRetry(() => adapters.page(url, signal), signal);
      const recipe = page.siteRecipe;
      return {
        platform: 'web',
        kind: recipe ? 'recipeSite' : 'page',
        originalUrl: url,
        externalId: null,
        title: (recipe?.name || page.title) ?? null,
        caption: null,
        creatorName: recipe?.author ?? null,
        creatorUrl: null,
        thumbnailUrl: recipe?.imageUrl ?? page.imageUrl,
        siteRecipe: recipe,
        recipeSiteUrl: recipe ? page.url : null,
        pastedText: shared.text,
        screenshotPath: shared.screenshotPath,
      };
    },
  };
}

/** A string field of an untrusted JSON object, or null. */
function stringField(json: unknown, key: string): string | null {
  if (typeof json !== 'object' || json === null || !(key in json)) return null;
  const value: unknown = Object.getOwnPropertyDescriptor(json, key)?.value;
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** tiktok.com or a host under it (www., vm., vt.…), never one that only starts like it. */
function isTikTokHost(host: string): boolean {
  const name = host.toLowerCase();
  return name === 'tiktok.com' || name.endsWith('.tiktok.com');
}

/**
 * The TikTok adapter: TikTok's oEmbed endpoint, with no auth (ADR-0004). `title` is the caption.
 * A short link (vm./vt.tiktok.com) is passed as shared; if oEmbed refuses it (400), the adapter
 * follows its redirects, reading statuses only, never a page, and asks once more with the full
 * URL. It follows only https redirects to TikTok's hosts; any other makes the link unreadable.
 * That redirect check is unit-tested with a fake fetch; the real oEmbed call is checked by hand.
 */
export function tiktokOEmbedAdapter(safeFetch: SafeFetch): SourceAdapters['tiktok'] {
  const oEmbed = (url: string, signal: AbortSignal) =>
    safeFetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, {
      signal,
      accept: ['application/json'],
      headers: { Accept: 'application/json' },
    });

  async function fullUrlOf(shortUrl: string, signal: AbortSignal): Promise<string | null> {
    let url = shortUrl;
    for (let hop = 0; hop < 5; hop++) {
      const response = await safeFetch(url, { method: 'HEAD', redirect: 'manual', onlyHosts: isTikTokHost, signal });
      const next = response.headers.get('location');
      if (response.status < 300 || response.status >= 400 || next === null) return null;
      const target = new URL(next, url);
      // Only TikTok's own hosts: a short link must not walk the server to any other address.
      if (target.protocol !== 'https:' || !isTikTokHost(target.hostname)) {
        throw new SourceError('unreadable', `The TikTok link redirects off TikTok, to ${target.host}.`);
      }
      url = target.href;
      if (/\/video\/\d+/u.test(target.pathname)) return url;
    }
    return null;
  }

  return async (url, signal) => {
    let response = await oEmbed(url, signal);
    let readUrl = url;
    if (response.status === 400) {
      const full = await fullUrlOf(url, signal);
      if (full !== null) {
        readUrl = full;
        response = await oEmbed(full, signal);
      }
    }
    // Refused (403), rate-limited (429) or down (5xx) says nothing about the video: it may be
    // there, so it isn't "unavailable" (which drops what a refresh had stored about it).
    if (response.status >= 500 || response.status === 403 || response.status === 429) {
      throw new SourceError('unreachable', `TikTok answered ${response.status}.`);
    }
    if (response.status >= 300) throw new SourceError('unavailable', `TikTok has no video at ${url} (${response.status}).`);
    const json = parseJson(response.body, 'TikTok');
    return {
      externalId: stringField(json, 'embed_product_id') ?? /\/video\/(\d+)/u.exec(readUrl)?.[1] ?? null,
      caption: stringField(json, 'title'),
      creatorName: stringField(json, 'author_name'),
      creatorUrl: stringField(json, 'author_url'),
      thumbnailUrl: stringField(json, 'thumbnail_url'),
    };
  };
}

function parseJson(body: string | null, from: string): unknown {
  try {
    return JSON.parse(body ?? '');
  } catch (e) {
    throw new SourceError('unreachable', `${from} sent something other than JSON.`, { cause: e });
  }
}

/** The best of a YouTube snippet's thumbnails: maxres, then high, then medium. */
function bestThumbnail(snippet: unknown): string | null {
  const thumbnails: unknown = snippet !== null && typeof snippet === 'object' ? Reflect.get(snippet, 'thumbnails') : null;
  for (const size of ['maxres', 'high', 'medium']) {
    const thumbnail: unknown = thumbnails !== null && typeof thumbnails === 'object' ? Reflect.get(thumbnails, size) : null;
    const url = stringField(thumbnail, 'url');
    if (url) return url;
  }
  return null;
}

/**
 * The YouTube adapter: the Data API v3, `videos.list` with `part=snippet` (ADR-0004), with the
 * server's API key. The description is the caption; `channelTitle` the creator. No key, or one
 * YouTube refuses, fails as not set up; no item for the id, as unavailable.
 */
export function youtubeDataApiAdapter(safeFetch: SafeFetch, apiKey: string): SourceAdapters['youtube'] {
  return async (videoId, signal) => {
    if (apiKey.trim() === '') throw new SourceError('notSetUp', 'YOUTUBE_API_KEY is not set.');
    const query = new URLSearchParams({ part: 'snippet', id: videoId });
    // In a header, not the query string, so the key stays out of any log of URLs.
    const response = await safeFetch(`https://www.googleapis.com/youtube/v3/videos?${query}`, {
      signal,
      accept: ['application/json'],
      headers: { Accept: 'application/json', 'X-Goog-Api-Key': apiKey.trim() },
    });
    if (response.status >= 500) throw new SourceError('unreachable', `YouTube answered ${response.status}.`);
    if (response.status === 403 && /quotaExceeded|rateLimitExceeded/u.test(response.body ?? '')) {
      throw new SourceError('unreachable', 'The YouTube API quota is used up for now.');
    }
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      throw new SourceError('notSetUp', `YouTube refused the API key (${response.status}).`);
    }
    if (response.status >= 300) throw new SourceError('unavailable', `YouTube answered ${response.status}.`);
    const json = parseJson(response.body, 'YouTube');
    const items: unknown = json !== null && typeof json === 'object' ? Reflect.get(json, 'items') : null;
    const item: unknown = Array.isArray(items) ? items[0] : undefined;
    const snippet: unknown = item !== null && typeof item === 'object' ? Reflect.get(item, 'snippet') : undefined;
    if (snippet === undefined || snippet === null) {
      throw new SourceError('unavailable', `YouTube has no video ${videoId}.`);
    }
    const channelId = stringField(snippet, 'channelId');
    return {
      externalId: videoId,
      title: stringField(snippet, 'title'),
      caption: stringField(snippet, 'description'),
      creatorName: stringField(snippet, 'channelTitle'),
      creatorUrl: channelId ? `https://www.youtube.com/channel/${encodeURIComponent(channelId)}` : null,
      thumbnailUrl: bestThumbnail(snippet),
    };
  };
}

/** The real adapters, every one reading through the same guarded fetch. */
export function realSourceAdapters(safeFetch: SafeFetch, youtubeApiKey: string): SourceAdapters {
  return {
    tiktok: tiktokOEmbedAdapter(safeFetch),
    youtube: youtubeDataApiAdapter(safeFetch, youtubeApiKey),
    page: pageAdapter(safeFetch),
  };
}
