// Which platform a shared link is from. Pure, runtime-neutral (Node, Deno and the app all run it),
// and the only part of the source reader the app runs: the app never fetches a source itself.

export type Platform = 'tiktok' | 'youtube' | 'instagram' | 'web';

/** A link found in what was shared, and the platform it's from. */
export type DetectedSource = { platform: Platform; url: string };

const URL_IN_TEXT = /https?:\/\/[^\s<>"'“”‘’]+/iu;

/** Characters that end a sentence around a link rather than belong to it. */
const TRAILING = /[.,;:!?)\]}>…]+$/u;

/**
 * The first http(s) link in what was shared: a bare link, or text with one in it ("Check out this
 * recipe! https://vm.tiktok.com/ZM123/"). Null when there is none.
 */
export function firstLink(shared: string): string | null {
  const match = URL_IN_TEXT.exec(shared);
  if (!match) return null;
  const link = match[0].replace(TRAILING, '');
  try {
    const url = new URL(link);
    return url.hostname ? url.href : null;
  } catch {
    return null;
  }
}

/** True for `domain` itself and any host under it. */
const isOrUnder = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/**
 * The link in what was shared and its platform: tiktok.com and its short-link hosts (vm., vt.)
 * are TikTok; everything else goes the `web` way (tickets 04 and 05 add YouTube and Instagram).
 */
export function detectSource(shared: string): DetectedSource | null {
  const url = firstLink(shared);
  if (url === null) return null;
  const host = new URL(url).hostname.toLowerCase();
  if (isOrUnder(host, 'tiktok.com')) return { platform: 'tiktok', url };
  return { platform: 'web', url };
}
