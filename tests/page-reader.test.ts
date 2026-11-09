// The pure readers over a page's HTML (decisions 04): its schema.org Recipe, and a plain preview
// for any other page. Plain unit tests over HTML fixtures; the network adapter isn't tested here.
import { describe, expect, test } from 'vitest';

import { decodeEntities, readPagePreview, readSchemaOrgRecipe } from '../supabase/functions/_shared/page-reader';

const URL = 'https://cooking.example.com/recipes/pasta';

const ldJson = (json: unknown, attributes = 'type="application/ld+json"') =>
  `<html><head><script ${attributes}>${JSON.stringify(json)}</script></head><body></body></html>`;

describe('readSchemaOrgRecipe', () => {
  test('reads a Recipe in a block of its own, with accents, apostrophes and entities', () => {
    const html = ldJson({
      '@context': 'https://schema.org',
      '@type': 'Recipe',
      name: 'Nonna&#39;s crème brûlée',
      author: { '@type': 'Person', name: 'Giulia D’Angelo' },
      image: 'https://img.example.com/brulee.jpg',
      recipeIngredient: ['4 egg yolks', '  500ml  double cream ', '1 vanilla pod &amp; seeds', '', 'Hellmann&#x2019;s mayo'],
      recipeInstructions: 'Whisk the yolks.\nHeat the cream.\n\nBake at 150°C.',
    });

    expect(readSchemaOrgRecipe(html, URL)).toEqual({
      name: "Nonna's crème brûlée",
      ingredients: ['4 egg yolks', '500ml double cream', '1 vanilla pod & seeds', 'Hellmann’s mayo'],
      steps: ['Whisk the yolks.', 'Heat the cream.', 'Bake at 150°C.'],
      imageUrl: 'https://img.example.com/brulee.jpg',
      author: 'Giulia D’Angelo',
    });
  });

  test('finds a Recipe inside an array, and @type as an array or a schema.org URL', () => {
    const inArray = ldJson([
      { '@type': 'Organization', name: 'Cooking Example' },
      { '@type': ['Recipe', 'NewsArticle'], name: 'Pasta', recipeIngredient: ['pasta'] },
    ]);
    const asUrl = ldJson({ '@type': 'http://schema.org/Recipe', name: 'Pasta', recipeIngredient: ['pasta'] });

    expect(readSchemaOrgRecipe(inArray, URL)).toMatchObject({ name: 'Pasta', ingredients: ['pasta'] });
    expect(readSchemaOrgRecipe(asUrl, URL)).toMatchObject({ name: 'Pasta', ingredients: ['pasta'] });
  });

  test('finds a Recipe in an @graph or as a page’s mainEntity', () => {
    const graph = ldJson({ '@graph': [{ '@type': 'WebSite' }, { '@type': 'Recipe', name: 'Graph pasta' }] });
    const mainEntity = ldJson({ '@type': 'WebPage', mainEntity: { '@type': 'Recipe', name: 'Main pasta' } });

    expect(readSchemaOrgRecipe(graph, URL)?.name).toBe('Graph pasta');
    expect(readSchemaOrgRecipe(mainEntity, URL)?.name).toBe('Main pasta');
  });

  test('reads steps from HowToSteps, HowToSections of them, and HTML in a string', () => {
    const sections = ldJson({
      '@type': 'Recipe',
      name: 'Lasagne',
      recipeInstructions: [
        {
          '@type': 'HowToSection',
          name: 'Ragù',
          itemListElement: [
            { '@type': 'HowToStep', text: 'Brown the <b>mince</b>.' },
            { '@type': 'HowToStep', name: 'Simmer for 2 hours.' },
          ],
        },
        { '@type': 'HowToStep', text: '  Layer &amp; bake.  ' },
        'Rest for 10 minutes.',
      ],
    });
    const html = ldJson({ '@type': 'Recipe', name: 'Soup', recipeInstructions: '<ol><li>Chop.</li><li>Boil.</li></ol><p>Serve.</p>' });

    expect(readSchemaOrgRecipe(sections, URL)?.steps).toEqual([
      'Brown the mince.',
      'Simmer for 2 hours.',
      'Layer & bake.',
      'Rest for 10 minutes.',
    ]);
    expect(readSchemaOrgRecipe(html, URL)?.steps).toEqual(['Chop.', 'Boil.', 'Serve.']);
  });

  test('reads an image from a list or an ImageObject, resolving a relative one; an http one is dropped', () => {
    const objects = ldJson({ '@type': 'Recipe', name: 'P', image: [{ '@type': 'ImageObject', url: '/img/p.jpg' }] });
    const insecure = ldJson({ '@type': 'Recipe', name: 'P', image: ['http://img.example.com/p.jpg'] });
    const authors = ldJson({ '@type': 'Recipe', name: 'P', author: [{ name: '' }, 'Jo Smith'] });

    expect(readSchemaOrgRecipe(objects, URL)?.imageUrl).toBe('https://cooking.example.com/img/p.jpg');
    expect(readSchemaOrgRecipe(insecure, URL)?.imageUrl).toBeNull();
    expect(readSchemaOrgRecipe(authors, URL)).toMatchObject({ author: 'Jo Smith', imageUrl: null, ingredients: [], steps: [] });
  });

  test('skips a block that is not JSON and reads one with raw line breaks in its strings', () => {
    const html = `<script type="application/ld+json">{ not json </script>
      <script data-x="1" type='application/ld+json'>
      {"@type": "Recipe", "name": "Two
      line pasta", "recipeIngredient": ["salt"]}
      </script>`;

    expect(readSchemaOrgRecipe(html, URL)).toMatchObject({ name: 'Two line pasta', ingredients: ['salt'] });
  });

  test.each([
    ['no JSON-LD', '<html><head><title>Pasta</title></head></html>'],
    ['JSON-LD with no Recipe', ldJson({ '@type': 'Article', name: 'Ten pasta tips' })],
    ['a Recipe only in the page text', '<p>"@type": "Recipe"</p>'],
    ['an empty page', ''],
  ])('%s has no Recipe', (_, html) => {
    expect(readSchemaOrgRecipe(html, URL)).toBeNull();
  });
});

