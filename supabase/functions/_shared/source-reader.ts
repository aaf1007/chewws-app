// The source reader (spec, Modules 2): takes what was shared and returns the raw material for a
// Draft, through one adapter per platform. Runtime-neutral: no Deno, no URL imports, no Supabase.
// Adapters reach the network; tests pass fakes with canned captions (spec, Testing Decisions).
// Only official platform routes are used (ADR-0004).

import { detectSource, type Platform } from './detect-source.ts';

/** What the user shared: the link, and (tickets 04, 05) any text or screenshot with it. */
export type SharedLink = { url: string; text: string | null; screenshotPath: string | null };

/** What a schema.org Recipe on a recipe site says (ticket 04). */
export type SiteRecipe = {
  name: string;
  ingredients: string[];
  steps: string[];
  imageUrl: string | null;
  author: string | null;
};

export type SourceMaterial = {
  platform: Platform;
  kind: 'video' | 'recipeSite' | 'page';
  originalUrl: string;
  externalId: string | null;
  title: string | null;
  caption: string | null;
  creatorName: string | null;
  creatorUrl: string | null;
  thumbnailUrl: string | null;
  siteRecipe: SiteRecipe | null;
  recipeSiteUrl: string | null;
  pastedText: string | null;
  screenshotPath: string | null;
};

/**
 * Why a source couldn't be read. `unavailable`: the platform answered that it has no such video
 * (private, deleted, not a video). `unreachable`: no usable answer (network error, 5xx).
 */
export class SourceError extends Error {
  readonly reason: 'unavailable' | 'unreachable';

  constructor(reason: 'unavailable' | 'unreachable', message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SourceError';
    this.reason = reason;
  }
}

/** What a video platform says about one video. */
export type VideoInfo = {
  externalId: string | null;
  caption: string | null;
  creatorName: string | null;
  creatorUrl: string | null;
  thumbnailUrl: string | null;
};

/** One adapter per platform. Each throws `SourceError` when it can't read the source. */
export type SourceAdapters = {
  tiktok(url: string, signal: AbortSignal): Promise<VideoInfo>;
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

export function createSourceReader(adapters: SourceAdapters): SourceReader {
  return {
    async read(shared, signal) {
      const detected = detectSource(shared.url);
      if (detected === null) throw new SourceError('unavailable', `Not a link: ${shared.url}`);
      if (detected.platform !== 'tiktok') {
        throw new SourceError('unavailable', `No reader for ${detected.platform} links yet.`);
      }
      const video = await withOneRetry(() => adapters.tiktok(detected.url, signal), signal);
      return {
        platform: 'tiktok',
        kind: 'video',
        originalUrl: detected.url,
        externalId: video.externalId,
        title: null,
        caption: video.caption,
        creatorName: video.creatorName,
        creatorUrl: video.creatorUrl,
        thumbnailUrl: video.thumbnailUrl,
        siteRecipe: null,
        recipeSiteUrl: null,
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

/**
 * The TikTok adapter: TikTok's oEmbed endpoint, with no auth (ADR-0004). `title` is the caption.
 * A short link (vm./vt.tiktok.com) is passed as shared; if oEmbed refuses it (400), the adapter
 * follows its redirects, reading statuses only, never a page, and asks once more with the full URL.
 * Not unit-tested (spec): checked by hand against real links.
 */
export function tiktokOEmbedAdapter(fetchFn: typeof fetch): SourceAdapters['tiktok'] {
  async function oEmbed(url: string, signal: AbortSignal): Promise<Response> {
    try {
      return await fetchFn(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, {
        signal,
        headers: { Accept: 'application/json' },
      });
    } catch (e) {
      throw new SourceError('unreachable', "Couldn't reach TikTok.", { cause: e });
    }
  }

  async function fullUrlOf(shortUrl: string, signal: AbortSignal): Promise<string | null> {
    let url = shortUrl;
    for (let hop = 0; hop < 5; hop++) {
      let response: Response;
      try {
        response = await fetchFn(url, { method: 'HEAD', redirect: 'manual', signal });
      } catch (e) {
        throw new SourceError('unreachable', "Couldn't reach TikTok.", { cause: e });
      }
      const next = response.headers.get('location');
      if (response.status < 300 || response.status >= 400 || next === null) return null;
      url = new URL(next, url).href;
      if (/\/video\/\d+/u.test(new URL(url).pathname)) return url;
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
    if (response.status >= 500) throw new SourceError('unreachable', `TikTok answered ${response.status}.`);
    if (!response.ok) throw new SourceError('unavailable', `TikTok has no video at ${url} (${response.status}).`);
    let json: unknown;
    try {
      json = await response.json();
    } catch (e) {
      throw new SourceError('unreachable', 'TikTok sent something other than JSON.', { cause: e });
    }
    return {
      externalId: stringField(json, 'embed_product_id') ?? /\/video\/(\d+)/u.exec(readUrl)?.[1] ?? null,
      caption: stringField(json, 'title'),
      creatorName: stringField(json, 'author_name'),
      creatorUrl: stringField(json, 'author_url'),
      thumbnailUrl: stringField(json, 'thumbnail_url'),
    };
  };
}
