// Reading a web page (decisions 04): one fetch, then two pure readers over its HTML. A page with
// a schema.org Recipe in its JSON-LD is a recipe site; any other page gives a plain preview, its
// title and Open Graph image. The readers are plain functions, unit-tested over HTML fixtures; the
// network adapter goes through the guarded fetch. Runtime-neutral.

import type { SafeFetch } from './safe-fetch.ts';
import { SourceError } from './source-error.ts';

/** What a schema.org Recipe on a recipe site says. */
export type SiteRecipe = {
  name: string;
  ingredients: string[];
  steps: string[];
  imageUrl: string | null;
  author: string | null;
};

/** A plain preview of a page: its title and picture. */
export type PagePreview = { title: string | null; imageUrl: string | null };

/** What a page says: its preview, and its recipe if it has one. `url`: where it was read, after redirects. */
export type PageInfo = PagePreview & { url: string; siteRecipe: SiteRecipe | null };

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', deg: '°', frac12: '½',
  frac14: '¼', frac34: '¾', times: '×', middot: '·', bull: '•', copy: '©', reg: '®', trade: '™',
  eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à', aacute: 'á', acirc: 'â', auml: 'ä', ouml: 'ö',
  uuml: 'ü', iuml: 'ï', ccedil: 'ç', ntilde: 'ñ', oacute: 'ó', iacute: 'í', uacute: 'ú', szlig: 'ß',
};

/** Decodes HTML character references (`&amp;`, `&#39;`, `&#x2019;`); unknown ones stay as written. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/giu, (whole, ref: string) => {
    if (ref.startsWith('#')) {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : whole;
    }
    return NAMED[ref.toLowerCase()] ?? whole;
  });
}

/** Text as a reader shows it: tags dropped, references decoded, whitespace collapsed. */
function plain(value: unknown): string {
  if (typeof value !== 'string') return '';
  // Inline tags go without a trace ("the <b>mince</b>."); any other tag separates words. A tag
  // ends at the next < as well as at >, so text full of < can't make these scans quadratic.
  const untagged = value
    .replace(/<\/?(?:a|b|i|em|strong|span|u|small|sub|sup|mark)\b[^<>]*>/giu, '')
    .replace(/<[^<>]*>/gu, ' ');
  return decodeEntities(untagged)
    .replace(/\s+/gu, ' ')
    .trim();
}

const MAX_DATA_URL = 4096;

/**
 * A picture's URL as the phone may load it: an https URL (relative ones resolved against the
 * page), or a small inline `data:image/` one. Never fetched by the server, never copied.
 */
