// Reads a saved Source Video from its platform again (decisions 04): when its thumbnail URL stops
// loading (TikTok's expire), and when YouTube data is over 30 days old (YouTube's API terms).
// Thumbnails stay platform URLs, never copied (ADR-0004). Runtime-neutral: the
// refresh-source-video function wires the real adapters; tests wire fakes.

import { youtubeVideoId } from './detect-source.ts';
import type { Rpc } from './draft-builder.ts';
import { SourceError, type SourceAdapters, type VideoInfo } from './source-reader.ts';

export type SourceRefreshDeps = {
  /**
   * `claim_source_refresh`, called as the user who asked: it refuses someone else's Recipe, a
   * page that isn't a video, and a second refresh within 10 minutes, and returns null for those.
   */
  claim: (recipeId: string) => Promise<unknown>;
  /** The service role's `rpc`, for `store_source_refresh`. */
  rpc: Rpc;
  adapters: Pick<SourceAdapters, 'tiktok' | 'youtube'>;
  signal: AbortSignal;
};

/**
 * `refreshed`: stored what the platform says now. `gone`: the platform no longer has the video,
 * so what was stored about it is dropped. `notClaimed`: not this user's, not a video, or refreshed
 * within the last 10 minutes. `failed`: the platform couldn't be read; nothing changed.
 */
export type RefreshOutcome = 'refreshed' | 'gone' | 'notClaimed' | 'failed';

const EMPTY: VideoInfo = { externalId: null, caption: null, creatorName: null, creatorUrl: null, thumbnailUrl: null };

function toClaimed(claimed: unknown): { platform: 'tiktok' | 'youtube'; url: string } | null {
  if (typeof claimed !== 'object' || claimed === null) return null;
  const platform: unknown = Reflect.get(claimed, 'platform');
  const url: unknown = Reflect.get(claimed, 'url');
  if (typeof url !== 'string' || (platform !== 'tiktok' && platform !== 'youtube')) return null;
  return { platform, url };
}

export async function refreshSourceVideo(recipeId: string, deps: SourceRefreshDeps): Promise<RefreshOutcome> {
  const claimed = toClaimed(await deps.claim(recipeId));
  if (claimed === null) return 'notClaimed';

  let video: VideoInfo;
  let outcome: RefreshOutcome = 'refreshed';
  try {
    if (claimed.platform === 'tiktok') {
      video = await deps.adapters.tiktok(claimed.url, deps.signal);
    } else {
      const id = youtubeVideoId(claimed.url);
      if (id === null) throw new SourceError('unavailable', `Not a YouTube video: ${claimed.url}`);
      video = await deps.adapters.youtube(id, deps.signal);
    }
  } catch (error) {
    if (!(error instanceof SourceError) || error.reason !== 'unavailable') return 'failed';
    video = EMPTY;
    outcome = 'gone';
  }
  await deps.rpc('store_source_refresh', {
    recipe_id: recipeId,
    source: {
      creator_name: video.creatorName,
      creator_url: video.creatorUrl,
      caption: video.caption,
      title: video.title ?? null,
      thumbnail_url: video.thumbnailUrl,
    },
  });
  return outcome;
}
