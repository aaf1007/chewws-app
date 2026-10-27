// The guarded fetch every source adapter reads through (decisions 04). A shared link is the
// user's, or a caption's: it must not walk the server to its own network. Fake fetch and DNS only.
import { describe, expect, test } from 'vitest';

import { createSafeFetch, dnsResolver, isPublicAddress, type GuardedRequest } from '../supabase/functions/_shared/safe-fetch';

const PUBLIC_V4 = '93.184.216.34';

type Answer = { status?: number; headers?: Record<string, string>; body?: string };

/**
 * A fake internet: `answers` by URL (200 with an empty HTML page for any other), `dns` by host
 * (a public address for any other). Records every request that left, with its headers.
 */
function fakeInternet(answers: Record<string, Answer> = {}, dns: Record<string, string[]> = {}) {
  const requested: { url: string; method: string; userAgent: string | null }[] = [];
  const looked: string[] = [];
  const safeFetch = createSafeFetch({
    fetch: async (input, init) => {
      const url = String(input);
      requested.push({ url, method: init?.method ?? 'GET', userAgent: new Headers(init?.headers).get('user-agent') });
      const answer = answers[url] ?? {};
      return new Response(answer.body ?? '<html></html>', {
        status: answer.status ?? 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', ...answer.headers },
      });
    },
    resolveHost: async (host) => {
      looked.push(host);
      return dns[host] ?? [PUBLIC_V4];
    },
  });
  return { safeFetch, requested, looked };
}

const signal = new AbortController().signal;
const page: GuardedRequest = { signal, accept: ['text/html'] };

const refused = { name: 'SourceError', reason: 'unreadable' };

