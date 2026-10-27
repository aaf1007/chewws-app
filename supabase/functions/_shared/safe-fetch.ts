// The one way the server fetches anything a user or a caption named (decisions 04). Every source
// adapter reads through it; eslint bans bare `fetch` elsewhere in _shared. A shared link is
// attacker-controlled, so before each request, and again at each redirect, it checks that the link
// is https on the default port, names a public host by name (no IP literals, no localhost or
// internal names, no Meta host), and that every address the host resolves to is public. It also
// caps the whole read at 8 s and the body at 2 MB. DNS rebinding between the check and the
// connection isn't handled (accepted for TestFlight). Runtime-neutral: the caller passes `fetch`
// and a DNS lookup.

import { isMetaHost } from './detect-source.ts';
import { SourceError } from './source-error.ts';

/** Every address `hostname` resolves to (A and AAAA). Empty when it has none. */
export type ResolveHost = (hostname: string) => Promise<string[]>;

export type GuardedRequest = {
  signal: AbortSignal;
  method?: 'GET' | 'HEAD';
  /**
   * `follow` (the default): follows up to 5 redirects, each checked as the first link was.
   * `manual`: returns a redirect as it is, unfollowed, for the caller to check.
   */
  redirect?: 'follow' | 'manual';
  /** Content types whose body is read, such as `text/html`. Any other body is left unread (null). */
  accept?: readonly string[];
  /** A further rule for the host of every request, redirects included (TikTok's own hosts, say). */
  onlyHosts?: (host: string) => boolean;
  headers?: Record<string, string>;
};

export type GuardedResponse = {
  /** Where the answer came from, after any redirects. */
  url: string;
  status: number;
  headers: Headers;
  /** The body as text, at most `maxBytes` of it; null for HEAD or a content type not accepted. */
  body: string | null;
};

const guarded: unique symbol = Symbol('safeFetch');

/** A fetch that only `createSafeFetch` makes, so an adapter can't be handed a bare `fetch`. */
export type SafeFetch = ((url: string, request: GuardedRequest) => Promise<GuardedResponse>) & {
  readonly [guarded]: true;
};

export type SafeFetchOptions = {
  fetch: typeof fetch;
  resolveHost: ResolveHost;
  /** For the whole read, redirects included. */
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
};

export const USER_AGENT = 'RecipeApp/1.0';

const LOCAL_SUFFIXES = ['localhost', 'local', 'internal', 'localdomain', 'home.arpa'];

const isIpLiteral = (host: string) => /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host) || host.startsWith('[');

function ipv4Octets(address: string): number[] | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (/^\d{1,3}$/u.test(part) ? Number(part) : NaN));
  return octets.every((o) => o >= 0 && o <= 255) ? octets : null;
}

/** [first address, prefix length] of the IPv4 ranges that aren't the public internet. */
const PRIVATE_V4: [number[], number][] = [
  [[0, 0, 0, 0], 8], // "this network"
  [[10, 0, 0, 0], 8],
  [[100, 64, 0, 0], 10], // carrier-grade NAT
  [[127, 0, 0, 0], 8], // loopback
  [[169, 254, 0, 0], 16], // link-local, cloud metadata (169.254.169.254)
  [[172, 16, 0, 0], 12],
  [[192, 0, 0, 0], 24],
  [[192, 0, 2, 0], 24],
  [[192, 88, 99, 0], 24],
  [[192, 168, 0, 0], 16],
  [[198, 18, 0, 0], 15],
  [[198, 51, 100, 0], 24],
  [[203, 0, 113, 0], 24],
  [[224, 0, 0, 0], 4], // multicast
  [[240, 0, 0, 0], 4], // reserved, broadcast
];

const toInt = (octets: number[]) => octets.reduce((n, o) => n * 256 + o, 0);

function isPublicV4(octets: number[]): boolean {
  const n = toInt(octets);
  return PRIVATE_V4.every(([start, bits]) => {
    const size = 2 ** (32 - bits);
    const first = toInt(start);
    return n < first || n >= first + size;
  });
}