describe('readPagePreview', () => {
  test('prefers og:title, with its attributes in either order, and reads og:image', () => {
    const html = `<head><title>Blog – Example</title>
      <meta content="My kitchen tour &amp; favourite tools" property="og:title">
      <meta property='og:image' content='/images/kitchen.jpg'></head>`;

    expect(readPagePreview(html, 'https://blog.example.org/tour')).toEqual({
      title: 'My kitchen tour & favourite tools',
      imageUrl: 'https://blog.example.org/images/kitchen.jpg',
    });
  });

  test('falls back to <title>, collapsing its whitespace', () => {
    const html = `<html><head><title>
      L&#39;atelier   du  pain
    </title></head></html>`;

    expect(readPagePreview(html, URL)).toEqual({ title: "L'atelier du pain", imageUrl: null });
  });

  test('a page with no title or picture has an empty preview', () => {
    expect(readPagePreview('<html><body>Hi</body></html>', URL)).toEqual({ title: null, imageUrl: null });
    expect(readPagePreview('<title>   </title><meta property="og:image" content="javascript:alert(1)">', URL)).toEqual({
      title: null,
      imageUrl: null,
    });
  });

  test('cuts a very long title to 200 characters', () => {
    expect(readPagePreview(`<title>${'Pasta '.repeat(100)}</title>`, URL).title).toHaveLength(200);
  });
});

describe('decodeEntities', () => {
  test.each([
    ['Mac &amp; cheese', 'Mac & cheese'],
    ['Nonna&#39;s', "Nonna's"],
    ['Caf&eacute; &#x2014; 5&frac12; cups', 'Café — 5½ cups'],
    ['&unknown; stays', '&unknown; stays'],
    ['&#0; and &#xD800; stay', '&#0; and &#xD800; stay'],
  ])('%s → %s', (text, expected) => {
    expect(decodeEntities(text)).toBe(expected);
  });
});

describe('hostile HTML', () => {
  const twoMb = (chunk: string) => chunk.repeat(Math.ceil((2 * 1024 * 1024) / chunk.length));

  test.each([
    ['unclosed <meta tags', twoMb('<meta ')],
    ['unclosed <title tags', twoMb('<title>')],
    ['<title with no end', `<title>${twoMb('a')}`],
    ['unclosed ld+json blocks', twoMb('<script type="application/ld+json">')],
    ['unclosed <script tags', twoMb('<script ')],
    ['<meta tags that all end at one far >', `${twoMb('<meta ')}>`],
    ['<meta tags full of long attribute names', twoMb(`<meta ${'a'.repeat(4000)}>`)],
    ['a JSON-LD Recipe whose name is all <', ldJson({ '@type': 'Recipe', name: twoMb('<'), recipeIngredient: [twoMb('<b')] })],
  ])('%s (2 MB) are read in well under a second', (_, html) => {
    const started = performance.now();

    readPagePreview(html, URL);
    readSchemaOrgRecipe(html, URL);

    expect(performance.now() - started).toBeLessThan(500);
  });
});