describe('safeFetch', () => {
  test('reads an https page as RecipeApp/1.0, following redirects, and says where it ended up', async () => {
    const net = fakeInternet({
      'https://short.example.com/r': { status: 301, headers: { Location: '/next' } },
      'https://short.example.com/next': { status: 302, headers: { Location: 'https://cooking.example.com/shakshuka' } },
      'https://cooking.example.com/shakshuka': { body: '<title>Shakshuka</title>' },
    });

    const response = await net.safeFetch('https://short.example.com/r', page);

    expect(response).toMatchObject({ url: 'https://cooking.example.com/shakshuka', status: 200, body: '<title>Shakshuka</title>' });
    expect(net.requested).toEqual([
      { url: 'https://short.example.com/r', method: 'GET', userAgent: 'RecipeApp/1.0' },
      { url: 'https://short.example.com/next', method: 'GET', userAgent: 'RecipeApp/1.0' },
      { url: 'https://cooking.example.com/shakshuka', method: 'GET', userAgent: 'RecipeApp/1.0' },
    ]);
    // Every hop's host is looked up and checked before it's requested.
    expect(net.looked).toEqual(['short.example.com', 'short.example.com', 'cooking.example.com']);
  });

  test('reads a shared http link over https', async () => {
    const net = fakeInternet();

    const response = await net.safeFetch('http://www.allrecipes.com/recipe/1/', page);

    expect(response.url).toBe('https://www.allrecipes.com/recipe/1/');
    expect(net.requested.map((r) => r.url)).toEqual(['https://www.allrecipes.com/recipe/1/']);
  });

  test.each([
    ['a file link', 'file:///etc/passwd'],
    ['an ftp link', 'ftp://files.example.com/recipe.txt'],
    ['a loopback address', 'https://127.0.0.1/'],
    ['the cloud metadata address', 'https://169.254.169.254/latest/meta-data/'],
    ['the metadata address over http', 'http://169.254.169.254/latest/meta-data/'],
    ['a private address', 'https://10.0.0.5/admin'],
    ['an IPv6 loopback', 'https://[::1]/'],
    ['an IPv4-mapped IPv6 address', 'https://[::ffff:127.0.0.1]/'],
    ['a decimal address', 'https://2130706433/'],
    ['a hex address', 'https://0x7f.1/'],
    ['localhost', 'https://localhost/'],
    ['localhost with a trailing dot', 'https://localhost./'],
    ['a name under localhost', 'https://api.localhost/'],
    ['a .local name', 'https://printer.local/'],
    ['an .internal name', 'https://metadata.google.internal/computeMetadata/v1/'],
    ['a single-label name', 'https://kong/rest/v1/'],
    ['a link with a user name and password', 'https://admin:secret@cooking.example.com/'],
    ['another port', 'https://cooking.example.com:8443/'],
    ['Instagram', 'https://www.instagram.com/reel/C1a2b3c4d5e/'],
    ['Instagram’s short host', 'https://instagr.am/p/C1a2b3c4d5e/'],
    ['Instagram’s CDN', 'https://scontent.cdninstagram.com/v/t51/1.jpg'],
    ['Facebook', 'https://m.facebook.com/watch/?v=1'],
    ['fb.watch', 'https://fb.watch/abc/'],
    ['Facebook’s CDN', 'https://scontent.xx.fbcdn.net/v/1.jpg'],
    ['Threads', 'https://www.threads.net/@chef/post/1'],
  ])('refuses %s without requesting it', async (_, link) => {
    const net = fakeInternet();

    await expect(net.safeFetch(link, page)).rejects.toMatchObject(refused);
    expect(net.requested).toEqual([]);
  });

  test.each([
    ['10.0.0.5'],
    ['127.0.0.1'],
    ['169.254.169.254'],
    ['172.16.3.4'],
    ['172.31.255.255'],
    ['192.168.1.1'],
    ['100.64.0.1'],
    ['0.0.0.0'],
    ['::1'],
    ['::'],
    ['fd00:ec2::254'],
    ['fe80::1'],
    ['::ffff:127.0.0.1'],
    ['::ffff:a00:1'],
    ['64:ff9b::a00:1'],
  ])('refuses a host that resolves to %s', async (address) => {
    const net = fakeInternet({}, { 'sneaky.example.com': [address] });

    await expect(net.safeFetch('https://sneaky.example.com/', page)).rejects.toMatchObject(refused);
    expect(net.requested).toEqual([]);
  });

  test('refuses a host with one public and one private address', async () => {
    const net = fakeInternet({}, { 'split.example.com': [PUBLIC_V4, '10.1.2.3'] });

    await expect(net.safeFetch('https://split.example.com/', page)).rejects.toMatchObject(refused);
    expect(net.requested).toEqual([]);
  });

  test.each([
    ['to a host that resolves to the metadata address', 'https://rebind.example.net/latest/meta-data/'],
    ['to http', 'http://cooking.example.com/shakshuka'],
    ['to an address', 'https://192.168.0.1/'],
    ['to localhost', 'https://localhost:54321/rest/v1/'],
    ['to Instagram', 'https://www.instagram.com/reel/C1a2b3c4d5e/'],
  ])('stops at a redirect %s, without requesting it', async (_, target) => {
    const net = fakeInternet(
      { 'https://cooking.example.com/go': { status: 302, headers: { Location: target } } },
      { 'rebind.example.net': ['169.254.169.254'] },
    );

    await expect(net.safeFetch('https://cooking.example.com/go', page)).rejects.toMatchObject(refused);
    expect(net.requested.map((r) => r.url)).toEqual(['https://cooking.example.com/go']);
  });

  test('follows 5 redirects and refuses a sixth', async () => {
    const chain = (n: number) => `https://hops.example.com/${n}`;
    const answers: Record<string, Answer> = Object.fromEntries(
      Array.from({ length: 7 }, (_, n) => [chain(n), { status: 302, headers: { Location: chain(n + 1) } }]),
    );
    answers[chain(5)] = { body: 'five hops' };
    const net = fakeInternet(answers);

    expect((await net.safeFetch(chain(0), page)).body).toBe('five hops');

    answers[chain(5)] = { status: 302, headers: { Location: chain(6) } };
    await expect(fakeInternet(answers).safeFetch(chain(0), page)).rejects.toMatchObject(refused);
  });

  test('with redirect "manual", hands a redirect back unfollowed', async () => {
    const net = fakeInternet({ 'https://vm.tiktok.com/ZMshort/': { status: 301, headers: { Location: 'https://169.254.169.254/' } } });

    const response = await net.safeFetch('https://vm.tiktok.com/ZMshort/', { signal, method: 'HEAD', redirect: 'manual' });

    expect(response).toMatchObject({ status: 301, body: null });
    expect(response.headers.get('location')).toBe('https://169.254.169.254/');
    expect(net.requested).toEqual([{ url: 'https://vm.tiktok.com/ZMshort/', method: 'HEAD', userAgent: 'RecipeApp/1.0' }]);
  });

  test('keeps every hop on the hosts `onlyHosts` allows', async () => {
    const net = fakeInternet({
      'https://vm.tiktok.com/ZMshort/': { status: 302, headers: { Location: 'https://tracker.example.com/' } },
    });
    const onlyTikTok = (host: string) => host.endsWith('.tiktok.com');

    await expect(net.safeFetch('https://vm.tiktok.com/ZMshort/', { ...page, onlyHosts: onlyTikTok })).rejects.toMatchObject(refused);
    expect(net.requested.map((r) => r.url)).toEqual(['https://vm.tiktok.com/ZMshort/']);
  });

  test('reads at most 2 MB of a page and drops the rest', async () => {
    const big = `<title>Big</title>${'x'.repeat(3 * 1024 * 1024)}`;
    const net = fakeInternet({ 'https://big.example.com/': { body: big } });

    const response = await net.safeFetch('https://big.example.com/', page);

    expect(response.body?.length).toBe(2 * 1024 * 1024);
    expect(response.body?.startsWith('<title>Big</title>xxx')).toBe(true);
  });

  test('leaves unread a body that is not a type asked for, and any body of a HEAD', async () => {
    const net = fakeInternet({ 'https://files.example.com/menu.pdf': { headers: { 'Content-Type': 'application/pdf' }, body: '%PDF' } });

    expect(await net.safeFetch('https://files.example.com/menu.pdf', page)).toMatchObject({ status: 200, body: null });
    expect(await net.safeFetch('https://cooking.example.com/', { ...page, method: 'HEAD' })).toMatchObject({ body: null });
  });

  test('gives up after its time limit, as unreachable', async () => {
    const safeFetch = createSafeFetch({
      timeoutMs: 50,
      resolveHost: async () => [PUBLIC_V4],
      fetch: (_, init) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    });

    await expect(safeFetch('https://slow.example.com/', page)).rejects.toMatchObject({ name: 'SourceError', reason: 'unreachable' });
  });

  test('stops when the caller gives up, passing that on rather than calling it unreachable', async () => {
    const caller = new AbortController();
    const safeFetch = createSafeFetch({
      resolveHost: async () => [PUBLIC_V4],
      fetch: (_, init) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    });

    const read = safeFetch('https://slow.example.com/', { ...page, signal: caller.signal });
    caller.abort();

    await expect(read).rejects.toMatchObject({ name: 'AbortError' });
  });

  test('a host that does not exist is unavailable; one that cannot be looked up, unreachable', async () => {
    const missing = fakeInternet({}, { 'gone.example.com': [] });
    const failing = createSafeFetch({
      fetch: async () => new Response(''),
      resolveHost: async () => {
        throw new Error('SERVFAIL');
      },
    });

    await expect(missing.safeFetch('https://gone.example.com/', page)).rejects.toMatchObject({ reason: 'unavailable' });
    await expect(failing('https://cooking.example.com/', page)).rejects.toMatchObject({ reason: 'unreachable' });
  });
});