/** The eight 16-bit groups of an IPv6 address, or null if it isn't one. */
function ipv6Groups(address: string): number[] | null {
  let text = address.toLowerCase().replace(/^\[|\]$/gu, '').replace(/%.*$/u, '');
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/u.exec(text);
  if (v4) {
    const octets = ipv4Octets(v4[1]);
    if (!octets) return null;
    const tail = `${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
    text = text.slice(0, v4.index) + tail;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const parse = (half: string) => (half === '' ? [] : half.split(':'));
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/u.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

/**
 * Whether an address the server could connect to is on the public internet. IPv4 outside the
 * private, loopback, link-local, shared, documentation, multicast and reserved ranges; IPv6 only in
 * global unicast (2000::/3) outside documentation, Teredo and 6to4, or an IPv4-mapped public one.
 */
export function isPublicAddress(address: string): boolean {
  const v4 = ipv4Octets(address);
  if (v4) return isPublicV4(v4);
  const g = ipv6Groups(address);
  if (!g) return false;
  const mapped = g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff;
  if (mapped) return isPublicV4([g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff]);
  if (g[0] < 0x2000 || g[0] > 0x3fff) return false;
  if (g[0] === 0x2001 && (g[1] === 0x0db8 || g[1] === 0)) return false;
  return g[0] !== 0x2002;
}

const refused = (message: string) => new SourceError('unreadable', message);

/** Checks a link before it's requested. Throws `unreadable` for one the server won't fetch. */
async function checkLink(url: URL, resolveHost: ResolveHost, onlyHosts?: (host: string) => boolean): Promise<void> {
  if (url.protocol !== 'https:') throw refused(`Only https links are read, not ${url.protocol}.`);
  if (url.username || url.password) throw refused('A link with a user name or password is not read.');
  if (url.port !== '' && url.port !== '443') throw refused(`Port ${url.port} is not read.`);
  const host = url.hostname.toLowerCase().replace(/\.$/u, '');
  if (isIpLiteral(host)) throw refused(`A link to an address (${host}) is not read; only host names are.`);
  if (!host.includes('.') || LOCAL_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`))) {
    throw refused(`${host} is not a public host.`);
  }
  if (isMetaHost(host)) throw refused(`${host} is Meta's; the server never reads it.`);
  if (onlyHosts && !onlyHosts(host)) throw refused(`${host} is not a host this link may lead to.`);
  let addresses: string[];
  try {
    addresses = await resolveHost(host);
  } catch (e) {
    throw new SourceError('unreachable', `Couldn't look up ${host}.`, { cause: e });
  }
  if (addresses.length === 0) throw new SourceError('unavailable', `${host} doesn't exist.`);
  const local = addresses.find((a) => !isPublicAddress(a));
  if (local !== undefined) throw refused(`${host} leads to ${local}, which is not a public address.`);
}

/** The body as text, stopping (and dropping the rest) after `maxBytes`. */
async function readCapped(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    const room = maxBytes - size;
    chunks.push(value.byteLength > room ? value.subarray(0, room) : value);
    size += Math.min(value.byteLength, room);
  }
  await reader.cancel().catch(() => {});
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

const isRedirect = (status: number) => [301, 302, 303, 307, 308].includes(status);

export function createSafeFetch(options: SafeFetchOptions): SafeFetch {
  const { fetch: fetchFn, resolveHost, timeoutMs = 8_000, maxBytes = 2 * 1024 * 1024, maxRedirects = 5 } = options;

  const safeFetch = async (link: string, request: GuardedRequest): Promise<GuardedResponse> => {
    let url: URL;
    try {
      url = new URL(link);
    } catch {
      throw refused(`Not a link: ${link}`);
    }
    // A shared http link is read over https; a redirect to http is refused below.
    if (url.protocol === 'http:') url.protocol = 'https:';

    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = AbortSignal.any([request.signal, timeout]);
    try {
      for (let redirects = 0; ; redirects++) {
        await checkLink(url, resolveHost, request.onlyHosts);
        signal.throwIfAborted();
        let response: Response;
        try {
          response = await fetchFn(url.href, {
            method: request.method ?? 'GET',
            redirect: 'manual',
            headers: { 'User-Agent': USER_AGENT, ...request.headers },
            signal,
          });
        } catch (e) {
          if (request.signal.aborted) throw e;
          throw new SourceError('unreachable', `Couldn't reach ${url.host}.`, { cause: e });
        }
        const location = response.headers.get('location');
        if (request.redirect !== 'manual' && isRedirect(response.status) && location !== null) {
          await response.body?.cancel().catch(() => {});
          if (redirects >= maxRedirects) throw refused(`${link} redirects more than ${maxRedirects} times.`);
          url = new URL(location, url);
          continue;
        }
        const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
        const readBody = request.method !== 'HEAD' && (request.accept ?? []).includes(type);
        if (!readBody) await response.body?.cancel().catch(() => {});
        return {
          url: url.href,
          status: response.status,
          headers: response.headers,
          body: readBody ? await readCapped(response, maxBytes) : null,
        };
      }
    } catch (e) {
      if (timeout.aborted && !request.signal.aborted) {
        throw new SourceError('unreachable', `${link} took longer than ${timeoutMs / 1000} s.`, { cause: e });
      }
      throw e;
    }
  };
  return Object.assign(safeFetch, { [guarded]: true as const });
}
