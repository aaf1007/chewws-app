// Which platform a shared link is from. Pure, runtime-neutral (Node, Deno and the app all run it),
// and the only part of the source reader the app runs: the app never fetches a source itself.

export type Platform = 'tiktok' | 'youtube' | 'instagram' | 'web';

/** A link found in what was shared, and the platform it's from. */
export type DetectedSource = { platform: Platform; url: string };

const URL_IN_TEXT = /https?:\/\/[^\s<>"'“”‘’]+/giu;

/** Characters that end a sentence around a link rather than belong to it. */
const TRAILING = /[.,;:!?)\]}>…]+$/u;

/** Every http(s) link in `text`, in order, without the punctuation around them. */
export function linksIn(text: string): string[] {
  return [...text.matchAll(URL_IN_TEXT)].flatMap((match) => {
    try {
      const url = new URL(match[0].replace(TRAILING, ''));
      return url.hostname ? [url.href] : [];
    } catch {
      return [];
    }
  });
}

/**
 * The first http(s) link in what was shared: a bare link, or text with one in it ("Check out this
 * recipe! https://vm.tiktok.com/ZM123/"). Null when there is none.
 */
export function firstLink(shared: string): string | null {
  return linksIn(shared)[0] ?? null;
}

/** True for `domain` itself and any host under it. */
const isOrUnder = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

const hostOf = (url: string) => new URL(url).hostname.toLowerCase().replace(/\.$/u, '');

const isTikTok = (host: string) => isOrUnder(host, 'tiktok.com');
const isYouTube = (host: string) => isOrUnder(host, 'youtube.com') || isOrUnder(host, 'youtu.be');
const isInstagram = (host: string) => isOrUnder(host, 'instagram.com') || isOrUnder(host, 'instagr.am');

/** Meta's hosts. The server never fetches them, not even a link in a caption (decisions 05). */
const META_DOMAINS = ['instagram.com', 'instagr.am', 'cdninstagram.com', 'facebook.com', 'fb.watch', 'fbcdn.net', 'threads.net'];

export function isMetaHost(host: string): boolean {
  const name = host.toLowerCase().replace(/\.$/u, '');
  return META_DOMAINS.some((domain) => isOrUnder(name, domain));
}

/**
 * Whether a link is a video platform's or Meta's: never a recipe site, so a link in a caption to
 * one isn't followed (decisions 04).
 */
export function isPlatformLink(url: string): boolean {
  const host = hostOf(url);
  return isTikTok(host) || isYouTube(host) || isMetaHost(host);
}

const YOUTUBE_ID = /^[\w-]{11}$/u;

/**
 * The video id in a YouTube link: `youtube.com/shorts/{id}`, `youtu.be/{id}` or
 * `youtube.com/watch?v={id}` (any YouTube video, not only Shorts). Null for any other link,
 * such as a channel's.
 */
export function youtubeVideoId(link: string): string | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const path = url.pathname.split('/').filter(Boolean);
  let id: string | null | undefined = null;
  if (isOrUnder(host, 'youtu.be')) id = path[0];
  else if (isOrUnder(host, 'youtube.com') && path[0] === 'shorts') id = path[1];
  else if (isOrUnder(host, 'youtube.com') && path[0] === 'watch') id = url.searchParams.get('v');
  return id && YOUTUBE_ID.test(id) ? id : null;
}

/**
 * The link in what was shared and its platform: tiktok.com and its short-link hosts (vm., vt.)
 * are TikTok, youtube.com and youtu.be are YouTube, instagram.com and instagr.am are Instagram;
 * everything else (a recipe site, any other page) goes the `web` way.
 */
export function detectSource(shared: string): DetectedSource | null {
  const url = firstLink(shared);
  if (url === null) return null;
  const host = hostOf(url);
  if (isTikTok(host)) return { platform: 'tiktok', url };
  if (isYouTube(host)) return { platform: 'youtube', url };
  if (isInstagram(host)) return { platform: 'instagram', url };
  return { platform: 'web', url };
}

/**
 * Whether what was shared can be saved, and if not, why, in words for the save screen: TikTok,
 * YouTube videos and any other web page can; Instagram can't yet (ticket 05).
 */
export type SharedLinkCheck =
  | { status: 'saveable'; link: DetectedSource }
  | { status: 'noLink' }
  | { status: 'unsupported'; link: DetectedSource; message: string };

export function checkSharedLink(shared: string): SharedLinkCheck {
  const link = detectSource(shared);
  if (link === null) return { status: 'noLink' };
  if (link.platform === 'instagram') {
    return { status: 'unsupported', link, message: 'Instagram links can’t be saved yet.' };
  }
  if (link.platform === 'youtube' && youtubeVideoId(link.url) === null) {
    return { status: 'unsupported', link, message: 'That YouTube link isn’t a video.' };
  }
  return { status: 'saveable', link };
}