describe('isPublicAddress', () => {
  test.each([
    ['93.184.216.34', true],
    ['8.8.8.8', true],
    ['172.32.0.1', true],
    ['100.128.0.1', true],
    ['2606:2800:220:1:248:1893:25c8:1946', true],
    ['::ffff:8.8.8.8', true],
    ['10.255.255.255', false],
    ['172.15.255.255', true],
    ['192.0.2.1', false],
    ['198.18.0.1', false],
    ['224.0.0.1', false],
    ['255.255.255.255', false],
    ['2001:db8::1', false],
    ['2001::1', false],
    ['2002:a00:1::1', false],
    ['ff02::1', false],
    ['fc00::1', false],
    ['not an address', false],
    ['1::2::3', false],
  ])('%s is public: %s', (address, expected) => {
    expect(isPublicAddress(address)).toBe(expected);
  });
});

describe('dnsResolver', () => {
  const notFound = () => Object.assign(new Error('no records found'), { name: 'NotFound' });

  test('gives the A and AAAA records together; a type with no records adds none', async () => {
    const resolve = dnsResolver(async (host, type) => {
      if (type === 'AAAA') throw notFound();
      return host === 'cooking.example.com' ? ['93.184.216.34', '93.184.216.35'] : [];
    });

    expect(await resolve('cooking.example.com')).toEqual(['93.184.216.34', '93.184.216.35']);
  });

  test('a host with no records at all has none; a lookup that fails is thrown', async () => {
    const none = dnsResolver(async () => {
      throw notFound();
    });
    const broken = dnsResolver(async () => {
      throw new Error('connection refused');
    });

    expect(await none('gone.example.com')).toEqual([]);
    await expect(broken('cooking.example.com')).rejects.toThrow('connection refused');
  });
});