function imageUrl(value: unknown, pageUrl: string): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const raw = decodeEntities(value.trim());
  if (raw.startsWith('data:image/')) return raw.length <= MAX_DATA_URL ? raw : null;
  try {
    const url = new URL(raw, pageUrl);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

const field = (node: unknown, key: string): unknown =>
  typeof node === 'object' && node !== null && !Array.isArray(node) ? Reflect.get(node, key) : undefined;

/*
 * Finding tags. A page is untrusted and up to 2 MB, so tags are found with indexOf, never with a
 * regex scanned across the page: `/<meta\b[^>]*>/g` over 2 MB of "<meta " with no ">" takes
 * quadratic time. Every scan below only moves forward, so reading a page is linear in its size.
 */

/** A tag's text, from its `<` to its `>`, is at most this long; a longer one is skipped. */
const MAX_TAG = 4096;
/** `<meta>` and `<title>` belong in the head: only the start of a page is searched for them. */
const HEAD_LIMIT = 256 * 1024;

/** `html` with ASCII letters lowercased: same length, so its indexes are the page's. */
const asciiLower = (html: string) => html.replace(/[A-Z]+/gu, (letters) => letters.toLowerCase());

const isNameEnd = (char: string) => char === '' || char === '>' || char === '/' || /\s/u.test(char);

/** Each `<name …>` tag in `lower` that starts before `limit`: where it starts and ends (after `>`). */
function* tagsNamed(lower: string, name: string, limit = lower.length): Generator<{ start: number; end: number }> {
  let at = 0;
  let close = -1;
  while (true) {
    const start = lower.indexOf(`<${name}`, at);
    if (start === -1 || start >= limit) return;
    at = start + 1;
    if (!isNameEnd(lower.charAt(start + name.length + 1))) continue;
    if (close < start) close = lower.indexOf('>', start);
    if (close === -1) return;
    if (close - start > MAX_TAG) continue;
    yield { start, end: close + 1 };
    at = close + 1;
  }
}

/** The JSON in each `<script type="application/ld+json">` block that parses. */
function jsonLdBlocks(html: string): unknown[] {
  const lower = asciiLower(html);
  const texts: string[] = [];
  let closing = -1;
  for (const tag of tagsNamed(lower, 'script')) {
    if (!/\btype\s*=\s*["']?application\/ld\+json/u.test(lower.slice(tag.start, tag.end))) continue;
    if (closing < tag.end) closing = lower.indexOf('</script', tag.end);
    if (closing === -1) break;
    texts.push(html.slice(tag.end, closing));
  }
  return texts.flatMap((block) => {
    const text = block
      .trim()
      .replace(/^(?:\/\/\s*)?<!\[CDATA\[|(?:\/\/\s*)?\]\]>$/gu, '')
      .replace(/^<!--|-->$/gu, '');
    for (const candidate of [text, text.replace(/[\u0000-\u001f]+/gu, ' ')]) {
      try {
        return [JSON.parse(candidate)];
      } catch {
        // Some sites put raw line breaks inside strings; the second try turns them into spaces.
      }
    }
    return [];
  });
}

/** Every object in a JSON-LD value: inside arrays, an `@graph`, or a page's `mainEntity`. */
function nodes(value: unknown, depth = 0): unknown[] {
  if (depth > 8) return [];
  if (Array.isArray(value)) return value.flatMap((v) => nodes(v, depth + 1));
  if (typeof value !== 'object' || value === null) return [];
  return [value, ...nodes(field(value, '@graph'), depth + 1), ...nodes(field(value, 'mainEntity'), depth + 1)];
}

/** Whether a node's `@type` (a string or an array) names `type`, bare or as a schema.org URL. */
function hasType(node: unknown, type: string): boolean {
  const types: unknown = field(node, '@type');
  const list: unknown[] = Array.isArray(types) ? types : [types];
  return list.some((t) => typeof t === 'string' && t.replace(/^.*[/:]/u, '') === type);
}

const strings = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [value]).map(plain).filter((text) => text !== '');

/** The method as steps: from a string, a list of strings, HowToSteps, or HowToSections of them. */
function steps(value: unknown, depth = 0): string[] {
  if (depth > 6 || value === null || value === undefined) return [];
  if (typeof value === 'string') {
    // One string may hold every step, split by line breaks or as HTML paragraphs or list items.
    return value
      .split(/\r?\n|<br\s*\/?>|<\/p>|<\/li>/iu)
      .map(plain)
      .filter((step) => step !== '');
  }
  if (Array.isArray(value)) return value.flatMap((v) => steps(v, depth + 1));
  if (hasType(value, 'HowToSection') || hasType(value, 'ItemList')) return steps(field(value, 'itemListElement'), depth + 1);
  const text = plain(field(value, 'text')) || plain(field(value, 'name'));
  return text ? [text] : [];
}

function firstImage(value: unknown, pageUrl: string): string | null {
  for (const item of Array.isArray(value) ? value : [value]) {
    const url = typeof item === 'string' ? imageUrl(item, pageUrl) : imageUrl(field(item, 'url') ?? field(item, 'contentUrl'), pageUrl);
    if (url) return url;
  }
  return null;
}

function firstAuthor(value: unknown): string | null {
  for (const item of Array.isArray(value) ? value : [value]) {
    const name = typeof item === 'string' ? plain(item) : plain(field(item, 'name'));
    if (name) return name;
  }
  return null;
}

/**
 * The page's schema.org Recipe, from its JSON-LD: in a block of its own, in an array, in an
 * `@graph` or as a page's `mainEntity`, with `@type` "Recipe" or an array that includes it. Null
 * when the page has none.
 */
export function readSchemaOrgRecipe(html: string, pageUrl: string): SiteRecipe | null {
  for (const node of jsonLdBlocks(html).flatMap((block) => nodes(block))) {
    if (!hasType(node, 'Recipe')) continue;
    return {
      name: plain(field(node, 'name')) || plain(field(node, 'headline')),
      ingredients: strings(field(node, 'recipeIngredient') ?? field(node, 'ingredients')),
      steps: steps(field(node, 'recipeInstructions')),
      imageUrl: firstImage(field(node, 'image'), pageUrl),
      author: firstAuthor(field(node, 'author')),
    };
  }
  return null;
}

/** The attributes of each `<meta>` tag in the start of the page, names lowercased. */
function metaTags(html: string, lower: string): Map<string, string>[] {
  return [...tagsNamed(lower, 'meta', HEAD_LIMIT)].map(({ start, end }) => {
    const attributes = new Map<string, string>();
    // The value is optional, so a name with none is consumed whole rather than rescanned.
    for (const a of html.slice(start, end).matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/gu)) {
      const value = a[2] ?? a[3] ?? a[4];
      if (value !== undefined) attributes.set(a[1].toLowerCase(), value);
    }
    return attributes;
  });
}

/** The text of the page's first `<title>`, if it closes. */
function titleText(html: string, lower: string): string | undefined {
  const tag = tagsNamed(lower, 'title', HEAD_LIMIT).next();
  if (tag.done) return undefined;
  const end = lower.indexOf('</title', tag.value.end);
  return end === -1 ? undefined : html.slice(tag.value.end, end);
}

const MAX_TITLE = 200;

/** A plain preview of any page: `og:title` or else `<title>`, and `og:image`. */
export function readPagePreview(html: string, pageUrl: string): PagePreview {
  const lower = asciiLower(html);
  const meta = new Map<string, string>();
  for (const tag of metaTags(html, lower)) {
    const key = (tag.get('property') ?? tag.get('name') ?? '').toLowerCase();
    const content = tag.get('content');
    if (key && content !== undefined && !meta.has(key)) meta.set(key, content);
  }
  const titleTag = titleText(html, lower);
  const title = plain(meta.get('og:title')) || plain(titleTag) || plain(meta.get('twitter:title'));
  return {
    title: title ? title.slice(0, MAX_TITLE) : null,
    imageUrl:
      imageUrl(meta.get('og:image:secure_url'), pageUrl) ??
      imageUrl(meta.get('og:image'), pageUrl) ??
      imageUrl(meta.get('twitter:image'), pageUrl),
  };
}

/** Everything a page's HTML says, read with both readers. */
export function readPage(html: string, pageUrl: string): Omit<PageInfo, 'url'> {
  return { ...readPagePreview(html, pageUrl), siteRecipe: readSchemaOrgRecipe(html, pageUrl) };
}

const HTML = ['text/html', 'application/xhtml+xml'];

/** Statuses of a page that won't show itself to the server: sign-in, payment, forbidden, legal. */
const REFUSED = new Set([401, 402, 403, 451]);

/**
 * The page adapter: one guarded fetch of the page, HTML only. A page that isn't HTML (a PDF, an
 * image) still saves, with no preview: an empty Draft to fill in by hand. One that won't show
 * itself to the server (401, 402, 403, 451: a paywall, or a site that turns away anything but a
 * browser, as big recipe sites do with 402) is `refused`: the app couldn't read it, and the user
 * can paste the recipe or add a screenshot (decisions, "when a source can't be read"). It never
 * pretends to be a browser to get past one. 404 and 410 are a page that's gone (`unavailable`),
 * 408 and 429 a site that didn't answer in time (`unreachable`), any other 4xx a link the app
 * can't open (`unreadable`).
 */
export function pageAdapter(safeFetch: SafeFetch): (url: string, signal: AbortSignal) => Promise<PageInfo> {
  return async (url, signal) => {
    const response = await safeFetch(url, { accept: HTML, signal, headers: { Accept: 'text/html' } });
    const answered = `${response.url} answered ${response.status}.`;
    if (response.status >= 500 || response.status === 429 || response.status === 408) {
      throw new SourceError('unreachable', answered);
    }
    if (REFUSED.has(response.status)) throw new SourceError('refused', answered);
    if (response.status === 404 || response.status === 410) throw new SourceError('unavailable', answered);
    if (response.status >= 400) throw new SourceError('unreadable', answered);
    if (response.status >= 300 || response.body === null) {
      return { url: response.url, title: null, imageUrl: null, siteRecipe: null };
    }
    return { url: response.url, ...readPage(response.body, response.url) };
  };
}
